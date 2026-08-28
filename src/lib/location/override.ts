/**
 * overrideLocation() — spec 29.2/C4: a call-taker or supervisor correcting
 * an incident's location. Two rules this function exists to make
 * structurally true, not just conventionally true:
 *
 *   1. "اعتماد الموقع أو تغييره بسبب إلزامي" — changing the location
 *      requires a reason. Enforced here with the SAME
 *      `MIN_OVERRIDE_REASON_LENGTH` threshold as the incident state
 *      machine's cancellation-reason check and C4's dispatch-decision
 *      override reason, so "what counts as a real reason" is one answer
 *      project-wide, not three slightly different ones.
 *   2. "كل override ينشئ Observation وLocationResolution جديدين" — an
 *      override NEVER edits history. This function does not accept an
 *      existing observation/resolution id to modify; it only ever BUILDS a
 *      new observation and re-runs the real `resolveLocation()` algorithm
 *      (from C3) over the full observation history plus the new one. There
 *      is no shortcut here that hardcodes a confidence value or a canned
 *      "reasoning" array — the override's observation goes through the
 *      exact same trust-hierarchy scoring every other observation gets
 *      (rejected as a shortcut after finding it in an independent AI's
 *      attempt at this same phase — see docs/product for the comparison
 *      notes).
 *
 * Pure function: does not touch a database. Returns the new observation to
 * insert and the new resolution to insert; the caller's repository layer
 * persists both inside a transaction (never an UPDATE — see
 * `LocationObservation`/`LocationResolution`'s append-only DB triggers
 * from the C3 migration, which would reject an UPDATE outright anyway).
 *
 * IMPORTANT: an override does NOT automatically become the resolution's
 * new primary point. It is fed into the same `resolveLocation()` priority
 * ranking as every other observation (CALL_TAKER ranks below ANCHOR_QR and
 * MANUAL_PIN — see resolver.ts's `SOURCE_PRIORITY` table and its own
 * rationale). If the override conflicts with a higher-priority existing
 * observation (e.g. a scanned Rescue Anchor), the CONFLICT is what gets
 * surfaced in the returned resolution's `hasConflict`/
 * `conflictingObservationIds` — not a silent "override always wins". This
 * is deliberate, not an oversight: spec 29.2 rule #3 requires conflicts be
 * shown to the call-taker, never resolved silently, and a human override
 * that happens to disagree with a physically-verified anchor scan is
 * exactly the kind of disagreement that rule exists to surface rather than
 * paper over.
 */
import { MIN_OVERRIDE_REASON_LENGTH } from '@/lib/incidents/state-machine';
import { resolveLocation, type EntranceCandidate, type ObservationForResolution, type ResolveLocationResult } from './resolver';
import type { LocationObservationSource } from '@/lib/domain/types';

export class MissingLocationOverrideReasonError extends Error {
  constructor() {
    super(`overrideLocation: a reason of at least ${MIN_OVERRIDE_REASON_LENGTH} characters is required`);
    this.name = 'MissingLocationOverrideReasonError';
  }
}

export class MissingOverriddenByError extends Error {
  constructor() {
    super('overrideLocation: overriddenById is required — there is no unattended location override path');
    this.name = 'MissingOverriddenByError';
  }
}

export interface NewOverrideObservationInput {
  latitude: number;
  longitude: number;
  horizontalAccuracyMeters?: number;
  floorLevel?: string;
  capturedAt: Date;
}

export interface OverrideLocationInput {
  incidentId: string;
  /** Caller-generated id for the new observation (e.g. `crypto.randomUUID()`) — needed up front because `resolveLocation()` tracks observations by id, before any row is actually inserted. */
  newObservationId: string;
  overriddenById: string;
  reason: string;
  newObservation: NewOverrideObservationInput;
  /** Full existing observation history for this incident — the new observation is merged into this set, never replaces it. */
  existingObservations: ObservationForResolution[];
  entrances?: EntranceCandidate[];
  now: Date;
}

export interface NewLocationObservationForInsert {
  id: string;
  incidentId: string;
  source: LocationObservationSource;
  latitude: number;
  longitude: number;
  horizontalAccuracyMeters?: number;
  floorLevel?: string;
  capturedAt: Date;
  provenanceLabel: string;
  metadata: Record<string, unknown>;
}

export interface OverrideLocationResult {
  observation: NewLocationObservationForInsert;
  resolution: ResolveLocationResult;
  overriddenById: string;
  reason: string;
}

export function overrideLocation(input: OverrideLocationInput): OverrideLocationResult {
  const { incidentId, newObservationId, overriddenById, reason, newObservation, existingObservations, entrances, now } = input;

  if (!overriddenById?.trim()) {
    throw new MissingOverriddenByError();
  }
  if (!reason || reason.trim().length < MIN_OVERRIDE_REASON_LENGTH) {
    throw new MissingLocationOverrideReasonError();
  }

  const observation: NewLocationObservationForInsert = {
    id: newObservationId,
    incidentId,
    // CALL_TAKER, not MANUAL_PIN: this is specifically a staff member's
    // corrective override (spec 29.2's CALL_TAKER source enum value),
    // distinct from MANUAL_PIN which is the CALLER placing their own pin.
    source: 'CALL_TAKER',
    latitude: newObservation.latitude,
    longitude: newObservation.longitude,
    horizontalAccuracyMeters: newObservation.horizontalAccuracyMeters,
    floorLevel: newObservation.floorLevel,
    capturedAt: newObservation.capturedAt,
    provenanceLabel: `Manual override by ${overriddenById}`,
    metadata: {
      // A third `coordinateAuthority` value alongside C3's
      // 'SERVER_ANCHOR_RECORD' / 'CALLER_DEVICE': neither a pre-registered
      // physical point nor a raw device reading — a trained human's
      // deliberate correction, worth its own audit tag.
      coordinateAuthority: 'HUMAN_OVERRIDE',
      overriddenById,
      reason,
    },
  };

  const observationForResolution: ObservationForResolution = {
    id: observation.id,
    source: observation.source,
    latitude: observation.latitude,
    longitude: observation.longitude,
    horizontalAccuracyMeters: observation.horizontalAccuracyMeters,
    floorLevel: observation.floorLevel,
    capturedAt: observation.capturedAt,
  };

  const resolution = resolveLocation({
    observations: [...existingObservations, observationForResolution],
    entrances,
    now,
  });

  return { observation, resolution, overriddenById, reason };
}
