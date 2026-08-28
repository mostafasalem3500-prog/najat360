/**
 * Repository layer — the ONLY place in this project's new web-UI code that
 * touches Postgres directly. Every function here wires one of the existing
 * pure gatekeepers (submitCallerReport, resolveLocation,
 * resolveAnchorToObservation, generateCoverageAwareRecommendation,
 * decideDispatch, submitFieldAction) to real rows, inside a transaction,
 * writing the IncidentEvent + AuditLog trail every mutation in this
 * codebase is expected to leave behind (see e.g. scripts/seed-demo.ts's own
 * INSERT sequence, which this file's SQL intentionally mirrors column-for-
 * column so the live app and the seed fixtures stay one consistent shape).
 *
 * Every row this layer inserts sets synthetic = true — there is no
 * production data source in this project (see prisma/schema.prisma's file
 * header). This is a hackathon demo: real caller reports never flow
 * through here, only synthetic ones a demo operator or a judge generates
 * by using the app.
 *
 * One explicit design decision NOT dictated by any existing pure function
 * (decideDispatch() and submitFieldAction() both stop short of it, by
 * design — see their own header comments on staying pure/DB-free): this
 * layer is what flips AmbulanceUnit.status to 'BUSY' the moment a unit is
 * actually dispatched, and back to 'AVAILABLE' the moment its incident
 * closes. Spec's own C4 acceptance rule ("لا يمكن إسناد وحدة غير متاحة" — an
 * unavailable unit can never be assigned) only means anything operationally
 * if SOME layer keeps `status` truthful as units get busy and free up
 * again; scripts/seed-demo.ts never had to do this (it hand-assigns a fixed
 * demo snapshot), but a live walkthrough where a supervisor dispatches a
 * unit and then watches the next recommendation correctly exclude it does.
 */
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { getPool } from './db';
import {
  submitCallerReport,
  hashCallerToken,
  MissingLanguageError,
  type SubmitCallerReportInput,
} from '@/lib/incidents/intake';
import {
  resolveAnchorToObservation,
  buildObservationFromDeviceInput,
  AnchorNotFoundError,
  AnchorNotActiveError,
  type AnchorLookup,
  type LocationAnchorRecord,
  type NewLocationObservationInput,
} from '@/lib/location/anchor-resolution';
import { resolveLocation, type ObservationForResolution, type EntranceCandidate } from '@/lib/location/resolver';
import { transition } from '@/lib/incidents/state-machine';
import { generateCoverageAwareRecommendation } from '@/lib/dispatch/generate-coverage-recommendation';
import { DISPATCH_SCORE_VERSION } from '@/lib/dispatch/dispatch-score';
import type { UnitCandidateInput, EntranceCandidateInput } from '@/lib/dispatch/generate-recommendation';
import { decideDispatch, type FreshUnitStatus } from '@/lib/dispatch/decision';
import { submitFieldAction, type ExistingFieldActionRef } from '@/lib/fieldlink/field-action';
import { MockRoutingProvider } from '@/lib/routing/mock-provider';
import { latLngToH3Cell, h3CellToLatLng, h3GridDisk } from '@/lib/gis/h3';
import type { CoverageCellInput } from '@/lib/gis/coverage';
import type {
  FieldActionType,
  IncidentStatus,
  LocationObservationSource,
} from '@/lib/domain/types';

/** Same demo area as scripts/seed-demo.ts — kept as one literal here, not re-derived from seeded rows, so this file works even against a freshly-migrated (not-yet-seeded) database. */
export const RIYADH_CENTER = { latitude: 24.7136, longitude: 46.6753 };
/** Smaller than the seed script's ring-3/37-cell grid on purpose: this function runs synchronously inside an HTTP request (the seed script runs once, offline, with no request timeout to respect). Ring 2 (19 cells) keeps a live "generate recommendation" click fast while still showing real gap/no-gap variety. */
const LIVE_COVERAGE_GRID_RING_SIZE = 2;

async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Postgres unique_violation — see https://www.postgresql.org/docs/current/errcodes-appendix.html. Used only to retry a rescue-code/token collision, which `generateRescueCode()`'s own alphabet makes astronomically unlikely but not impossible. */
function isUniqueViolation(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === '23505');
}

export function buildLiveCoverageGridCells(): CoverageCellInput[] {
  const centerCell = latLngToH3Cell(RIYADH_CENTER);
  return h3GridDisk(centerCell, LIVE_COVERAGE_GRID_RING_SIZE).map((h3Index) => ({
    h3Index,
    center: h3CellToLatLng(h3Index),
  }));
}

class PgAnchorLookup implements AnchorLookup {
  constructor(private readonly client: PoolClient) {}

  async getActiveAnchorByCode(code: string): Promise<LocationAnchorRecord | null> {
    const result = await this.client.query(
      `SELECT id, code, "entranceId", "floorLevel", latitude, longitude, "anchorType",
              "validationStatus", "validFrom", "validUntil", active
       FROM "LocationAnchor" WHERE code = $1`,
      [code]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      code: row.code,
      entranceId: row.entranceId,
      floorLevel: row.floorLevel,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      anchorType: row.anchorType,
      validationStatus: row.validationStatus,
      validFrom: row.validFrom,
      validUntil: row.validUntil,
      active: row.active,
    };
  }
}

async function insertIncidentEvent(
  client: PoolClient,
  event: {
    incidentId: string;
    actorType: string;
    actorId?: string | null;
    eventType: string;
    previousStatus?: IncidentStatus | null;
    nextStatus?: IncidentStatus | null;
    metadata?: unknown;
    createdAt: Date;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO "IncidentEvent" (id, "incidentId", "actorType", "actorId", "eventType", "previousStatus", "nextStatus", metadata, "createdAt")
     VALUES ($1,$2,$3::"ActorType",$4,$5::"IncidentEventType",$6::"IncidentStatus",$7::"IncidentStatus",$8::jsonb,$9)`,
    [
      randomUUID(),
      event.incidentId,
      event.actorType,
      event.actorId ?? null,
      event.eventType,
      event.previousStatus ?? null,
      event.nextStatus ?? null,
      event.metadata ? JSON.stringify(event.metadata) : null,
      event.createdAt,
    ]
  );
}

async function insertAuditLog(
  client: PoolClient,
  log: { actorId?: string | null; action: string; entityType: string; entityId: string; before?: unknown; after?: unknown }
): Promise<void> {
  await client.query(
    `INSERT INTO "AuditLog" (id, "actorId", action, "entityType", "entityId", before, after, "createdAt")
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)`,
    [
      randomUUID(),
      log.actorId ?? null,
      log.action,
      log.entityType,
      log.entityId,
      log.before !== undefined ? JSON.stringify(log.before) : null,
      log.after !== undefined ? JSON.stringify(log.after) : null,
      new Date(),
    ]
  );
}

// ---------------------------------------------------------------------------
// Caller intake (C1 + C3 combined: submitCallerReport() + resolveLocation())
// ---------------------------------------------------------------------------

export type CallerLocationInput =
  | { type: 'ANCHOR'; anchorCode: string }
  | { type: 'GPS'; latitude: number; longitude: number; horizontalAccuracyMeters?: number };

export interface CreateIncidentFromCallerReportInput {
  language: string;
  unableToSpeak: boolean;
  description?: string;
  callerName?: string;
  callerPhone?: string;
  location: CallerLocationInput;
  now?: Date;
}

export interface CreateIncidentFromCallerReportResult {
  incidentId: string;
  rescueCode: string;
  callerToken: string;
  callerTokenExpiresAt: Date;
  status: IncidentStatus;
  hasConflict: boolean;
  confidenceIndex: number;
}

/**
 * Wires submitCallerReport() (mints incident id + rescue code + one-time
 * token) and resolveLocation() (turns the caller's single location capture
 * into the incident's first LocationResolution) into one transaction, since
 * the P0 golden path's caller screen always captures a location BEFORE
 * submitting (QR anchor scan or GPS) — there is no "report with no location
 * yet" state in this UI, unlike a phone call where the call-taker starts
 * with nothing.
 *
 * On a genuine rescue-code/token collision (astronomically unlikely — see
 * rescue-code.ts's alphabet/checksum design) this retries the whole
 * gatekeeper call with fresh randomness rather than surfacing a raw
 * Postgres unique-violation to the caller.
 */
export async function createIncidentFromCallerReport(
  input: CreateIncidentFromCallerReportInput
): Promise<CreateIncidentFromCallerReportResult> {
  const now = input.now ?? new Date();
  const MAX_RETRIES = 3;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await withTransaction(async (client) => {
        const reportInput: SubmitCallerReportInput = {
          language: input.language,
          unableToSpeak: input.unableToSpeak,
          description: input.description,
          callerName: input.callerName,
          callerPhone: input.callerPhone,
          now,
        };
        const report = submitCallerReport(reportInput);

        let observationInput: NewLocationObservationInput;
        if (input.location.type === 'ANCHOR') {
          observationInput = await resolveAnchorToObservation(
            new PgAnchorLookup(client),
            input.location.anchorCode,
            report.incidentId,
            now
          );
        } else {
          observationInput = buildObservationFromDeviceInput({
            incidentId: report.incidentId,
            source: 'BROWSER_GPS',
            latitude: input.location.latitude,
            longitude: input.location.longitude,
            horizontalAccuracyMeters: input.location.horizontalAccuracyMeters,
            capturedAt: now,
          });
        }

        const observationId = randomUUID();
        const entranceRows = await client.query(
          `SELECT id, latitude, longitude FROM "Entrance" WHERE active = true`
        );
        const entranceCandidates: EntranceCandidate[] = entranceRows.rows.map((e) => ({
          id: e.id,
          latitude: Number(e.latitude),
          longitude: Number(e.longitude),
        }));

        const resolverObservation: ObservationForResolution = {
          id: observationId,
          source: observationInput.source,
          latitude: observationInput.latitude,
          longitude: observationInput.longitude,
          horizontalAccuracyMeters: observationInput.horizontalAccuracyMeters,
          floorLevel: observationInput.floorLevel,
          capturedAt: observationInput.capturedAt,
        };
        const resolution = resolveLocation({ observations: [resolverObservation], entrances: entranceCandidates, now });

        const incidentTransition = transition({ from: 'NEW', to: 'VERIFYING' });
        const h3Index = latLngToH3Cell({ latitude: resolution.latitude, longitude: resolution.longitude });

        await client.query(
          `INSERT INTO "Incident"
             (id, "rescueCode", "callerTokenHash", "callerTokenExpiresAt", status,
              latitude, longitude, "gpsAccuracyMeters", "locationCapturedAt",
              "uncertaintyRadiusMeters", "confidenceScore", "confidenceVersion",
              "floorLevel", language, "unableToSpeak", "callerName", "callerPhone", description,
              "suggestedEntranceId", "h3Index", synthetic, "createdAt", "updatedAt")
           VALUES ($1,$2,$3,$4,$5::"IncidentStatus",$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,true,$21,$22)`,
          [
            report.incidentId,
            report.rescueCode,
            report.callerTokenHash,
            report.callerTokenExpiresAt,
            incidentTransition.to,
            resolution.latitude,
            resolution.longitude,
            observationInput.horizontalAccuracyMeters ?? null,
            now,
            resolution.uncertaintyRadiusMeters,
            resolution.confidenceIndex,
            resolution.algorithmVersion,
            resolution.floorLevel ?? null,
            report.language,
            report.unableToSpeak,
            report.callerName ?? null,
            report.callerPhone ?? null,
            report.description ?? null,
            resolution.selectedEntranceId ?? null,
            h3Index,
            now,
            now,
          ]
        );

        await client.query(
          `INSERT INTO "LocationObservation"
             (id, "incidentId", source, latitude, longitude, "horizontalAccuracyMeters",
              "floorLevel", "capturedAt", "provenanceLabel", metadata, synthetic)
           VALUES ($1,$2,$3::"LocationObservationSource",$4,$5,$6,$7,$8,$9,$10::jsonb,true)`,
          [
            observationId,
            report.incidentId,
            observationInput.source,
            observationInput.latitude,
            observationInput.longitude,
            observationInput.horizontalAccuracyMeters ?? null,
            observationInput.floorLevel ?? null,
            observationInput.capturedAt,
            observationInput.provenanceLabel,
            JSON.stringify(observationInput.metadata),
          ]
        );

        await client.query(
          `INSERT INTO "LocationResolution"
             (id, "incidentId", latitude, longitude, "uncertaintyRadiusMeters", "confidenceIndex",
              "primaryObservationId", "supportingObservationIds", "conflictingObservationIds",
              "selectedEntranceId", "floorLevel", "algorithmVersion", "createdAt")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13)`,
          [
            randomUUID(),
            report.incidentId,
            resolution.latitude,
            resolution.longitude,
            resolution.uncertaintyRadiusMeters,
            resolution.confidenceIndex,
            resolution.primaryObservationId,
            JSON.stringify(resolution.supportingObservationIds),
            JSON.stringify(resolution.conflictingObservationIds),
            resolution.selectedEntranceId ?? null,
            resolution.floorLevel ?? null,
            resolution.algorithmVersion,
            now,
          ]
        );

        await insertIncidentEvent(client, {
          incidentId: report.incidentId,
          actorType: 'CALLER',
          eventType: 'CREATED',
          nextStatus: 'NEW',
          createdAt: now,
        });
        await insertIncidentEvent(client, {
          incidentId: report.incidentId,
          actorType: 'SYSTEM',
          eventType: 'STATUS_TRANSITION',
          previousStatus: 'NEW',
          nextStatus: incidentTransition.to,
          metadata: { reason: 'initial location captured at intake' },
          createdAt: now,
        });
        await insertAuditLog(client, {
          action: 'SUBMIT_CALLER_REPORT',
          entityType: 'Incident',
          entityId: report.incidentId,
          after: { status: incidentTransition.to, rescueCode: report.rescueCode },
        });

        return {
          incidentId: report.incidentId,
          rescueCode: report.rescueCode,
          callerToken: report.callerToken,
          callerTokenExpiresAt: report.callerTokenExpiresAt,
          status: incidentTransition.to,
          hasConflict: resolution.hasConflict,
          confidenceIndex: resolution.confidenceIndex,
        };
      });
    } catch (err) {
      if (isUniqueViolation(err) && attempt < MAX_RETRIES) continue;
      throw err;
    }
  }
  throw new Error('createIncidentFromCallerReport: exhausted retries on unique-constraint collision');
}

export { MissingLanguageError, AnchorNotFoundError, AnchorNotActiveError };

/** Caller-facing status poll — verifies the presented raw token against the stored hash before revealing anything, since the token (not RBAC) is this incident's entire access control for the CALLER role. */
export async function getCallerIncidentView(
  incidentId: string,
  rawToken: string
): Promise<{ id: string; rescueCode: string; status: IncidentStatus } | null> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT id, "rescueCode", status, "callerTokenHash", "callerTokenExpiresAt" FROM "Incident" WHERE id = $1`,
    [incidentId]
  );
  const row = result.rows[0];
  if (!row) return null;
  if (row.callerTokenHash !== hashCallerToken(rawToken)) return null;
  if (new Date(row.callerTokenExpiresAt).getTime() < Date.now()) return null;
  return { id: row.id, rescueCode: row.rescueCode, status: row.status };
}

// ---------------------------------------------------------------------------
// Call-taker / supervisor operations
// ---------------------------------------------------------------------------

const OPERATIONAL_STATUSES: IncidentStatus[] = [
  'VERIFYING',
  'LOW_CONFIDENCE',
  'READY_FOR_DECISION',
  'NO_UNIT_AVAILABLE',
  'DISPATCHED',
  'EN_ROUTE',
  'ACCESS_BLOCKED',
  'AT_ACCESS_POINT',
  'ON_SCENE',
];

export async function listOperationalIncidents() {
  const pool = getPool();
  const result = await pool.query(
    `SELECT id, "rescueCode", status, latitude, longitude, "uncertaintyRadiusMeters", "confidenceScore",
            language, "unableToSpeak", "callerName", "callerPhone", description, "floorLevel",
            "suggestedEntranceId", "assignedEntranceId", "assignedUnitId", "createdAt", "updatedAt"
     FROM "Incident" WHERE status = ANY($1::"IncidentStatus"[]) ORDER BY "createdAt" DESC`,
    [OPERATIONAL_STATUSES]
  );
  return result.rows.map((r) => ({ ...r, latitude: Number(r.latitude), longitude: Number(r.longitude) }));
}

export async function getIncidentDetail(incidentId: string) {
  const pool = getPool();
  const incidentResult = await pool.query(`SELECT * FROM "Incident" WHERE id = $1`, [incidentId]);
  const incident = incidentResult.rows[0];
  if (!incident) return null;

  const [observations, resolutions, recommendations, fieldActions] = await Promise.all([
    pool.query(`SELECT * FROM "LocationObservation" WHERE "incidentId" = $1 ORDER BY "capturedAt" ASC`, [incidentId]),
    pool.query(`SELECT * FROM "LocationResolution" WHERE "incidentId" = $1 ORDER BY "createdAt" DESC`, [incidentId]),
    pool.query(`SELECT * FROM "Recommendation" WHERE "incidentId" = $1 ORDER BY "createdAt" DESC`, [incidentId]),
    pool.query(`SELECT * FROM "FieldAction" WHERE "incidentId" = $1 ORDER BY "submittedAt" ASC`, [incidentId]),
  ]);

  return {
    incident: { ...incident, latitude: Number(incident.latitude), longitude: Number(incident.longitude) },
    observations: observations.rows.map((o) => ({ ...o, latitude: Number(o.latitude), longitude: Number(o.longitude) })),
    resolutions: resolutions.rows.map((r) => ({ ...r, latitude: Number(r.latitude), longitude: Number(r.longitude) })),
    recommendations: recommendations.rows,
    fieldActions: fieldActions.rows,
  };
}

export interface AddObservationInput {
  incidentId: string;
  source: Extract<LocationObservationSource, 'BROWSER_GPS' | 'MANUAL_PIN' | 'CALL_TAKER'>;
  latitude: number;
  longitude: number;
  horizontalAccuracyMeters?: number;
  floorLevel?: string;
  now?: Date;
}

/**
 * A call-taker/supervisor adding a second (or third) observation to an
 * incident already in progress — e.g. "the caller says they're actually at
 * the north gate", entered as a CALL_TAKER-sourced point. Re-runs
 * resolveLocation() over EVERY observation gathered so far (not just the
 * new one), exactly like resolver.ts's own header note describes: a new
 * LocationResolution row is always a full re-resolution, never a patch.
 */
export async function addObservationAndResolve(input: AddObservationInput) {
  const now = input.now ?? new Date();
  return withTransaction(async (client) => {
    const observationId = randomUUID();
    await client.query(
      `INSERT INTO "LocationObservation"
         (id, "incidentId", source, latitude, longitude, "horizontalAccuracyMeters", "floorLevel", "capturedAt", "provenanceLabel", metadata, synthetic)
       VALUES ($1,$2,$3::"LocationObservationSource",$4,$5,$6,$7,$8,$9,$10::jsonb,true)`,
      [
        observationId,
        input.incidentId,
        input.source,
        input.latitude,
        input.longitude,
        input.horizontalAccuracyMeters ?? null,
        input.floorLevel ?? null,
        now,
        input.source === 'CALL_TAKER' ? 'Call-taker entered location' : 'Manually placed pin',
        JSON.stringify({ coordinateAuthority: input.source === 'BROWSER_GPS' ? 'CALLER_DEVICE' : 'OPERATOR_ENTERED' }),
      ]
    );

    const [existingObsResult, entranceRows] = await Promise.all([
      client.query(`SELECT * FROM "LocationObservation" WHERE "incidentId" = $1`, [input.incidentId]),
      client.query(`SELECT id, latitude, longitude FROM "Entrance" WHERE active = true`),
    ]);
    const observations: ObservationForResolution[] = existingObsResult.rows.map((o) => ({
      id: o.id,
      source: o.source,
      latitude: Number(o.latitude),
      longitude: Number(o.longitude),
      horizontalAccuracyMeters: o.horizontalAccuracyMeters,
      floorLevel: o.floorLevel,
      capturedAt: o.capturedAt,
    }));
    const entrances: EntranceCandidate[] = entranceRows.rows.map((e) => ({
      id: e.id,
      latitude: Number(e.latitude),
      longitude: Number(e.longitude),
    }));

    const resolution = resolveLocation({ observations, entrances, now });
    const h3Index = latLngToH3Cell({ latitude: resolution.latitude, longitude: resolution.longitude });

    await client.query(
      `INSERT INTO "LocationResolution"
         (id, "incidentId", latitude, longitude, "uncertaintyRadiusMeters", "confidenceIndex",
          "primaryObservationId", "supportingObservationIds", "conflictingObservationIds",
          "selectedEntranceId", "floorLevel", "algorithmVersion", "createdAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13)`,
      [
        randomUUID(),
        input.incidentId,
        resolution.latitude,
        resolution.longitude,
        resolution.uncertaintyRadiusMeters,
        resolution.confidenceIndex,
        resolution.primaryObservationId,
        JSON.stringify(resolution.supportingObservationIds),
        JSON.stringify(resolution.conflictingObservationIds),
        resolution.selectedEntranceId ?? null,
        resolution.floorLevel ?? null,
        resolution.algorithmVersion,
        now,
      ]
    );

    await client.query(
      `UPDATE "Incident" SET latitude=$1, longitude=$2, "uncertaintyRadiusMeters"=$3, "confidenceScore"=$4,
         "confidenceVersion"=$5, "floorLevel"=$6, "suggestedEntranceId"=$7, "h3Index"=$8, "updatedAt"=$9
       WHERE id=$10`,
      [
        resolution.latitude,
        resolution.longitude,
        resolution.uncertaintyRadiusMeters,
        resolution.confidenceIndex,
        resolution.algorithmVersion,
        resolution.floorLevel ?? null,
        resolution.selectedEntranceId ?? null,
        h3Index,
        now,
        input.incidentId,
      ]
    );

    await insertIncidentEvent(client, {
      incidentId: input.incidentId,
      actorType: 'CALL_TAKER',
      eventType: 'LOCATION_UPDATED',
      metadata: { hasConflict: resolution.hasConflict, reasoning: resolution.reasoning },
      createdAt: now,
    });
    await insertAuditLog(client, {
      action: 'ADD_LOCATION_OBSERVATION',
      entityType: 'Incident',
      entityId: input.incidentId,
      after: { source: input.source, hasConflict: resolution.hasConflict },
    });

    return resolution;
  });
}

/** RBAC's CONFIRM_LOCATION action (CALL_TAKER/SUPERVISOR) — VERIFYING -> READY_FOR_DECISION. Route handlers must call assertCanPerformAction(viewer.role, 'CONFIRM_LOCATION') before this. */
export async function confirmIncidentLocation(incidentId: string, actorId: string, now: Date = new Date()) {
  return withTransaction(async (client) => {
    const result = await client.query(`SELECT status FROM "Incident" WHERE id = $1 FOR UPDATE`, [incidentId]);
    const row = result.rows[0];
    if (!row) throw new Error(`confirmIncidentLocation: no incident "${incidentId}"`);

    const incidentTransition = transition({ from: row.status, to: 'READY_FOR_DECISION' });

    await client.query(`UPDATE "Incident" SET status=$1::"IncidentStatus", "updatedAt"=$2 WHERE id=$3`, [
      incidentTransition.to,
      now,
      incidentId,
    ]);
    await insertIncidentEvent(client, {
      incidentId,
      actorType: 'CALL_TAKER',
      actorId,
      eventType: 'STATUS_TRANSITION',
      previousStatus: incidentTransition.from,
      nextStatus: incidentTransition.to,
      createdAt: now,
    });
    await insertAuditLog(client, {
      actorId,
      action: 'CONFIRM_LOCATION',
      entityType: 'Incident',
      entityId: incidentId,
      after: { status: incidentTransition.to },
    });
    return incidentTransition;
  });
}

// ---------------------------------------------------------------------------
// Supervisor: coverage-aware recommendation + dispatch decision (C4 + C6)
// ---------------------------------------------------------------------------

async function fetchAvailableUnitsForAssignment(client: PoolClient, excludingIncidentId?: string): Promise<UnitCandidateInput[]> {
  const unitsResult = await client.query(
    `SELECT u.id, u."readinessScore", ul.latitude, ul.longitude
     FROM "AmbulanceUnit" u
     LEFT JOIN LATERAL (
       SELECT latitude, longitude FROM "UnitLocation" WHERE "unitId" = u.id ORDER BY "capturedAt" DESC LIMIT 1
     ) ul ON true
     WHERE u.status = 'AVAILABLE'
       AND NOT EXISTS (
         SELECT 1 FROM "Incident" i
         WHERE i."assignedUnitId" = u.id
           AND i.status NOT IN ('CLOSED','CANCELLED_BY_OPERATOR')
           AND ($1::text IS NULL OR i.id <> $1)
       )`,
    [excludingIncidentId ?? null]
  );
  return unitsResult.rows
    .filter((u) => u.latitude != null && u.longitude != null)
    .map((u) => ({
      id: u.id,
      readinessScore: u.readinessScore,
      location: { latitude: Number(u.latitude), longitude: Number(u.longitude) },
    }));
}

async function fetchCandidateEntrances(client: PoolClient): Promise<EntranceCandidateInput[]> {
  const result = await client.query(
    `SELECT id, latitude, longitude, "vehicleStopLatitude", "vehicleStopLongitude", active,
            "validationStatus", "vehicleAccessible", "pedestrianAccessible", "isServiceGate",
            "temporaryRestriction", "floorLevel", "hasElevator"
     FROM "Entrance" WHERE active = true`
  );
  return result.rows.map((e) => ({
    id: e.id,
    latitude: Number(e.latitude),
    longitude: Number(e.longitude),
    vehicleStopLatitude: e.vehicleStopLatitude != null ? Number(e.vehicleStopLatitude) : null,
    vehicleStopLongitude: e.vehicleStopLongitude != null ? Number(e.vehicleStopLongitude) : null,
    active: e.active,
    validationStatus: e.validationStatus,
    vehicleAccessible: e.vehicleAccessible,
    pedestrianAccessible: e.pedestrianAccessible,
    isServiceGate: e.isServiceGate,
    temporaryRestriction: e.temporaryRestriction,
    floorLevel: e.floorLevel,
    hasElevator: e.hasElevator,
  }));
}

export class NoAvailableUnitsForRecommendationError extends Error {
  constructor(public readonly incidentId: string) {
    super(`No AVAILABLE units (with a known location) to recommend for incident "${incidentId}"`);
    this.name = 'NoAvailableUnitsForRecommendationError';
  }
}

/**
 * Generates a fresh coverage-aware recommendation for a READY_FOR_DECISION
 * incident and persists it — one RouteSnapshot row per (unit, entrance)
 * candidate considered plus one Recommendation row for the top pick,
 * mirroring scripts/seed-demo.ts's buildCoverageAwareRecommendationFixture()
 * INSERT shape exactly. Returns the full result (including coverageBefore/
 * coverageAfter) so the supervisor screen can render the "before vs after"
 * comparison spec 29.4 calls for without a second round-trip.
 */
export async function generateRecommendationForIncident(incidentId: string, now: Date = new Date()) {
  return withTransaction(async (client) => {
    const incidentResult = await client.query(
      `SELECT id, status, "confidenceScore", "floorLevel" FROM "Incident" WHERE id = $1 FOR UPDATE`,
      [incidentId]
    );
    const incident = incidentResult.rows[0];
    if (!incident) throw new Error(`generateRecommendationForIncident: no incident "${incidentId}"`);

    const [availableUnits, candidateEntrances] = await Promise.all([
      fetchAvailableUnitsForAssignment(client, incidentId),
      fetchCandidateEntrances(client),
    ]);
    if (availableUnits.length === 0) throw new NoAvailableUnitsForRecommendationError(incidentId);

    const routingProvider = new MockRoutingProvider(() => now);
    const result = await generateCoverageAwareRecommendation({
      incidentId,
      locationConfidenceIndex: incident.confidenceScore ?? 50,
      resolvedFloorLevel: incident.floorLevel,
      availableUnits,
      candidateEntrances,
      coverageCells: buildLiveCoverageGridCells(),
      routingProvider,
    });

    for (const route of result.routeSnapshots) {
      await client.query(
        `INSERT INTO "RouteSnapshot"
           (id, "incidentId", "unitId", "entranceId", provider, "providerMode", "distanceMeters", "durationSeconds", geometry, "dataFreshnessAt", synthetic)
         VALUES ($1,$2,$3,$4,$5,$6::"RoutingProviderMode",$7,$8,$9::jsonb,$10,true)`,
        [
          randomUUID(),
          incidentId,
          route.unitId,
          route.entranceId,
          route.provider,
          route.providerMode,
          route.totalDistanceMeters,
          route.totalDurationSeconds,
          JSON.stringify({ vehicle: route.vehicleGeometry, pedestrian: route.pedestrianGeometry }),
          route.dataFreshnessAt,
        ]
      );
    }

    const topCandidate = result.candidates.find(
      (c) => c.unitId === result.recommendedUnitId && c.entranceId === result.recommendedEntranceId
    );
    const recommendationId = randomUUID();
    await client.query(
      `INSERT INTO "Recommendation"
         (id, "incidentId", "algorithmVersion", "recommendedUnitId", "alternativeUnitId",
          "recommendedEntranceId", "alternativeEntranceId", "accessScore", "confidenceScore",
          reasoning, "scoreBreakdown", synthetic, "createdAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,true,$12)`,
      [
        recommendationId,
        incidentId,
        DISPATCH_SCORE_VERSION,
        result.recommendedUnitId,
        result.alternativeUnitId,
        result.recommendedEntranceId,
        result.alternativeEntranceId,
        result.dispatchScore,
        result.confidenceScore,
        JSON.stringify(result.reasoning),
        JSON.stringify(topCandidate?.breakdown ?? {}),
        now,
      ]
    );

    await insertAuditLog(client, {
      action: 'GENERATE_RECOMMENDATION',
      entityType: 'Incident',
      entityId: incidentId,
      after: { recommendationId, recommendedUnitId: result.recommendedUnitId, dispatchScore: result.dispatchScore },
    });

    return { recommendationId, ...result };
  });
}

export class RecommendationNotFoundError extends Error {
  constructor(public readonly recommendationId: string) {
    super(`No Recommendation "${recommendationId}"`);
    this.name = 'RecommendationNotFoundError';
  }
}

export interface DecideDispatchForIncidentInput {
  incidentId: string;
  recommendationId: string;
  chosenUnitId: string;
  chosenEntranceId: string;
  decidedById: string;
  overrideReason?: string;
  now?: Date;
}

/**
 * Persists a supervisor's dispatch decision: re-validates via
 * decideDispatch() (fresh unit status + double-booking check, both read
 * inside THIS transaction so they cannot be stale), then updates Incident,
 * AmbulanceUnit (-> BUSY, see this file's header), and the Recommendation
 * row it is deciding on, plus the IncidentEvent/AuditLog trail.
 */
export async function decideDispatchForIncident(input: DecideDispatchForIncidentInput) {
  const now = input.now ?? new Date();
  return withTransaction(async (client) => {
    const [incidentResult, recommendationResult] = await Promise.all([
      client.query(`SELECT id, status FROM "Incident" WHERE id = $1 FOR UPDATE`, [input.incidentId]),
      client.query(`SELECT * FROM "Recommendation" WHERE id = $1`, [input.recommendationId]),
    ]);
    const incident = incidentResult.rows[0];
    if (!incident) throw new Error(`decideDispatchForIncident: no incident "${input.incidentId}"`);
    const recommendation = recommendationResult.rows[0];
    if (!recommendation) throw new RecommendationNotFoundError(input.recommendationId);

    const unitResult = await client.query(`SELECT id, status FROM "AmbulanceUnit" WHERE id = $1 FOR UPDATE`, [
      input.chosenUnitId,
    ]);
    const unitRow = unitResult.rows[0];
    if (!unitRow) throw new Error(`decideDispatchForIncident: no unit "${input.chosenUnitId}"`);

    const otherAssignmentResult = await client.query(
      `SELECT 1 FROM "Incident" WHERE "assignedUnitId" = $1 AND status NOT IN ('CLOSED','CANCELLED_BY_OPERATOR') AND id <> $2 LIMIT 1`,
      [input.chosenUnitId, input.incidentId]
    );
    const chosenUnit: FreshUnitStatus = {
      id: unitRow.id,
      status: unitRow.status,
      hasOtherActiveIncidentAssigned: otherAssignmentResult.rows.length > 0,
    };

    const decision = decideDispatch({
      incidentStatus: incident.status,
      recommendedUnitId: recommendation.recommendedUnitId,
      recommendedEntranceId: recommendation.recommendedEntranceId,
      chosenUnitId: input.chosenUnitId,
      chosenEntranceId: input.chosenEntranceId,
      chosenUnit,
      decidedById: input.decidedById,
      overrideReason: input.overrideReason,
    });

    await client.query(
      `UPDATE "Incident" SET status=$1::"IncidentStatus", "assignedUnitId"=$2, "assignedEntranceId"=$3, "updatedAt"=$4 WHERE id=$5`,
      [decision.incidentTransition.to, decision.assignedUnitId, decision.assignedEntranceId, now, input.incidentId]
    );
    await client.query(`UPDATE "AmbulanceUnit" SET status='BUSY', "updatedAt"=$1 WHERE id=$2`, [now, decision.assignedUnitId]);
    await client.query(
      `UPDATE "Recommendation" SET "acceptedById"=$1, "acceptedAt"=$2, "overrideReason"=$3 WHERE id=$4`,
      [decision.decidedById, now, decision.overrideReason ?? null, input.recommendationId]
    );

    await insertIncidentEvent(client, {
      incidentId: input.incidentId,
      actorType: 'SUPERVISOR',
      actorId: input.decidedById,
      eventType: 'UNIT_ASSIGNED',
      previousStatus: decision.incidentTransition.from,
      nextStatus: decision.incidentTransition.to,
      metadata: { recommendationId: input.recommendationId, assignedUnitId: decision.assignedUnitId, assignedEntranceId: decision.assignedEntranceId },
      createdAt: now,
    });
    if (decision.wasOverride) {
      await insertIncidentEvent(client, {
        incidentId: input.incidentId,
        actorType: 'SUPERVISOR',
        actorId: input.decidedById,
        eventType: 'RECOMMENDATION_OVERRIDDEN',
        overrideReason: decision.overrideReason,
        metadata: { recommendedUnitId: recommendation.recommendedUnitId, chosenUnitId: input.chosenUnitId },
        createdAt: now,
      } as never);
    }
    await insertAuditLog(client, {
      actorId: input.decidedById,
      action: 'DECIDE_DISPATCH',
      entityType: 'Incident',
      entityId: input.incidentId,
      after: { assignedUnitId: decision.assignedUnitId, assignedEntranceId: decision.assignedEntranceId, wasOverride: decision.wasOverride },
    });

    return decision;
  });
}

// ---------------------------------------------------------------------------
// Medic FieldLink (C5)
// ---------------------------------------------------------------------------

const FIELD_ACTION_EVENT_TYPE: Partial<Record<FieldActionType, string>> = {
  START_MOVING: 'EN_ROUTE',
  AT_ACCESS_POINT: 'AT_ACCESS_POINT',
  ON_SCENE: 'ON_SCENE',
  ACCESS_BLOCKED: 'ACCESS_BLOCKED',
  CLOSE_TASK: 'CLOSED',
};

export interface SubmitFieldActionForUnitInput {
  incidentId: string;
  unitId: string;
  actorId: string;
  actionType: FieldActionType;
  idempotencyKey: string;
  payload?: Record<string, unknown>;
  submittedAt?: Date;
  now?: Date;
}

export async function submitFieldActionForUnit(input: SubmitFieldActionForUnitInput) {
  const now = input.now ?? new Date();
  const submittedAt = input.submittedAt ?? now;
  return withTransaction(async (client) => {
    const incidentResult = await client.query(`SELECT status, "assignedUnitId" FROM "Incident" WHERE id = $1 FOR UPDATE`, [
      input.incidentId,
    ]);
    const incident = incidentResult.rows[0];
    if (!incident) throw new Error(`submitFieldActionForUnit: no incident "${input.incidentId}"`);

    const existingResult = await client.query(
      `SELECT "idempotencyKey", "actionType" FROM "FieldAction" WHERE "incidentId" = $1`,
      [input.incidentId]
    );
    const existingActionsForIncident: ExistingFieldActionRef[] = existingResult.rows;

    const result = submitFieldAction({
      incidentId: input.incidentId,
      unitId: input.unitId,
      actorId: input.actorId,
      actionType: input.actionType,
      idempotencyKey: input.idempotencyKey,
      incidentStatus: incident.status,
      assignedUnitId: incident.assignedUnitId,
      payload: input.payload,
      existingActionsForIncident,
      submittedAt,
      now,
    });

    if (result.duplicate) {
      return { duplicate: true as const };
    }

    const fieldActionId = randomUUID();
    await client.query(
      `INSERT INTO "FieldAction"
         (id, "incidentId", "unitId", "actorId", "actionType", "idempotencyKey", payload, "previousStatus", "resultingStatus", "submittedAt", "processedAt", synthetic)
       VALUES ($1,$2,$3,$4,$5::"FieldActionType",$6,$7::jsonb,$8::"IncidentStatus",$9::"IncidentStatus",$10,$11,true)`,
      [
        fieldActionId,
        input.incidentId,
        input.unitId,
        input.actorId,
        result.action.actionType,
        result.action.idempotencyKey,
        result.action.payload !== null ? JSON.stringify(result.action.payload) : null,
        result.action.previousStatus,
        result.action.resultingStatus,
        result.action.submittedAt,
        result.action.processedAt,
      ]
    );

    if (result.incidentTransition) {
      const closedAt = result.incidentTransition.to === 'CLOSED' ? now : null;
      await client.query(
        `UPDATE "Incident" SET status=$1::"IncidentStatus", "updatedAt"=$2, "closedAt"=COALESCE($3, "closedAt") WHERE id=$4`,
        [result.incidentTransition.to, now, closedAt, input.incidentId]
      );
      // See this file's header: the repo layer (not submitFieldAction()
      // itself) is what frees a unit back up once its incident closes,
      // symmetric with decideDispatchForIncident() setting it BUSY.
      if (result.incidentTransition.to === 'CLOSED') {
        await client.query(`UPDATE "AmbulanceUnit" SET status='AVAILABLE', "updatedAt"=$1 WHERE id=$2`, [now, input.unitId]);
      }

      const eventType = FIELD_ACTION_EVENT_TYPE[input.actionType];
      if (eventType) {
        await insertIncidentEvent(client, {
          incidentId: input.incidentId,
          actorType: 'MEDIC',
          actorId: input.actorId,
          eventType,
          previousStatus: result.incidentTransition.from,
          nextStatus: result.incidentTransition.to,
          createdAt: now,
        });
      }
    }

    await insertAuditLog(client, {
      actorId: input.actorId,
      action: `FIELD_ACTION_${input.actionType}`,
      entityType: 'Incident',
      entityId: input.incidentId,
      after: { resultingStatus: result.action.resultingStatus },
    });

    return { duplicate: false as const, action: result.action, incidentTransition: result.incidentTransition };
  });
}

export async function getAssignedIncidentForUnit(unitId: string) {
  const pool = getPool();
  const result = await pool.query(
    `SELECT * FROM "Incident" WHERE "assignedUnitId" = $1 AND status NOT IN ('CLOSED','CANCELLED_BY_OPERATOR') ORDER BY "updatedAt" DESC LIMIT 1`,
    [unitId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return { ...row, latitude: Number(row.latitude), longitude: Number(row.longitude) };
}

export async function listUnitsForDemoPicker() {
  const pool = getPool();
  const result = await pool.query(
    `SELECT id, code, label, "crewType", status FROM "AmbulanceUnit" ORDER BY code ASC`
  );
  return result.rows;
}

/**
 * Same unit list as listUnitsForDemoPicker(), plus each unit's most recent
 * UnitLocation (latitude/longitude), for the operations map (C7 prototype —
 * see docs/product idea doc §4.1). Kept as a separate function rather than
 * changing listUnitsForDemoPicker()'s shape, since the role-switcher picker
 * that calls the latter has no use for coordinates and every extra JOIN
 * there would be pure waste on a hot path (fires on every role switch).
 * LATERAL join picks each unit's latest UnitLocation row by capturedAt,
 * same "most recent position" contract as fetchAvailableUnitsForAssignment().
 */
export async function listUnitsWithLastLocation() {
  const pool = getPool();
  const result = await pool.query(
    `SELECT u.id, u.code, u.label, u."crewType", u.status, ul.latitude, ul.longitude
     FROM "AmbulanceUnit" u
     LEFT JOIN LATERAL (
       SELECT latitude, longitude FROM "UnitLocation"
       WHERE "unitId" = u.id ORDER BY "capturedAt" DESC LIMIT 1
     ) ul ON true
     ORDER BY u.code ASC`
  );
  return result.rows;
}

// ---------------------------------------------------------------------------
// Rescue Anchors (printable QR list — spec 29.1)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Demo reset (DEMO_MODE-gated — see app/api/demo/reset/route.ts, which
// calls assertDemoModeEnabled() before ever reaching this function)
// ---------------------------------------------------------------------------

/**
 * Wipes every row a live web-UI walkthrough could have created —
 * "Incident" cascades (via onDelete: Cascade FKs, see prisma/schema.prisma)
 * to IncidentEvent/LocationObservation/LocationResolution/RouteSnapshot/
 * Recommendation/FieldAction, so one TRUNCATE clears the whole live-demo
 * trail in one statement. Also puts every AmbulanceUnit back to AVAILABLE
 * — not necessarily the exact 60/30/10 split scripts/seed-demo.ts's own
 * random seeding produces, but the correct state for "nothing is
 * dispatched right now", which is what a reset button should guarantee
 * before scripts/seed-demo.ts re-runs and re-establishes its own fixture
 * distribution on top. TRUNCATE (not DELETE) is safe against
 * LocationObservation/FieldAction's append-only BEFORE UPDATE OR DELETE
 * triggers — same reasoning as seed-demo.ts's own header comment on this
 * exact point.
 */
export async function truncateLiveIncidentData(): Promise<void> {
  const pool = getPool();
  await pool.query('TRUNCATE TABLE "Incident" CASCADE');
  await pool.query('TRUNCATE TABLE "H3Prediction"');
  await pool.query(`UPDATE "AmbulanceUnit" SET status = 'AVAILABLE'`);
}

/** Basic id/code/name lookup for every active Entrance — used by the operations screen to render a human-readable label next to a Recommendation's bare recommendedEntranceId/alternativeEntranceId, same reasoning as listUnitsForDemoPicker() for unit ids. */
export async function listEntrancesBasic() {
  const pool = getPool();
  const result = await pool.query(
    `SELECT id, code, "nameAr", "nameEn", zone, latitude, longitude FROM "Entrance" WHERE active = true ORDER BY code ASC`
  );
  return result.rows;
}

export async function listActiveAnchors() {
  const pool = getPool();
  const result = await pool.query(
    `SELECT a.id, a.code, a."entranceId", a."floorLevel", a."anchorType", e."nameAr", e."nameEn"
     FROM "LocationAnchor" a JOIN "Entrance" e ON e.id = a."entranceId"
     WHERE a.active = true ORDER BY e."nameEn" ASC, a.code ASC`
  );
  return result.rows;
}
