/**
 * Deterministic, idempotent demo seed — section 19 of
 * NAJAT360_CLAUDE_MASTER_BUILD_PROMPT.md.
 *
 * Deterministic: every row's content (ids, coordinates, statuses, names)
 * is derived from a fixed PRNG seed (SEED_VALUE below), not from
 * Math.random()/Date.now(). Running this script twice against an empty
 * database produces byte-identical rows (createdAt/expiresAt excepted —
 * see the note above buildHistoricalIncidents).
 *
 * Idempotent: every insert is `ON CONFLICT (id) DO UPDATE`, keyed by a
 * deterministic id this script assigns itself (e.g. `ent-01`, `unit-03`,
 * `inc-hist-000042`) rather than a fresh UUID — so re-running never
 * duplicates rows, it just re-affirms the same demo dataset.
 *
 * Every row sets `synthetic = true` explicitly (already the column
 * default, but explicit here so the intent is visible in this file and
 * not just implied by a schema default someone could change later).
 *
 * Scope note: C1 entities (User, Entrance, AmbulanceUnit, Incident,
 * IncidentEvent, UnitLocation, DeviceHeartbeat) plus, now that C2 and C3
 * exist, a handful of AssistedCaptureDraft/ExtractedFieldSuggestion
 * fixtures (see buildAssistedCaptureFixtures()) and LocationAnchor/
 * LocationObservation/LocationResolution fixtures (see
 * buildLocationAnchors()/buildLocationFixtures()). All of these are
 * produced by actually RUNNING the real C2/C3 library code
 * (MockAssistedCaptureProvider, LocalGlossaryTranslationProvider,
 * resolveAnchorToObservation, resolveLocation) against fixed demo inputs —
 * not hand-typed JSON — so the seed data exercises, and stays in sync
 * with, the real code paths those phases built. Only the human-decision
 * layer on top (accept/edit/reject a suggestion, which fixed anchor a
 * scenario "scans") is fixture data standing in for what a real call
 * session would produce.
 */
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { loadEnvFile } from './env';
import { createSeededRandom, jitterCoordinate, randomChoice, randomFloat, randomInt } from '@/lib/deterministic-random';
import { generateDeterministicRescueCode } from '@/lib/rescue-code';
import { computeLocationConfidence } from '@/lib/confidence';
import { MockAssistedCaptureProvider } from '@/lib/assisted-capture/mock-provider';
import { buildObservationFromDeviceInput, resolveAnchorToObservation, type AnchorLookup } from '@/lib/location/anchor-resolution';
import { resolveLocation } from '@/lib/location/resolver';
import { haversineDistanceMeters } from '@/lib/geo';
import { MockRoutingProvider } from '@/lib/routing/mock-provider';
import { generateRecommendation, type EntranceCandidateInput, type UnitCandidateInput } from '@/lib/dispatch/generate-recommendation';
import { decideDispatch } from '@/lib/dispatch/decision';
import { submitFieldAction, type ExistingFieldActionRef } from '@/lib/fieldlink/field-action';
import { generateCoverageAwareRecommendation } from '@/lib/dispatch/generate-coverage-recommendation';
import { latLngToH3Cell, h3CellToLatLng, h3GridDisk } from '@/lib/gis/h3';
import { type CoverageCellInput } from '@/lib/gis/coverage';
import { buildDemandBaselineModel, predictH3Demand } from '@/lib/gis/demand-baseline';
import type {
  AnchorType,
  CrewType,
  Connectivity,
  EntranceAccessType,
  FieldActionType,
  IncidentStatus,
  LocationObservationSource,
  PlaceType,
  Priority,
  Role,
  SuggestionStatus,
  UnitStatus,
  ValidationStatus,
} from '@/lib/domain/types';

loadEnvFile();

export const SEED_VALUE = 20260101; // fixed on purpose — see module docstring
export const RIYADH_CENTER = { latitude: 24.7136, longitude: 46.6753 };

export const ENTRANCE_COUNT = 24; // spec range 20–30
export const UNIT_COUNT = 10; // spec range 8–12
export const HISTORICAL_INCIDENT_COUNT = Number(process.env.SEED_HISTORICAL_COUNT ?? 2000); // spec range 1000–5000
export const ACTIVE_INCIDENT_COUNT = 8; // spec range 5–10

const LANGUAGES = ['ar', 'en', 'ur', 'tl', 'bn'];
const PLACE_TYPES: PlaceType[] = [
  'RESIDENTIAL',
  'COMMERCIAL',
  'OUTDOOR_PUBLIC',
  'RELIGIOUS_SITE',
  'TRANSPORT_HUB',
  'EVENT_VENUE',
  'OTHER',
];
const PRIORITIES: Priority[] = ['HIGH', 'MEDIUM', 'LOW'];
const CREW_TYPES: CrewType[] = ['AMBULANCE', 'RAPID_RESPONSE', 'FOOT_TEAM'];
const ACCESS_TYPES: EntranceAccessType[] = ['ROAD', 'PEDESTRIAN', 'SERVICE'];
const VALIDATION_STATUSES: ValidationStatus[] = ['UNVERIFIED', 'MANUALLY_REVIEWED', 'FIELD_CONFIRMED'];
const ZONES = ['zone-north', 'zone-south', 'zone-east', 'zone-west', 'zone-central'];

// Non-terminal statuses covering both the golden path and the exceptional
// states, so a demo of the operations dashboard has something in each
// bucket without relying on live traffic.
const ACTIVE_STATUS_ROTATION: IncidentStatus[] = [
  'NEW',
  'VERIFYING',
  'READY_FOR_DECISION',
  'DISPATCHED',
  'EN_ROUTE',
  'AT_ACCESS_POINT',
  'ON_SCENE',
  'LOST_CONNECTIVITY',
];

function syntheticTokenHash(id: string): string {
  return createHash('sha256').update(`synthetic-token:${id}`).digest('hex');
}

export interface EntranceRow {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  latitude: number;
  longitude: number;
  zone: string;
  accessType: EntranceAccessType;
  vehicleAccessible: boolean;
  pedestrianAccessible: boolean;
  active: boolean;
  validationStatus: ValidationStatus;
}

export function buildEntrances(rng: ReturnType<typeof createSeededRandom>): EntranceRow[] {
  const rows: EntranceRow[] = [];
  for (let i = 1; i <= ENTRANCE_COUNT; i++) {
    const point = jitterCoordinate(rng, RIYADH_CENTER, 6000);
    const idx = String(i).padStart(2, '0');
    rows.push({
      id: `ent-${idx}`,
      code: `ENT-${idx}`,
      nameAr: `مدخل تجريبي رقم ${i}`,
      nameEn: `Synthetic Entrance ${i}`,
      latitude: point.latitude,
      longitude: point.longitude,
      zone: randomChoice(rng, ZONES),
      accessType: randomChoice(rng, ACCESS_TYPES),
      vehicleAccessible: rng() > 0.2,
      pedestrianAccessible: rng() > 0.1,
      active: rng() > 0.05,
      validationStatus: randomChoice(rng, VALIDATION_STATUSES),
    });
  }
  return rows;
}

export interface UnitRow {
  id: string;
  code: string;
  label: string;
  crewType: CrewType;
  status: UnitStatus;
  readinessScore: number;
  homeZone: string;
  /** A unit's current position — single source of truth, also used verbatim for its `UnitLocation` row (see run()). Needed as real data (not just for display) once C4's generateRecommendation() needs a real origin point per unit to route from. */
  latitude: number;
  longitude: number;
}

export function buildUnits(rng: ReturnType<typeof createSeededRandom>): UnitRow[] {
  const rows: UnitRow[] = [];
  for (let i = 1; i <= UNIT_COUNT; i++) {
    const idx = String(i).padStart(2, '0');
    // Weighted so most units are available, matching a realistic fleet snapshot.
    const statusRoll = rng();
    const status: UnitStatus = statusRoll < 0.6 ? 'AVAILABLE' : statusRoll < 0.9 ? 'BUSY' : 'OUT_OF_SERVICE';
    const point = jitterCoordinate(rng, RIYADH_CENTER, 7000);
    rows.push({
      id: `unit-${idx}`,
      code: `UNIT-${idx}`,
      label: `Synthetic Ambulance ${i}`,
      crewType: randomChoice(rng, CREW_TYPES),
      status,
      readinessScore: randomInt(rng, 55, 100),
      homeZone: randomChoice(rng, ZONES),
      latitude: point.latitude,
      longitude: point.longitude,
    });
  }
  return rows;
}

export interface IncidentRow {
  id: string;
  rescueCode: string;
  callerTokenHash: string;
  callerTokenExpiresAt: Date;
  status: IncidentStatus;
  priority: Priority | null;
  proposedPriority: Priority | null;
  latitude: number;
  longitude: number;
  gpsAccuracyMeters: number;
  confidenceScore: number;
  confidenceVersion: string;
  placeType: PlaceType;
  floorLevel: string | null;
  language: string;
  unableToSpeak: boolean;
  callerName: string;
  callerPhone: string;
  description: string;
  suggestedEntranceId: string | null;
  assignedEntranceId: string | null;
  assignedUnitId: string | null;
  createdAt: Date;
  updatedAt: Date;
  closedAt: Date | null;
}

/**
 * The production rescue-code payload space (32^3 = 32,768 combinations) is
 * sized for real collision rates at real incident volumes with a live
 * uniqueness check against the database (see generateRescueCode's isTaken
 * option). A deterministic seed run of thousands of rows drawn from a pure
 * PRNG hits that space's birthday bound quickly, so the seed script needs
 * its own collision avoidance — implemented here by re-drawing from the
 * SAME rng (not a fresh one) until a code outside `usedCodes` appears. This
 * stays fully deterministic: the rng is a single continuing sequence, so
 * "draw again on collision" is itself a deterministic function of the seed
 * and call order.
 */
function generateUniqueDeterministicRescueCode(
  rng: ReturnType<typeof createSeededRandom>,
  usedCodes: Set<string>
): string {
  for (let attempt = 0; attempt < 10_000; attempt++) {
    const code = generateDeterministicRescueCode(rng);
    if (!usedCodes.has(code)) {
      usedCodes.add(code);
      return code;
    }
  }
  throw new Error('generateUniqueDeterministicRescueCode: exhausted retry budget — code space too small for this seed volume');
}

function buildOneIncident(params: {
  rng: ReturnType<typeof createSeededRandom>;
  usedRescueCodes: Set<string>;
  id: string;
  n: number;
  status: IncidentStatus;
  createdAt: Date;
  closedAt: Date | null;
  entrances: EntranceRow[];
  units: UnitRow[];
  /**
   * Units already assigned to another NON-TERMINAL incident being built in
   * this same run. When provided, the chosen unit is drawn from the
   * remaining pool and added here — matching the DB's own
   * `Incident_one_active_assignment_per_unit` partial unique index (a unit
   * can only be actively assigned to one open incident at a time; CLOSED
   * incidents are exempt from that constraint, so historical incidents
   * pass `undefined` and may freely reuse any unit across the 90-day
   * window). Omitting this for an active incident is how a real double-
   * booking bug slipped into this seed data before this constraint existed
   * — see docs/product/NAJAT360-قرارات-ما-بعد-C0.md's ChatGPT-comparison
   * notes.
   */
  usedActiveUnitIds?: Set<string>;
}): IncidentRow {
  const { rng, usedRescueCodes, id, n, status, createdAt, closedAt, entrances, units, usedActiveUnitIds } = params;
  const point = jitterCoordinate(rng, RIYADH_CENTER, 9000);
  const gpsAccuracyMeters = randomFloat(rng, 4, 60);
  const confidence = computeLocationConfidence({
    gpsAccuracy: Math.max(0, 100 - gpsAccuracyMeters),
    roadPlausibility: randomInt(rng, 50, 100),
    entranceProximity: randomInt(rng, 40, 100),
    callerConfirmation: randomInt(rng, 50, 100),
    dataFreshness: randomInt(rng, 60, 100),
  });

  const isTerminalOrLate = status === 'CLOSED' || status === 'DISPATCHED' || status === 'EN_ROUTE' ||
    status === 'AT_ACCESS_POINT' || status === 'ON_SCENE' || status === 'LOST_CONNECTIVITY';
  const suggestedEntrance = randomChoice(rng, entrances);
  const assignedEntrance = isTerminalOrLate ? suggestedEntrance : null;

  let assignedUnit: UnitRow | null = null;
  if (isTerminalOrLate) {
    const availableUnits = usedActiveUnitIds ? units.filter((u) => !usedActiveUnitIds.has(u.id)) : units;
    if (availableUnits.length === 0) {
      throw new Error(
        `buildOneIncident(${id}): no unassigned unit left for an active incident — increase UNIT_COUNT or reduce how many active incidents need a live unit`
      );
    }
    assignedUnit = randomChoice(rng, availableUnits);
    usedActiveUnitIds?.add(assignedUnit.id);
  }

  return {
    id,
    rescueCode: generateUniqueDeterministicRescueCode(rng, usedRescueCodes),
    callerTokenHash: syntheticTokenHash(id),
    callerTokenExpiresAt: new Date(createdAt.getTime() + 30 * 60_000),
    status,
    priority: randomChoice(rng, PRIORITIES),
    proposedPriority: randomChoice(rng, PRIORITIES),
    latitude: point.latitude,
    longitude: point.longitude,
    gpsAccuracyMeters,
    confidenceScore: confidence.score,
    confidenceVersion: confidence.version,
    placeType: randomChoice(rng, PLACE_TYPES),
    floorLevel: rng() > 0.5 ? String(randomInt(rng, 0, 20)) : null,
    language: randomChoice(rng, LANGUAGES),
    unableToSpeak: rng() < 0.08,
    callerName: `Synthetic Caller ${n}`,
    callerPhone: `SYN-CALLER-PHONE-${String(n).padStart(6, '0')}`,
    description: `Synthetic seed incident #${n} — no real caller data. Generated by scripts/seed-demo.ts.`,
    suggestedEntranceId: suggestedEntrance.id,
    assignedEntranceId: assignedEntrance?.id ?? null,
    assignedUnitId: assignedUnit?.id ?? null,
    createdAt,
    updatedAt: closedAt ?? createdAt,
    closedAt,
  };
}

/**
 * Note on determinism vs. "now": each row's CONTENT (coordinates, ids,
 * codes, statuses, confidence) is fully seed-derived and identical across
 * runs. `createdAt` is anchored to the wall-clock time the script runs
 * MINUS a seed-derived offset, so historical incidents always land in the
 * recent past relative to "today" rather than drifting toward a fixed
 * calendar date as the demo ages. This is the one intentional exception to
 * byte-for-byte reproducibility and is why re-seeding on a different day
 * updates timestamps (via the ON CONFLICT UPDATE) without changing anything
 * else about the row.
 */
export function buildHistoricalIncidents(
  rng: ReturnType<typeof createSeededRandom>,
  usedRescueCodes: Set<string>,
  entrances: EntranceRow[],
  units: UnitRow[]
): IncidentRow[] {
  const now = Date.now();
  const rows: IncidentRow[] = [];
  for (let i = 1; i <= HISTORICAL_INCIDENT_COUNT; i++) {
    const daysAgo = randomInt(rng, 1, 90);
    const minutesJitter = randomInt(rng, 0, 1439);
    const createdAt = new Date(now - daysAgo * 86_400_000 - minutesJitter * 60_000);
    const durationMinutes = randomInt(rng, 12, 95);
    const closedAt = new Date(createdAt.getTime() + durationMinutes * 60_000);
    rows.push(
      buildOneIncident({
        rng,
        usedRescueCodes,
        id: `inc-hist-${String(i).padStart(6, '0')}`,
        n: i,
        status: 'CLOSED',
        createdAt,
        closedAt,
        entrances,
        units,
      })
    );
  }
  return rows;
}

export function buildActiveIncidents(
  rng: ReturnType<typeof createSeededRandom>,
  usedRescueCodes: Set<string>,
  entrances: EntranceRow[],
  units: UnitRow[]
): IncidentRow[] {
  const now = Date.now();
  const rows: IncidentRow[] = [];
  const usedActiveUnitIds = new Set<string>();
  for (let i = 1; i <= ACTIVE_INCIDENT_COUNT; i++) {
    const status = ACTIVE_STATUS_ROTATION[(i - 1) % ACTIVE_STATUS_ROTATION.length]!;
    const minutesAgo = randomInt(rng, 1, 40);
    const createdAt = new Date(now - minutesAgo * 60_000);
    rows.push(
      buildOneIncident({
        rng,
        usedRescueCodes,
        id: `inc-active-${String(i).padStart(2, '0')}`,
        n: 1_000_000 + i,
        status,
        createdAt,
        closedAt: null,
        entrances,
        units,
        usedActiveUnitIds,
      })
    );
  }
  return rows;
}

export interface UserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export function buildUsers(): UserRow[] {
  const roles: Role[] = [
    'CALLER',
    'CALL_TAKER',
    'SUPERVISOR',
    'MEDIC',
    'RESPONSE_COORDINATOR',
    'HOSPITAL_LIAISON',
    'ANALYST',
    'ADMIN',
  ];
  return roles.map((role) => ({
    id: `user-${role.toLowerCase()}`,
    name: `Synthetic ${role.replace(/_/g, ' ')}`,
    email: `synthetic.${role.toLowerCase()}@najat360.demo`,
    role,
  }));
}

export interface AssistedCaptureDraftRow {
  id: string;
  incidentId: string;
  sourceType: 'TEXT' | 'AUDIO_TRANSCRIPT';
  sourceLanguage: string;
  targetLanguage: string;
  translatedText: string;
  provider: string;
  modelVersion: string;
  status: 'DRAFT' | 'PARTIALLY_CONFIRMED' | 'CONFIRMED' | 'REJECTED';
  createdAt: Date;
  expiresAt: Date;
}

export interface ExtractedFieldSuggestionRow {
  id: string;
  draftId: string;
  fieldName: string;
  suggestedValue: unknown;
  evidenceTextMasked: string | null;
  confidence: number;
  status: SuggestionStatus;
  finalValue: unknown;
  reviewedById: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
}

/** One demo caller utterance and how the (fixture) call-taker review of its extracted suggestions turned out. */
interface FixtureScenario {
  incidentId: string;
  sourceLanguage: string;
  sourceText: string;
  /** Per suggestedField (in the order MockAssistedCaptureProvider's EXTRACTION_RULES will emit them), the review outcome to apply. Length must match how many suggestions the real extraction call actually produces for this sourceText — asserted at build time, not assumed. */
  reviews: Array<{ status: 'ACCEPTED' | 'EDITED' | 'REJECTED' | 'PENDING'; finalValue?: unknown }>;
}

/**
 * Builds a small set of AssistedCaptureDraft + ExtractedFieldSuggestion
 * fixture rows by actually RUNNING the real C2 pipeline
 * (MockAssistedCaptureProvider.translate() then .extractOperationalFields())
 * against a handful of fixed demo phrases, then layering a fixed,
 * deterministic "review outcome" on top of each resulting suggestion —
 * standing in for what a call-taker would decide in a live demo. Every
 * suggestedValue here has already passed `validateAssistedSuggestion()`
 * (mock-provider.ts does that internally), so these fixtures exercise the
 * same allowlist boundary a real draft would.
 *
 * Deliberately covers all four `DraftStatus` values (DRAFT,
 * PARTIALLY_CONFIRMED, CONFIRMED, REJECTED) and all four
 * `SuggestionStatus` values (PENDING, ACCEPTED, EDITED, REJECTED) at least
 * once, so a future C4 call-taker-review screen has real seed data for
 * every state it needs to render.
 */
export async function buildAssistedCaptureFixtures(
  activeIncidents: IncidentRow[]
): Promise<{ drafts: AssistedCaptureDraftRow[]; suggestions: ExtractedFieldSuggestionRow[] }> {
  const provider = new MockAssistedCaptureProvider();
  const reviewerId = 'user-call_taker';

  const scenarios: FixtureScenario[] = [
    {
      // -> translatedText 'نحن في الطابق الثالث' -> one suggestion: floorLevel.
      incidentId: 'inc-active-01',
      sourceLanguage: 'en',
      sourceText: 'we are on the third floor',
      reviews: [{ status: 'ACCEPTED' }],
    },
    {
      // -> translatedText 'البوابة الخلفية مغلقة' -> two suggestions: accessObstacle, entranceOrGateHint.
      incidentId: 'inc-active-02',
      sourceLanguage: 'en',
      sourceText: 'the back gate is locked',
      reviews: [
        { status: 'EDITED', finalValue: 'بوابة خلفية مغلقة بقفل حديدي — يلزم فريق دخول بديل' },
        { status: 'PENDING' },
      ],
    },
    {
      // Same phrase, a different incident: the call-taker determines the
      // floor mention does not apply here (e.g. contradicted by an anchor
      // observation) and rejects it — exercises the REJECTED path for both
      // the suggestion and (single-suggestion draft) the draft itself.
      incidentId: 'inc-active-03',
      sourceLanguage: 'en',
      sourceText: 'we are on the third floor',
      reviews: [{ status: 'REJECTED' }],
    },
    {
      // Freshly extracted, not yet reviewed at all — exercises DraftStatus
      // 'DRAFT' (as opposed to inc-active-02's 'PARTIALLY_CONFIRMED', where
      // at least one suggestion has already been decided).
      incidentId: 'inc-active-04',
      sourceLanguage: 'en',
      sourceText: 'the back gate is locked',
      reviews: [{ status: 'PENDING' }, { status: 'PENDING' }],
    },
  ];

  const incidentById = new Map(activeIncidents.map((inc) => [inc.id, inc]));
  const drafts: AssistedCaptureDraftRow[] = [];
  const suggestions: ExtractedFieldSuggestionRow[] = [];

  for (const [scenarioIndex, scenario] of scenarios.entries()) {
    const incident = incidentById.get(scenario.incidentId);
    if (!incident) {
      throw new Error(`buildAssistedCaptureFixtures: no active incident with id "${scenario.incidentId}"`);
    }

    const draftId = `draft-${String(scenarioIndex + 1).padStart(2, '0')}`;
    const draftCreatedAt = new Date(incident.createdAt.getTime() + 90_000); // 90s after the call started
    const expiresAt = new Date(draftCreatedAt.getTime() + 24 * 60 * 60_000);

    const translation = await provider.translate({
      incidentId: incident.id,
      sourceText: scenario.sourceText,
      sourceLanguage: scenario.sourceLanguage,
      targetLanguage: 'ar',
    });

    const fieldSuggestions = await provider.extractOperationalFields({
      incidentId: incident.id,
      draftId,
      translatedText: translation.translatedText,
      sourceLanguage: scenario.sourceLanguage,
    });

    if (fieldSuggestions.length !== scenario.reviews.length) {
      throw new Error(
        `buildAssistedCaptureFixtures: scenario for ${scenario.incidentId} produced ${fieldSuggestions.length} suggestion(s) but ${scenario.reviews.length} review outcome(s) were configured — keep these in sync.`
      );
    }

    const suggestionRows: ExtractedFieldSuggestionRow[] = fieldSuggestions.map((s, i) => {
      const review = scenario.reviews[i]!;
      const decided = review.status !== 'PENDING';
      return {
        id: `${draftId}-sugg-${i + 1}`,
        draftId,
        fieldName: s.fieldName,
        suggestedValue: s.suggestedValue,
        evidenceTextMasked: s.evidenceTextMasked ?? null,
        confidence: s.confidence,
        status: review.status,
        finalValue: review.status === 'REJECTED' ? null : decided ? (review.finalValue ?? s.suggestedValue) : null,
        reviewedById: decided ? reviewerId : null,
        reviewedAt: decided ? new Date(draftCreatedAt.getTime() + 120_000) : null,
        createdAt: draftCreatedAt,
      };
    });

    const allDecided = suggestionRows.every((s) => s.status !== 'PENDING');
    const anyDecided = suggestionRows.some((s) => s.status !== 'PENDING');
    const allRejected = suggestionRows.every((s) => s.status === 'REJECTED');
    const draftStatus: AssistedCaptureDraftRow['status'] = allRejected
      ? 'REJECTED'
      : allDecided
        ? 'CONFIRMED'
        : anyDecided
          ? 'PARTIALLY_CONFIRMED'
          : 'DRAFT';

    drafts.push({
      id: draftId,
      incidentId: incident.id,
      sourceType: 'TEXT',
      sourceLanguage: scenario.sourceLanguage,
      targetLanguage: 'ar',
      translatedText: translation.translatedText,
      provider: translation.provider,
      modelVersion: translation.modelVersion,
      status: draftStatus,
      createdAt: draftCreatedAt,
      expiresAt,
    });
    suggestions.push(...suggestionRows);
  }

  return { drafts, suggestions };
}

export const ANCHOR_COUNT = 8; // spec 29.1 range: 6-10

export interface LocationAnchorRow {
  id: string;
  code: string;
  entranceId: string;
  floorLevel: string | null;
  latitude: number;
  longitude: number;
  anchorType: AnchorType;
  validationStatus: ValidationStatus;
  validFrom: Date;
  validUntil: Date | null;
  active: boolean;
}

/**
 * Builds spec 29.1's "6–10 QR codes للعرض من seed اصطناعي" — one anchor
 * per each of the first `ANCHOR_COUNT` entrances, sharing that entrance's
 * coordinates (a real anchor sits at/near its entrance). Two of the eight
 * are FLOOR-type rather than ENTRANCE-type, so the demo set has variety
 * across `AnchorType`. `validFrom` is a fixed literal timestamp (not
 * `Date.now()`), keeping this function's output fully deterministic like
 * every other pure builder in this file.
 */
export function buildLocationAnchors(entrances: EntranceRow[]): LocationAnchorRow[] {
  const validFrom = new Date('2026-01-01T00:00:00Z');
  return entrances.slice(0, ANCHOR_COUNT).map((entrance, i) => {
    const n = i + 1;
    const isFloorAnchor = n === 3 || n === 7;
    return {
      id: `anchor-${String(n).padStart(2, '0')}`,
      code: `RA-${String(n).padStart(3, '0')}`,
      entranceId: entrance.id,
      floorLevel: isFloorAnchor ? String(1 + (n % 4)) : null,
      latitude: entrance.latitude,
      longitude: entrance.longitude,
      anchorType: isFloorAnchor ? 'FLOOR' : 'ENTRANCE',
      validationStatus: 'FIELD_CONFIRMED',
      validFrom,
      validUntil: null,
      active: true,
    };
  });
}

export interface LocationObservationRow {
  id: string;
  incidentId: string;
  source: LocationObservationSource;
  latitude: number;
  longitude: number;
  horizontalAccuracyMeters: number | null;
  floorLevel: string | null;
  capturedAt: Date;
  provenanceLabel: string;
  metadata: Record<string, unknown>;
}

export interface LocationResolutionRow {
  id: string;
  incidentId: string;
  latitude: number;
  longitude: number;
  uncertaintyRadiusMeters: number;
  confidenceIndex: number;
  primaryObservationId: string;
  supportingObservationIds: string[];
  conflictingObservationIds: string[];
  selectedEntranceId: string | null;
  floorLevel: string | null;
  algorithmVersion: string;
  resolvedById: string | null;
  createdAt: Date;
}

/**
 * Builds LocationObservation + LocationResolution fixtures by actually
 * RUNNING `resolveAnchorToObservation()`/`buildObservationFromDeviceInput()`
 * (anchor-resolution.ts) and `resolveLocation()` (resolver.ts) against two
 * fixed demo scenarios:
 *
 *   - inc-active-01: a BROWSER_GPS reading ~20m off, then the caller scans
 *     the physical anchor at the entrance — the two CORROBORATE (no
 *     conflict), demonstrating spec 29.2's normal merge path and spec
 *     29.1's Rescue Anchor flow end to end.
 *   - inc-active-02: a BROWSER_GPS reading ~500m off from a scanned anchor
 *     (e.g. a stale/drifted phone fix) — the two CONFLICT, demonstrating
 *     that this pipeline surfaces disagreement (`hasConflict`,
 *     `conflictingObservationIds`) rather than silently picking one, per
 *     spec 29.2 rule #3.
 *   - inc-active-03: a clean, ~15m-offset no-conflict resolution (same
 *     shape as inc-active-01) — this incident is the one
 *     buildDispatchFixtures() (C4) runs generateRecommendation() against,
 *     so it needs a real LocationResolution.confidenceIndex to feed the
 *     Access Score's locationConfidence term, not a hand-picked number.
 *
 * Both scenarios' `LocationObservation` rows are real output of the
 * anchor-resolution helpers (never hand-typed coordinates for the
 * ANCHOR_QR ones), and each scenario's single `LocationResolution` row is
 * the real, unmodified return value of `resolveLocation()`.
 */
export async function buildLocationFixtures(
  activeIncidents: IncidentRow[],
  anchors: LocationAnchorRow[],
  entrances: EntranceRow[]
): Promise<{ observations: LocationObservationRow[]; resolutions: LocationResolutionRow[] }> {
  const incidentById = new Map(activeIncidents.map((inc) => [inc.id, inc]));
  const anchorLookup: AnchorLookup = {
    async getActiveAnchorByCode(code) {
      const anchor = anchors.find((a) => a.code === code);
      return anchor ?? null;
    },
  };
  const entranceCandidates = entrances.map((e) => ({ id: e.id, latitude: e.latitude, longitude: e.longitude }));

  const observations: LocationObservationRow[] = [];
  const resolutions: LocationResolutionRow[] = [];
  let obsCounter = 0;
  const nextObsId = () => `loc-obs-${String(++obsCounter).padStart(3, '0')}`;

  const scenarios: Array<{ incidentId: string; anchor: LocationAnchorRow; gpsOffsetLatitudeDegrees: number }> = [
    // ~20m offset — within the resolver's 60m "supporting" threshold.
    { incidentId: 'inc-active-01', anchor: anchors[0]!, gpsOffsetLatitudeDegrees: 0.00018 },
    // ~500m offset — beyond the 60m threshold, so this is a real conflict.
    { incidentId: 'inc-active-02', anchor: anchors[1]!, gpsOffsetLatitudeDegrees: 0.0045 },
    // ~15m offset — within threshold, no conflict; feeds C4's buildDispatchFixtures().
    { incidentId: 'inc-active-03', anchor: anchors[3]!, gpsOffsetLatitudeDegrees: 0.00013 },
  ];

  for (const scenario of scenarios) {
    const incident = incidentById.get(scenario.incidentId);
    if (!incident) {
      throw new Error(`buildLocationFixtures: no active incident with id "${scenario.incidentId}"`);
    }

    const gpsCapturedAt = new Date(incident.createdAt.getTime() + 30_000);
    const anchorCapturedAt = new Date(incident.createdAt.getTime() + 90_000);
    const resolvedAt = new Date(anchorCapturedAt.getTime() + 5_000);

    const gpsInput = buildObservationFromDeviceInput({
      incidentId: incident.id,
      source: 'BROWSER_GPS',
      latitude: scenario.anchor.latitude + scenario.gpsOffsetLatitudeDegrees,
      longitude: scenario.anchor.longitude,
      horizontalAccuracyMeters: 25,
      capturedAt: gpsCapturedAt,
    });
    const anchorInput = await resolveAnchorToObservation(
      anchorLookup,
      scenario.anchor.code,
      incident.id,
      anchorCapturedAt
    );

    const gpsRow: LocationObservationRow = {
      id: nextObsId(),
      incidentId: incident.id,
      source: gpsInput.source,
      latitude: gpsInput.latitude,
      longitude: gpsInput.longitude,
      horizontalAccuracyMeters: gpsInput.horizontalAccuracyMeters ?? null,
      floorLevel: gpsInput.floorLevel ?? null,
      capturedAt: gpsInput.capturedAt,
      provenanceLabel: gpsInput.provenanceLabel,
      metadata: gpsInput.metadata,
    };
    const anchorRow: LocationObservationRow = {
      id: nextObsId(),
      incidentId: incident.id,
      source: anchorInput.source,
      latitude: anchorInput.latitude,
      longitude: anchorInput.longitude,
      horizontalAccuracyMeters: anchorInput.horizontalAccuracyMeters ?? null,
      floorLevel: anchorInput.floorLevel ?? null,
      capturedAt: anchorInput.capturedAt,
      provenanceLabel: anchorInput.provenanceLabel,
      metadata: anchorInput.metadata,
    };
    observations.push(gpsRow, anchorRow);

    const result = resolveLocation({
      observations: [gpsRow, anchorRow],
      entrances: entranceCandidates,
      now: resolvedAt,
    });

    resolutions.push({
      id: `loc-res-${incident.id}`,
      incidentId: incident.id,
      latitude: result.latitude,
      longitude: result.longitude,
      uncertaintyRadiusMeters: result.uncertaintyRadiusMeters,
      confidenceIndex: result.confidenceIndex,
      primaryObservationId: result.primaryObservationId,
      supportingObservationIds: result.supportingObservationIds,
      conflictingObservationIds: result.conflictingObservationIds,
      selectedEntranceId: result.selectedEntranceId ?? null,
      floorLevel: result.floorLevel ?? null,
      algorithmVersion: result.algorithmVersion,
      resolvedById: null, // system-computed snapshot — no human re-resolved this one
      createdAt: resolvedAt,
    });
  }

  return { observations, resolutions };
}

export interface RouteSnapshotRow {
  id: string;
  incidentId: string;
  unitId: string;
  entranceId: string;
  provider: string;
  providerMode: string;
  distanceMeters: number;
  durationSeconds: number;
  /** {"vehicle": <GeoJSON LineString>, "pedestrian": <GeoJSON LineString> | null} — see prisma/schema.prisma's RouteSnapshot doc comment. */
  geometry: { vehicle: string; pedestrian: string | null };
  dataFreshnessAt: Date;
}

export interface RecommendationRow {
  id: string;
  incidentId: string;
  algorithmVersion: string;
  recommendedUnitId: string;
  alternativeUnitId: string | null;
  recommendedEntranceId: string;
  alternativeEntranceId: string | null;
  accessScore: number;
  confidenceScore: number;
  reasoning: string[];
  scoreBreakdown: Record<string, number>;
  acceptedById: string | null;
  acceptedAt: Date | null;
  rejectedAt: Date | null;
  overrideReason: string | null;
}

/** What buildDispatchFixtures() computed the incident should now look like, for run() to fold into the Incident row it is about to INSERT (must happen before that INSERT — see run()'s call-site comment). */
export interface DispatchedIncidentUpdate {
  id: string;
  status: IncidentStatus;
  assignedUnitId: string;
  assignedEntranceId: string;
  updatedAt: Date;
}

/**
 * Builds C4's golden-path fixture by actually RUNNING the real pipeline —
 * `generateRecommendation()` (lib/dispatch/generate-recommendation.ts)
 * against real candidate units/entrances and a real `MockRoutingProvider`,
 * then `decideDispatch()` (lib/dispatch/decision.ts) simulating a
 * supervisor accepting the top recommendation as-is — for the one active
 * incident seeded in READY_FOR_DECISION status (inc-active-03). This is
 * the C1→C2→C3→C4 chain end to end: a real incident, a real C3
 * LocationResolution feeding the Access Score's locationConfidence term,
 * real routing/entrance-accessibility scoring, and a real gatekeeper
 * decision — not hand-typed Recommendation JSON.
 *
 * Persists one RouteSnapshot per (unit, entrance) candidate considered
 * (not just the winner) and exactly one Recommendation row, already marked
 * accepted (acceptedById/acceptedAt set, rejectedAt/overrideReason left
 * null) since this fixture demonstrates the "supervisor agrees with the
 * recommendation" path — the far more common real-world case than an
 * override, and the one a first demo pass through the operations
 * dashboard should be able to show reaching DISPATCHED without any
 * further seed-side scripting.
 */
export async function buildDispatchFixtures(
  activeIncidents: IncidentRow[],
  units: UnitRow[],
  entrances: EntranceRow[],
  locationResolutions: LocationResolutionRow[]
): Promise<{
  routeSnapshots: RouteSnapshotRow[];
  recommendation: RecommendationRow;
  incidentUpdate: DispatchedIncidentUpdate;
}> {
  const targetIncidentId = 'inc-active-03';
  const incident = activeIncidents.find((i) => i.id === targetIncidentId);
  if (!incident) {
    throw new Error(`buildDispatchFixtures: no active incident with id "${targetIncidentId}"`);
  }
  if (incident.status !== 'READY_FOR_DECISION') {
    throw new Error(
      `buildDispatchFixtures: incident "${targetIncidentId}" must be READY_FOR_DECISION, got "${incident.status}" — this fixture depends on ACTIVE_STATUS_ROTATION's fixed ordering`
    );
  }
  const resolution = locationResolutions.find((r) => r.incidentId === targetIncidentId);
  if (!resolution) {
    throw new Error(
      `buildDispatchFixtures: no LocationResolution for "${targetIncidentId}" — buildLocationFixtures() must run first and include this incident's scenario`
    );
  }

  // Units already actively assigned elsewhere are not real candidates,
  // same rule buildOneIncident()'s usedActiveUnitIds enforces for
  // terminal/late-stage active incidents.
  const usedUnitIds = new Set(activeIncidents.filter((i) => i.assignedUnitId).map((i) => i.assignedUnitId!));
  const candidateUnits = units.filter((u) => u.status === 'AVAILABLE' && !usedUnitIds.has(u.id)).slice(0, 3);
  if (candidateUnits.length === 0) {
    throw new Error('buildDispatchFixtures: no AVAILABLE, unassigned unit left to recommend — increase UNIT_COUNT');
  }

  const activeEntrances = entrances.filter((e) => e.active);
  const candidateEntrances = [...activeEntrances]
    .sort(
      (a, b) =>
        haversineDistanceMeters(resolution, a) - haversineDistanceMeters(resolution, b)
    )
    .slice(0, 3);
  if (candidateEntrances.length === 0) {
    throw new Error('buildDispatchFixtures: no active entrance available to recommend');
  }

  const decisionTime = new Date(incident.createdAt.getTime() + 120_000); // 2 minutes into the call
  const routingProvider = new MockRoutingProvider(() => decisionTime);

  const unitCandidates: UnitCandidateInput[] = candidateUnits.map((u) => ({
    id: u.id,
    readinessScore: u.readinessScore,
    location: { latitude: u.latitude, longitude: u.longitude },
  }));
  const entranceCandidates: EntranceCandidateInput[] = candidateEntrances.map((e) => ({
    id: e.id,
    latitude: e.latitude,
    longitude: e.longitude,
    vehicleStopLatitude: undefined,
    vehicleStopLongitude: undefined,
    active: e.active,
    validationStatus: e.validationStatus,
    vehicleAccessible: e.vehicleAccessible,
    pedestrianAccessible: e.pedestrianAccessible,
    isServiceGate: false,
    temporaryRestriction: undefined,
    floorLevel: undefined,
    hasElevator: false,
  }));

  const result = await generateRecommendation({
    incidentId: targetIncidentId,
    locationConfidenceIndex: resolution.confidenceIndex,
    resolvedFloorLevel: resolution.floorLevel,
    resolutionCreatedAt: resolution.createdAt,
    availableUnits: unitCandidates,
    candidateEntrances: entranceCandidates,
    routingProvider,
    now: decisionTime,
  });

  const routeSnapshots: RouteSnapshotRow[] = result.candidates.map((c) => ({
    id: `route-snap-${targetIncidentId}-${c.unitId}-${c.entranceId}`,
    incidentId: targetIncidentId,
    unitId: c.unitId,
    entranceId: c.entranceId,
    provider: c.route.provider,
    providerMode: c.route.providerMode,
    distanceMeters: c.route.totalDistanceMeters,
    durationSeconds: c.route.totalDurationSeconds,
    geometry: { vehicle: c.route.vehicleGeometry, pedestrian: c.route.pedestrianGeometry },
    dataFreshnessAt: c.route.dataFreshnessAt,
  }));

  const topCandidate = result.candidates.find(
    (c) => c.unitId === result.recommendedUnitId && c.entranceId === result.recommendedEntranceId
  )!;

  // Simulate a supervisor accepting the top recommendation exactly as
  // given — decideDispatch() re-validates freshly, same as it would for a
  // real decision; nothing here shortcuts past that gatekeeper.
  const decision = decideDispatch({
    incidentStatus: incident.status,
    recommendedUnitId: result.recommendedUnitId,
    recommendedEntranceId: result.recommendedEntranceId,
    chosenUnitId: result.recommendedUnitId,
    chosenEntranceId: result.recommendedEntranceId,
    chosenUnit: { id: result.recommendedUnitId, status: 'AVAILABLE', hasOtherActiveIncidentAssigned: false },
    decidedById: 'user-supervisor',
  });

  const recommendation: RecommendationRow = {
    id: `rec-${targetIncidentId}`,
    incidentId: targetIncidentId,
    algorithmVersion: result.algorithmVersion,
    recommendedUnitId: result.recommendedUnitId,
    alternativeUnitId: result.alternativeUnitId,
    recommendedEntranceId: result.recommendedEntranceId,
    alternativeEntranceId: result.alternativeEntranceId,
    accessScore: result.accessScore,
    confidenceScore: result.confidenceScore,
    reasoning: result.reasoning,
    scoreBreakdown: topCandidate.breakdown,
    acceptedById: decision.decidedById,
    acceptedAt: decisionTime,
    rejectedAt: null,
    overrideReason: null,
  };

  const incidentUpdate: DispatchedIncidentUpdate = {
    id: targetIncidentId,
    status: decision.incidentTransition.to,
    assignedUnitId: decision.assignedUnitId,
    assignedEntranceId: decision.assignedEntranceId,
    updatedAt: decisionTime,
  };

  return { routeSnapshots, recommendation, incidentUpdate };
}

export interface FieldActionRow {
  id: string;
  incidentId: string;
  unitId: string;
  actorId: string;
  actionType: FieldActionType;
  idempotencyKey: string;
  payload: Record<string, unknown> | null;
  previousStatus: IncidentStatus | null;
  resultingStatus: IncidentStatus | null;
  submittedAt: Date;
  processedAt: Date;
}

export interface FieldLinkIncidentUpdate {
  id: string;
  status: IncidentStatus;
  closedAt: Date | null;
  updatedAt: Date;
}

/**
 * Builds C5's golden-path fixture by actually RUNNING the real
 * `submitFieldAction()` gatekeeper (lib/fieldlink/field-action.ts) for a
 * fixed sequence of medic actions against the SAME incident
 * buildDispatchFixtures() (C4) just moved to DISPATCHED — extending the
 * demonstrated golden path one phase further: C1→C2→C3→C4→C5, one
 * incident, real algorithms end to end, all the way to CLOSED.
 *
 * Sequence: ACCEPT_TASK (log-only) -> START_MOVING (-> EN_ROUTE) ->
 * AT_ACCESS_POINT -> ON_SCENE -> CLOSE_TASK (-> CLOSED). Each call feeds
 * the REAL, growing `existingActionsForIncident` list forward exactly like
 * a live repository layer would (fetch this incident's prior FieldAction
 * rows, pass them in) — this is what lets `submitFieldAction()`'s
 * once-per-incident guard and idempotency dedup mean anything in this
 * fixture, not just in the unit tests.
 *
 * Must run AFTER buildDispatchFixtures() has already mutated its target
 * IncidentRow to DISPATCHED in place (see run()'s call-site comment) —
 * this function reads that mutated status/assignedUnitId directly off the
 * `activeIncidents` array rather than accepting them as separate
 * parameters, so it can never accidentally run against stale pre-dispatch
 * values.
 */
export async function buildFieldLinkFixtures(
  activeIncidents: IncidentRow[]
): Promise<{ fieldActions: FieldActionRow[]; incidentUpdate: FieldLinkIncidentUpdate }> {
  const targetIncidentId = 'inc-active-03';
  const incident = activeIncidents.find((i) => i.id === targetIncidentId);
  if (!incident) {
    throw new Error(`buildFieldLinkFixtures: no active incident with id "${targetIncidentId}"`);
  }
  if (incident.status !== 'DISPATCHED' || !incident.assignedUnitId) {
    throw new Error(
      `buildFieldLinkFixtures: incident "${targetIncidentId}" must be DISPATCHED with an assigned unit — ` +
        `buildDispatchFixtures() (C4) must run and mutate it first`
    );
  }
  const medicId = 'user-medic';
  const unitId = incident.assignedUnitId;

  const sequence: Array<{ actionType: FieldActionType; payload?: Record<string, unknown> }> = [
    { actionType: 'ACCEPT_TASK' },
    { actionType: 'START_MOVING' },
    { actionType: 'AT_ACCESS_POINT' },
    { actionType: 'ON_SCENE' },
    { actionType: 'CLOSE_TASK' },
  ];

  const fieldActions: FieldActionRow[] = [];
  const existingActionsForIncident: ExistingFieldActionRef[] = [];
  let currentStatus: IncidentStatus = incident.status;
  // Spaced a realistic few minutes apart, starting shortly after the
  // dispatch decision itself (incident.updatedAt was already set by
  // buildDispatchFixtures() to the decision timestamp).
  let clock = new Date(incident.updatedAt.getTime() + 30_000);
  let actionCounter = 0;

  for (const step of sequence) {
    actionCounter += 1;
    const idempotencyKey = `seed-fieldaction-${targetIncidentId}-${actionCounter}`;
    const result = submitFieldAction({
      incidentId: targetIncidentId,
      unitId,
      actorId: medicId,
      actionType: step.actionType,
      idempotencyKey,
      incidentStatus: currentStatus,
      assignedUnitId: incident.assignedUnitId,
      payload: step.payload,
      existingActionsForIncident,
      submittedAt: clock,
      now: clock,
    });
    if (result.duplicate) {
      // Cannot happen with a freshly-generated key per step — a thrown
      // error here would mean this fixture's own bookkeeping is wrong.
      throw new Error(`buildFieldLinkFixtures: unexpected duplicate for a fresh idempotencyKey (${idempotencyKey})`);
    }

    const row: FieldActionRow = {
      id: `fa-${targetIncidentId}-${String(actionCounter).padStart(2, '0')}`,
      incidentId: targetIncidentId,
      unitId,
      actorId: medicId,
      actionType: step.actionType,
      idempotencyKey,
      payload: result.action.payload,
      previousStatus: result.action.previousStatus,
      resultingStatus: result.action.resultingStatus,
      submittedAt: result.action.submittedAt,
      processedAt: result.action.processedAt,
    };
    fieldActions.push(row);
    existingActionsForIncident.push({ idempotencyKey, actionType: step.actionType });

    if (result.incidentTransition) {
      currentStatus = result.incidentTransition.to;
    }
    clock = new Date(clock.getTime() + 90_000); // next action ~90s later
  }

  // Prove idempotency for real, in the same fixture that demonstrates the
  // rest of C5 — not just in the unit tests: resubmit the FIRST action's
  // exact idempotencyKey again and confirm submitFieldAction() reports it
  // as a duplicate no-op rather than reprocessing it (which would, e.g.,
  // attempt an already-applied ACCEPT_TASK's now-invalid transition).
  const firstAction = sequence[0]!;
  const retryResult = submitFieldAction({
    incidentId: targetIncidentId,
    unitId,
    actorId: medicId,
    actionType: firstAction.actionType,
    idempotencyKey: fieldActions[0]!.idempotencyKey,
    incidentStatus: currentStatus,
    assignedUnitId: incident.assignedUnitId,
    existingActionsForIncident,
    submittedAt: clock,
    now: clock,
  });
  if (!retryResult.duplicate) {
    throw new Error('buildFieldLinkFixtures: expected a resubmitted idempotencyKey to be reported as a duplicate — idempotency is broken');
  }

  const incidentUpdate: FieldLinkIncidentUpdate = {
    id: targetIncidentId,
    status: currentStatus,
    closedAt: currentStatus === 'CLOSED' ? clock : null,
    updatedAt: clock,
  };

  return { fieldActions, incidentUpdate };
}

/**
 * The demo's shared H3 coverage grid — used by BOTH the C6 demand-baseline
 * fixture and the coverage-aware recommendation fixture below, so "the
 * coverage grid" is one consistent concept across the seed rather than two
 * independently-sized ones.
 *
 * Ring size 3 around RIYADH_CENTER (37 cells at resolution 8, ~1.4km
 * radius) — this project's own "limited demo extent" choice (spec 19: "a
 * limited demo extent"), not a spec-mandated grid size. Large enough to
 * show real gap/no-gap variety and a meaningful worst-cell, small enough
 * that the seed script's per-cell route/matrix calls stay fast and the
 * resulting H3Prediction row count stays demo-sized rather than
 * city-scale.
 */
const COVERAGE_GRID_RING_SIZE = 3;

export function buildCoverageGridCells(): CoverageCellInput[] {
  const centerCell = latLngToH3Cell(RIYADH_CENTER);
  return h3GridDisk(centerCell, COVERAGE_GRID_RING_SIZE).map((h3Index) => ({
    h3Index,
    center: h3CellToLatLng(h3Index),
  }));
}

export interface H3PredictionRow {
  id: string;
  h3Index: string;
  windowStart: Date;
  windowEnd: Date;
  historicalDemand: number;
  predictedDemand: number;
  lowerBound: number;
  upperBound: number;
  recommendedUnits: number;
  modelVersion: string;
}

/**
 * Builds spec 17's MANDATORY baseline H3 demand predictions by actually
 * RUNNING `buildDemandBaselineModel()`/`predictH3Demand()`
 * (lib/gis/demand-baseline.ts) against every seeded HISTORICAL incident's
 * real `latitude`/`longitude`/`createdAt` — a genuine aggregate-and
 * -seasonally-adjust computation, not hand-typed numbers (see that file's
 * header comment for why this is called out explicitly: an independent
 * AI's attempt at this exact phase hand-typed its H3Prediction rows and
 * labeled them with a model version as if they were computed).
 *
 * Predicts the next 6 hourly windows (from the seed run's own wall-clock
 * "now", floored to the hour) for every cell in the shared coverage grid —
 * this project's own "next few hours" demo horizon, not a spec-mandated
 * one; spec 17 asks for a baseline model, not a specific prediction count.
 * 37 cells × 6 windows = 222 rows.
 */
export function buildH3DemandFixtures(historicalIncidents: IncidentRow[], now: Date): H3PredictionRow[] {
  const model = buildDemandBaselineModel(
    historicalIncidents.map((i) => ({ location: { latitude: i.latitude, longitude: i.longitude }, createdAt: i.createdAt }))
  );
  const cells = buildCoverageGridCells();
  const windowStartBase = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
  const HOURS_AHEAD = 6;

  const rows: H3PredictionRow[] = [];
  for (const cell of cells) {
    for (let h = 0; h < HOURS_AHEAD; h++) {
      const windowStart = new Date(windowStartBase.getTime() + h * 3_600_000);
      const prediction = predictH3Demand(model, cell.h3Index, windowStart);
      rows.push({
        id: `h3pred-${cell.h3Index}-${windowStart.toISOString()}`,
        ...prediction,
      });
    }
  }
  return rows;
}

export interface CoverageRecommendationRow {
  id: string;
  incidentId: string;
  algorithmVersion: string;
  recommendedUnitId: string;
  alternativeUnitId: string | null;
  recommendedEntranceId: string;
  alternativeEntranceId: string | null;
  dispatchScore: number;
  confidenceScore: number;
  reasoning: string[];
  scoreBreakdown: Record<string, number>;
}

/**
 * Builds spec 29.4's coverage-aware Dispatch Score fixture by actually
 * RUNNING `generateCoverageAwareRecommendation()`
 * (lib/dispatch/generate-coverage-recommendation.ts) against `inc-active
 * -03`'s REAL original candidate context — the same `LocationResolution`
 * C4's `buildDispatchFixtures()` used, and the same "AVAILABLE, not
 * already assigned elsewhere" unit-selection rule, independently
 * reapplied here since `inc-active-03` is by this point already CLOSED
 * (C5 carried it there) and can no longer be redispatched through
 * `decideDispatch()`'s state-machine guard.
 *
 * This is deliberately an INFORMATIONAL / simulation-only Recommendation
 * row — `acceptedById`/`acceptedAt`/`rejectedAt` all stay null, and it is
 * never fed back into the Incident row (unlike C4's dispatch fixture and
 * C5's field-link fixture, which both mutate `activeIncidents` in place).
 * It answers "what would coverage-aware Dispatch Score have said about
 * this same decision", not "redo the decision" — `Recommendation` already
 * supports multiple rows per incident by design (a real override flow
 * would produce a second row too), so a second, clearly-labeled row
 * coexisting with C4's original `access-score-v1` row is the correct
 * shape here, not a conflict.
 *
 * Unlike C4's dispatch fixture (which slices candidate units to the
 * nearest 3, matching "a supervisor comparing a short list"),
 * `availableUnits` here is EVERY currently AVAILABLE, unassigned unit —
 * `computeCoverageProtection()`'s "what does removing this unit cost
 * coverage" comparison is only meaningful against the real fleet, not an
 * already-pre-filtered shortlist. Candidate ENTRANCES stay sliced to the
 * nearest 3, same as C4 — that scoping is about entrance practicality, a
 * different concern from unit coverage.
 */
export async function buildCoverageAwareRecommendationFixture(
  activeIncidents: IncidentRow[],
  units: UnitRow[],
  entrances: EntranceRow[],
  locationResolutions: LocationResolutionRow[],
  coverageCells: CoverageCellInput[]
): Promise<CoverageRecommendationRow> {
  const targetIncidentId = 'inc-active-03';
  const incident = activeIncidents.find((i) => i.id === targetIncidentId);
  if (!incident) {
    throw new Error(`buildCoverageAwareRecommendationFixture: no active incident with id "${targetIncidentId}"`);
  }
  const resolution = locationResolutions.find((r) => r.incidentId === targetIncidentId);
  if (!resolution) {
    throw new Error(`buildCoverageAwareRecommendationFixture: no LocationResolution for "${targetIncidentId}"`);
  }

  // Same decisionTime formula buildDispatchFixtures() used (incident
  // createdAt + 2 minutes) — this fixture answers "what would Dispatch
  // Score have said AT THE ORIGINAL DECISION MOMENT", not at reseed time.
  const decisionTime = new Date(incident.createdAt.getTime() + 120_000);
  const routingProvider = new MockRoutingProvider(() => decisionTime);

  const usedUnitIds = new Set(activeIncidents.filter((i) => i.assignedUnitId).map((i) => i.assignedUnitId!));
  const availableUnits: UnitCandidateInput[] = units
    .filter((u) => u.status === 'AVAILABLE' && !usedUnitIds.has(u.id))
    .map((u) => ({ id: u.id, readinessScore: u.readinessScore, location: { latitude: u.latitude, longitude: u.longitude } }));
  if (availableUnits.length === 0) {
    throw new Error('buildCoverageAwareRecommendationFixture: no AVAILABLE, unassigned unit left to evaluate — increase UNIT_COUNT');
  }

  const activeEntrances = entrances.filter((e) => e.active);
  const candidateEntrances: EntranceCandidateInput[] = [...activeEntrances]
    .sort((a, b) => haversineDistanceMeters(resolution, a) - haversineDistanceMeters(resolution, b))
    .slice(0, 3)
    .map((e) => ({
      id: e.id,
      latitude: e.latitude,
      longitude: e.longitude,
      vehicleStopLatitude: undefined,
      vehicleStopLongitude: undefined,
      active: e.active,
      validationStatus: e.validationStatus,
      vehicleAccessible: e.vehicleAccessible,
      pedestrianAccessible: e.pedestrianAccessible,
      isServiceGate: false,
      temporaryRestriction: undefined,
      floorLevel: undefined,
      hasElevator: false,
    }));
  if (candidateEntrances.length === 0) {
    throw new Error('buildCoverageAwareRecommendationFixture: no active entrance available to evaluate');
  }

  const result = await generateCoverageAwareRecommendation({
    incidentId: targetIncidentId,
    locationConfidenceIndex: resolution.confidenceIndex,
    resolvedFloorLevel: resolution.floorLevel,
    availableUnits,
    candidateEntrances,
    coverageCells,
    routingProvider,
  });

  const topCandidate = result.candidates.find(
    (c) => c.unitId === result.recommendedUnitId && c.entranceId === result.recommendedEntranceId
  )!;

  return {
    id: `rec-coverage-${targetIncidentId}`,
    incidentId: targetIncidentId,
    algorithmVersion: result.algorithmVersion,
    recommendedUnitId: result.recommendedUnitId,
    alternativeUnitId: result.alternativeUnitId,
    recommendedEntranceId: result.recommendedEntranceId,
    alternativeEntranceId: result.alternativeEntranceId,
    dispatchScore: result.dispatchScore,
    confidenceScore: result.confidenceScore,
    reasoning: result.reasoning,
    scoreBreakdown: topCandidate.breakdown,
  };
}

async function run(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set — see .env.example');
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();

  try {
    const rng = createSeededRandom(SEED_VALUE);
    const usedRescueCodes = new Set<string>();
    const entrances = buildEntrances(rng);
    const units = buildUnits(rng);
    const historicalIncidents = buildHistoricalIncidents(rng, usedRescueCodes, entrances, units);
    const activeIncidents = buildActiveIncidents(rng, usedRescueCodes, entrances, units);
    const users = buildUsers();

    // Computed here (before the Incident INSERT loop below) rather than
    // after it, unlike buildAssistedCaptureFixtures(): buildDispatchFixtures()
    // needs to MUTATE its target IncidentRow (inc-active-03: READY_FOR_DECISION
    // -> DISPATCHED, with the winning unit/entrance assigned) in place on the
    // very same `activeIncidents` array object the Incident INSERT loop reads
    // from, so the seeded row lands already reflecting the dispatch decision
    // instead of a second UPDATE statement after the fact.
    const anchors = buildLocationAnchors(entrances);
    const { observations: locationObservations, resolutions: locationResolutions } = await buildLocationFixtures(
      activeIncidents,
      anchors,
      entrances
    );
    const dispatch = await buildDispatchFixtures(activeIncidents, units, entrances, locationResolutions);
    const dispatchedIncident = activeIncidents.find((i) => i.id === dispatch.incidentUpdate.id)!;
    dispatchedIncident.status = dispatch.incidentUpdate.status;
    dispatchedIncident.assignedUnitId = dispatch.incidentUpdate.assignedUnitId;
    dispatchedIncident.assignedEntranceId = dispatch.incidentUpdate.assignedEntranceId;
    dispatchedIncident.updatedAt = dispatch.incidentUpdate.updatedAt;

    // Same reason as buildDispatchFixtures() above, one phase further: C5's
    // FieldLink sequence carries inc-active-03 from DISPATCHED to CLOSED,
    // so that final status must also land in the SAME INSERT this row is
    // about to go through, not a later UPDATE.
    const fieldLink = await buildFieldLinkFixtures(activeIncidents);
    const fieldLinkIncident = activeIncidents.find((i) => i.id === fieldLink.incidentUpdate.id)!;
    fieldLinkIncident.status = fieldLink.incidentUpdate.status;
    fieldLinkIncident.closedAt = fieldLink.incidentUpdate.closedAt;
    fieldLinkIncident.updatedAt = fieldLink.incidentUpdate.updatedAt;

    // C6 (spec 17/18/29.4): a real computed H3 demand baseline over every
    // historical incident, plus a coverage-aware "what would Dispatch
    // Score have said" informational Recommendation row for inc-active-03
    // — see both functions' doc comments. Neither mutates an Incident row
    // (the H3 grid isn't incident-scoped at all, and the coverage
    // recommendation is deliberately advisory-only — see its doc comment),
    // so, unlike C4/C5's fixtures above, there is nothing to fold into the
    // upcoming Incident INSERT loop.
    const coverageCells = buildCoverageGridCells();
    const h3Predictions = buildH3DemandFixtures(historicalIncidents, new Date());
    const coverageRecommendation = await buildCoverageAwareRecommendationFixture(
      activeIncidents,
      units,
      entrances,
      locationResolutions,
      coverageCells
    );

    await client.query('BEGIN');

    for (const u of users) {
      await client.query(
        `INSERT INTO "User" (id, name, email, "passwordHash", role, active, "createdAt")
         VALUES ($1, $2, $3, $4, $5::"Role", true, NOW())
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, role = EXCLUDED.role`,
        [u.id, u.name, u.email, 'DEMO_NO_REAL_PASSWORD_HASH', u.role]
      );
    }
    console.log(`seeded ${users.length} users`);

    for (const e of entrances) {
      await client.query(
        `INSERT INTO "Entrance"
           (id, code, "nameAr", "nameEn", latitude, longitude, zone, "accessType",
            "vehicleAccessible", "pedestrianAccessible", active, "validationStatus", synthetic)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::"EntranceAccessType",$9,$10,$11,$12::"ValidationStatus",true)
         ON CONFLICT (id) DO UPDATE SET
           latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
           zone = EXCLUDED.zone, "accessType" = EXCLUDED."accessType",
           "vehicleAccessible" = EXCLUDED."vehicleAccessible",
           "pedestrianAccessible" = EXCLUDED."pedestrianAccessible",
           active = EXCLUDED.active, "validationStatus" = EXCLUDED."validationStatus"`,
        [
          e.id,
          e.code,
          e.nameAr,
          e.nameEn,
          e.latitude,
          e.longitude,
          e.zone,
          e.accessType,
          e.vehicleAccessible,
          e.pedestrianAccessible,
          e.active,
          e.validationStatus,
        ]
      );
    }
    console.log(`seeded ${entrances.length} entrances`);

    for (const u of units) {
      await client.query(
        `INSERT INTO "AmbulanceUnit" (id, code, label, "crewType", status, "readinessScore", "homeZone", synthetic, "createdAt", "updatedAt")
         VALUES ($1,$2,$3,$4::"CrewType",$5::"UnitStatus",$6,$7,true,NOW(),NOW())
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status, "readinessScore" = EXCLUDED."readinessScore",
           "homeZone" = EXCLUDED."homeZone", "updatedAt" = NOW()`,
        [u.id, u.code, u.label, u.crewType, u.status, u.readinessScore, u.homeZone]
      );

      await client.query(
        `INSERT INTO "UnitLocation" (id, "unitId", latitude, longitude, "accuracyMeters", "capturedAt", synthetic)
         VALUES ($1,$2,$3,$4,$5,NOW(),true)
         ON CONFLICT (id) DO UPDATE SET latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude, "capturedAt" = NOW()`,
        [`${u.id}-loc-current`, u.id, u.latitude, u.longitude, randomFloat(rng, 5, 30)]
      );

      const connectivity: Connectivity = randomChoice(rng, ['ONLINE', 'ONLINE', 'ONLINE', 'DEGRADED', 'STALE']);
      await client.query(
        `INSERT INTO "DeviceHeartbeat" (id, "unitId", "deviceIdHash", connectivity, "batteryLevel", "capturedAt", synthetic)
         VALUES ($1,$2,$3,$4::"Connectivity",$5,NOW(),true)
         ON CONFLICT (id) DO UPDATE SET connectivity = EXCLUDED.connectivity, "batteryLevel" = EXCLUDED."batteryLevel", "capturedAt" = NOW()`,
        [`${u.id}-heartbeat-current`, u.id, createHash('sha256').update(`device:${u.id}`).digest('hex'), connectivity, randomInt(rng, 15, 100)]
      );
    }
    console.log(`seeded ${units.length} units (+ current location + heartbeat each)`);

    // Clear every active incident's assignedUnitId BEFORE the upsert loop
    // below re-sets it. Without this, a reseed whose deterministic unit
    // assignments changed since the last run (e.g. after an unrelated edit
    // shifted the shared PRNG's draw sequence) can transiently violate
    // Incident_one_active_assignment_per_unit: row-by-row upserts are not
    // atomic as a set, so if incident A's OLD assignedUnitId equals
    // incident B's NEW one and B is upserted before A gets updated away
    // from that old value, the partial unique index rejects B's UPDATE
    // even though the FINAL state (after the whole batch) would have been
    // perfectly valid. A single bulk NULL-out first means every active id
    // starts from "unassigned" before any of the new values are set, so no
    // processing order can ever collide with a stale value. Historical
    // incidents don't need this — they're CLOSED, exempt from the
    // constraint (see the migration's own comment on this index).
    await client.query(
      `UPDATE "Incident" SET "assignedUnitId" = NULL WHERE id = ANY($1::text[])`,
      [activeIncidents.map((i) => i.id)]
    );

    const allIncidents = [...historicalIncidents, ...activeIncidents];
    const BATCH_SIZE = 200;
    for (let start = 0; start < allIncidents.length; start += BATCH_SIZE) {
      const batch = allIncidents.slice(start, start + BATCH_SIZE);
      for (const inc of batch) {
        await client.query(
          `INSERT INTO "Incident"
             (id, "rescueCode", "callerTokenHash", "callerTokenExpiresAt", status, priority, "proposedPriority",
              latitude, longitude, "gpsAccuracyMeters", "confidenceScore", "confidenceVersion", "placeType",
              "floorLevel", language, "unableToSpeak", "callerName", "callerPhone", description,
              "suggestedEntranceId", "assignedEntranceId", "assignedUnitId", synthetic,
              "createdAt", "updatedAt", "closedAt")
           VALUES
             ($1,$2,$3,$4,$5::"IncidentStatus",$6::"Priority",$7::"Priority",$8,$9,$10,$11,$12,$13::"PlaceType",
              $14,$15,$16,$17,$18,$19,$20,$21,$22,true,$23,$24,$25)
           ON CONFLICT (id) DO UPDATE SET
             status = EXCLUDED.status, priority = EXCLUDED.priority,
             latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
             "confidenceScore" = EXCLUDED."confidenceScore", "assignedUnitId" = EXCLUDED."assignedUnitId",
             "assignedEntranceId" = EXCLUDED."assignedEntranceId", "updatedAt" = EXCLUDED."updatedAt",
             "closedAt" = EXCLUDED."closedAt"`,
          [
            inc.id,
            inc.rescueCode,
            inc.callerTokenHash,
            inc.callerTokenExpiresAt,
            inc.status,
            inc.priority,
            inc.proposedPriority,
            inc.latitude,
            inc.longitude,
            inc.gpsAccuracyMeters,
            inc.confidenceScore,
            inc.confidenceVersion,
            inc.placeType,
            inc.floorLevel,
            inc.language,
            inc.unableToSpeak,
            inc.callerName,
            inc.callerPhone,
            inc.description,
            inc.suggestedEntranceId,
            inc.assignedEntranceId,
            inc.assignedUnitId,
            inc.createdAt,
            inc.updatedAt,
            inc.closedAt,
          ]
        );

        await client.query(
          `INSERT INTO "IncidentEvent" (id, "incidentId", "actorType", "eventType", "nextStatus", "createdAt")
           VALUES ($1,$2,'SYSTEM'::"ActorType",'CREATED'::"IncidentEventType",'NEW'::"IncidentStatus",$3)
           ON CONFLICT (id) DO NOTHING`,
          [`${inc.id}-evt-created`, inc.id, inc.createdAt]
        );
      }
      console.log(`seeded incidents ${start + 1}-${Math.min(start + BATCH_SIZE, allIncidents.length)} of ${allIncidents.length}`);
    }

    const { drafts: captureDrafts, suggestions: fieldSuggestions } = await buildAssistedCaptureFixtures(activeIncidents);

    for (const d of captureDrafts) {
      await client.query(
        `INSERT INTO "AssistedCaptureDraft"
           (id, "incidentId", "sourceType", "sourceLanguage", "targetLanguage", "translatedText",
            provider, "modelVersion", status, synthetic, "createdAt", "expiresAt")
         VALUES ($1,$2,$3::"CaptureSourceType",$4,$5,$6,$7,$8,$9::"DraftStatus",true,$10,$11)
         ON CONFLICT (id) DO UPDATE SET
           "translatedText" = EXCLUDED."translatedText", status = EXCLUDED.status,
           "expiresAt" = EXCLUDED."expiresAt"`,
        [
          d.id,
          d.incidentId,
          d.sourceType,
          d.sourceLanguage,
          d.targetLanguage,
          d.translatedText,
          d.provider,
          d.modelVersion,
          d.status,
          d.createdAt,
          d.expiresAt,
        ]
      );
    }

    for (const s of fieldSuggestions) {
      await client.query(
        `INSERT INTO "ExtractedFieldSuggestion"
           (id, "draftId", "fieldName", "suggestedValue", "evidenceTextMasked", confidence,
            status, "finalValue", "reviewedById", "reviewedAt", "createdAt")
         VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7::"SuggestionStatus",$8::jsonb,$9,$10,$11)
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status, "finalValue" = EXCLUDED."finalValue",
           "reviewedById" = EXCLUDED."reviewedById", "reviewedAt" = EXCLUDED."reviewedAt"`,
        [
          s.id,
          s.draftId,
          s.fieldName,
          JSON.stringify(s.suggestedValue),
          s.evidenceTextMasked,
          s.confidence,
          s.status,
          s.finalValue === null ? null : JSON.stringify(s.finalValue),
          s.reviewedById,
          s.reviewedAt,
          s.createdAt,
        ]
      );
    }
    console.log(`seeded ${captureDrafts.length} assisted-capture drafts (+${fieldSuggestions.length} field suggestions)`);

    // anchors computed earlier (before the Incident INSERT loop) —
    // see this function's opening comment.
    for (const a of anchors) {
      await client.query(
        `INSERT INTO "LocationAnchor"
           (id, code, "entranceId", "floorLevel", latitude, longitude, "anchorType",
            "validationStatus", "validFrom", "validUntil", active, synthetic)
         VALUES ($1,$2,$3,$4,$5,$6,$7::"AnchorType",$8::"ValidationStatus",$9,$10,$11,true)
         ON CONFLICT (id) DO UPDATE SET
           "floorLevel" = EXCLUDED."floorLevel", latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
           "anchorType" = EXCLUDED."anchorType", active = EXCLUDED.active`,
        [
          a.id,
          a.code,
          a.entranceId,
          a.floorLevel,
          a.latitude,
          a.longitude,
          a.anchorType,
          a.validationStatus,
          a.validFrom,
          a.validUntil,
          a.active,
        ]
      );
    }
    console.log(`seeded ${anchors.length} Rescue Anchors (spec 29.1)`);

    // locationObservations/locationResolutions computed earlier too (same
    // reason as anchors above).

    // LocationObservation/LocationResolution are APPEND-ONLY (see the C3
    // migration's triggers) — `ON CONFLICT DO UPDATE` would fire an UPDATE
    // and be rejected by those triggers on a re-run, so this uses
    // `DO NOTHING` instead: a re-seed re-affirms the same rows by leaving
    // already-present ones untouched, exactly like the append-only rule
    // intends.
    for (const o of locationObservations) {
      await client.query(
        `INSERT INTO "LocationObservation"
           (id, "incidentId", source, latitude, longitude, "horizontalAccuracyMeters",
            "floorLevel", "capturedAt", "provenanceLabel", metadata, synthetic)
         VALUES ($1,$2,$3::"LocationObservationSource",$4,$5,$6,$7,$8,$9,$10::jsonb,true)
         ON CONFLICT (id) DO NOTHING`,
        [
          o.id,
          o.incidentId,
          o.source,
          o.latitude,
          o.longitude,
          o.horizontalAccuracyMeters,
          o.floorLevel,
          o.capturedAt,
          o.provenanceLabel,
          JSON.stringify(o.metadata),
        ]
      );
    }

    for (const r of locationResolutions) {
      await client.query(
        `INSERT INTO "LocationResolution"
           (id, "incidentId", latitude, longitude, "uncertaintyRadiusMeters", "confidenceIndex",
            "primaryObservationId", "supportingObservationIds", "conflictingObservationIds",
            "selectedEntranceId", "floorLevel", "algorithmVersion", "resolvedById", "createdAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14)
         ON CONFLICT (id) DO NOTHING`,
        [
          r.id,
          r.incidentId,
          r.latitude,
          r.longitude,
          r.uncertaintyRadiusMeters,
          r.confidenceIndex,
          r.primaryObservationId,
          JSON.stringify(r.supportingObservationIds),
          JSON.stringify(r.conflictingObservationIds),
          r.selectedEntranceId,
          r.floorLevel,
          r.algorithmVersion,
          r.resolvedById,
          r.createdAt,
        ]
      );
    }
    console.log(`seeded ${locationObservations.length} location observations (+${locationResolutions.length} resolutions)`);

    // C4 golden path (spec 15/16): every (unit, entrance) candidate
    // generateRecommendation() actually scored, plus the one Recommendation
    // it produced — see buildDispatchFixtures()'s doc comment.
    for (const rs of dispatch.routeSnapshots) {
      await client.query(
        `INSERT INTO "RouteSnapshot"
           (id, "incidentId", "unitId", "entranceId", provider, "providerMode",
            "distanceMeters", "durationSeconds", geometry, "dataFreshnessAt", synthetic)
         VALUES ($1,$2,$3,$4,$5,$6::"RoutingProviderMode",$7,$8,$9::jsonb,$10,true)
         ON CONFLICT (id) DO UPDATE SET
           "distanceMeters" = EXCLUDED."distanceMeters", "durationSeconds" = EXCLUDED."durationSeconds",
           geometry = EXCLUDED.geometry, "dataFreshnessAt" = EXCLUDED."dataFreshnessAt"`,
        [
          rs.id,
          rs.incidentId,
          rs.unitId,
          rs.entranceId,
          rs.provider,
          rs.providerMode,
          rs.distanceMeters,
          rs.durationSeconds,
          JSON.stringify(rs.geometry),
          rs.dataFreshnessAt,
        ]
      );
    }
    console.log(`seeded ${dispatch.routeSnapshots.length} route snapshots`);

    const rec = dispatch.recommendation;
    await client.query(
      `INSERT INTO "Recommendation"
         (id, "incidentId", "algorithmVersion", "recommendedUnitId", "alternativeUnitId",
          "recommendedEntranceId", "alternativeEntranceId", "accessScore", "confidenceScore",
          reasoning, "scoreBreakdown", "acceptedById", "acceptedAt", "rejectedAt", "overrideReason", synthetic)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13,$14,$15,true)
       ON CONFLICT (id) DO UPDATE SET
         "accessScore" = EXCLUDED."accessScore", "confidenceScore" = EXCLUDED."confidenceScore",
         reasoning = EXCLUDED.reasoning, "scoreBreakdown" = EXCLUDED."scoreBreakdown",
         "acceptedById" = EXCLUDED."acceptedById", "acceptedAt" = EXCLUDED."acceptedAt"`,
      [
        rec.id,
        rec.incidentId,
        rec.algorithmVersion,
        rec.recommendedUnitId,
        rec.alternativeUnitId,
        rec.recommendedEntranceId,
        rec.alternativeEntranceId,
        rec.accessScore,
        rec.confidenceScore,
        JSON.stringify(rec.reasoning),
        JSON.stringify(rec.scoreBreakdown),
        rec.acceptedById,
        rec.acceptedAt,
        rec.rejectedAt,
        rec.overrideReason,
      ]
    );
    console.log(`seeded 1 recommendation (accepted, incident ${rec.incidentId} -> DISPATCHED)`);

    await client.query(
      `INSERT INTO "IncidentEvent" (id, "incidentId", "actorType", "actorId", "eventType", "previousStatus", "nextStatus", metadata, "createdAt")
       VALUES ($1,$2,'SUPERVISOR'::"ActorType",$3,'UNIT_ASSIGNED'::"IncidentEventType",'READY_FOR_DECISION'::"IncidentStatus",'DISPATCHED'::"IncidentStatus",$4::jsonb,$5)
       ON CONFLICT (id) DO NOTHING`,
      [
        `${dispatch.incidentUpdate.id}-evt-dispatched`,
        dispatch.incidentUpdate.id,
        rec.acceptedById,
        JSON.stringify({ recommendationId: rec.id, accessScore: rec.accessScore, assignedUnitId: dispatch.incidentUpdate.assignedUnitId, assignedEntranceId: dispatch.incidentUpdate.assignedEntranceId }),
        dispatch.incidentUpdate.updatedAt,
      ]
    );

    // C5 golden path (spec 30.5/30.14 #6): every real FieldAction
    // submitFieldAction() produced for inc-active-03's medic sequence —
    // see buildFieldLinkFixtures()'s doc comment. APPEND-ONLY table (same
    // trigger as C3's LocationObservation/LocationResolution) — DO NOTHING
    // on conflict, same reasoning as those two.
    //
    // CAVEAT (found live while restoring the full-count seed after C5 dev
    // testing under SEED_HISTORICAL_COUNT=200): because this table can
    // never be UPDATEd, a reseed against a DB that already has these rows
    // from an EARLIER run with a DIFFERENT SEED_HISTORICAL_COUNT silently
    // keeps the stale timestamps (DO NOTHING), while the Incident row's
    // updatedAt/closedAt/status — which DO upsert — get overwritten with
    // values derived from THIS run's freshly-drawn createdAt. The two end
    // up mutually inconsistent (e.g. Incident.closedAt earlier than its
    // own CLOSE_TASK FieldAction.submittedAt). This is not a bug in
    // submitFieldAction()/buildFieldLinkFixtures() — each run is
    // internally consistent — it's a reseed-across-different-parameters
    // hazard specific to append-only tables. Fix: TRUNCATE ... CASCADE
    // (safe — TRUNCATE does not fire the per-row BEFORE DELETE trigger)
    // and reseed fresh whenever SEED_HISTORICAL_COUNT changes between
    // runs against the same database.
    for (const fa of fieldLink.fieldActions) {
      await client.query(
        `INSERT INTO "FieldAction"
           (id, "incidentId", "unitId", "actorId", "actionType", "idempotencyKey", payload,
            "previousStatus", "resultingStatus", "submittedAt", "processedAt", synthetic)
         VALUES ($1,$2,$3,$4,$5::"FieldActionType",$6,$7::jsonb,$8::"IncidentStatus",$9::"IncidentStatus",$10,$11,true)
         ON CONFLICT (id) DO NOTHING`,
        [
          fa.id,
          fa.incidentId,
          fa.unitId,
          fa.actorId,
          fa.actionType,
          fa.idempotencyKey,
          fa.payload === null ? null : JSON.stringify(fa.payload),
          fa.previousStatus,
          fa.resultingStatus,
          fa.submittedAt,
          fa.processedAt,
        ]
      );
    }
    console.log(`seeded ${fieldLink.fieldActions.length} field actions (incident ${fieldLink.incidentUpdate.id} -> ${fieldLink.incidentUpdate.status})`);

    // One IncidentEvent per status-changing FieldAction — reuses the exact
    // IncidentEventType values C1 already defined for this
    // (EN_ROUTE/AT_ACCESS_POINT/ON_SCENE/CLOSED), now attributed to MEDIC
    // rather than only ever being written by call-taker/supervisor actions.
    for (const fa of fieldLink.fieldActions) {
      if (!fa.resultingStatus) continue;
      await client.query(
        `INSERT INTO "IncidentEvent" (id, "incidentId", "actorType", "actorId", "eventType", "previousStatus", "nextStatus", "createdAt")
         VALUES ($1,$2,'MEDIC'::"ActorType",$3,$4::"IncidentEventType",$5::"IncidentStatus",$6::"IncidentStatus",$7)
         ON CONFLICT (id) DO NOTHING`,
        [`${fa.id}-evt`, fa.incidentId, fa.actorId, fa.resultingStatus, fa.previousStatus, fa.resultingStatus, fa.processedAt]
      );
    }

    // C6 golden path (spec 17): every H3Prediction row
    // buildH3DemandFixtures() computed — a genuine baseline, not
    // hand-typed rows (see that function's doc comment). Not append-only
    // (see schema.prisma's H3Prediction doc comment): a later reseed
    // legitimately recomputes and updates the same (cell, windowStart)
    // prediction rather than accumulating stale duplicates forever.
    for (const p of h3Predictions) {
      await client.query(
        `INSERT INTO "H3Prediction"
           (id, "h3Index", "windowStart", "windowEnd", "historicalDemand", "predictedDemand",
            "lowerBound", "upperBound", "recommendedUnits", "modelVersion", synthetic)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true)
         ON CONFLICT (id) DO UPDATE SET
           "historicalDemand" = EXCLUDED."historicalDemand", "predictedDemand" = EXCLUDED."predictedDemand",
           "lowerBound" = EXCLUDED."lowerBound", "upperBound" = EXCLUDED."upperBound",
           "recommendedUnits" = EXCLUDED."recommendedUnits"`,
        [
          p.id,
          p.h3Index,
          p.windowStart,
          p.windowEnd,
          p.historicalDemand,
          p.predictedDemand,
          p.lowerBound,
          p.upperBound,
          p.recommendedUnits,
          p.modelVersion,
        ]
      );
    }
    console.log(`seeded ${h3Predictions.length} H3 demand predictions (${coverageCells.length} cells × 6h horizon)`);

    // C6 golden path (spec 29.4): the coverage-aware Dispatch Score
    // Recommendation row — see buildCoverageAwareRecommendationFixture()'s
    // doc comment for why this is a SECOND, informational row on
    // inc-active-03 rather than a mutation of C4's original one.
    const covRec = coverageRecommendation;
    await client.query(
      `INSERT INTO "Recommendation"
         (id, "incidentId", "algorithmVersion", "recommendedUnitId", "alternativeUnitId",
          "recommendedEntranceId", "alternativeEntranceId", "accessScore", "confidenceScore",
          reasoning, "scoreBreakdown", "acceptedById", "acceptedAt", "rejectedAt", "overrideReason", synthetic)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,NULL,NULL,NULL,NULL,true)
       ON CONFLICT (id) DO UPDATE SET
         "accessScore" = EXCLUDED."accessScore", "confidenceScore" = EXCLUDED."confidenceScore",
         reasoning = EXCLUDED.reasoning, "scoreBreakdown" = EXCLUDED."scoreBreakdown"`,
      [
        covRec.id,
        covRec.incidentId,
        covRec.algorithmVersion,
        covRec.recommendedUnitId,
        covRec.alternativeUnitId,
        covRec.recommendedEntranceId,
        covRec.alternativeEntranceId,
        covRec.dispatchScore,
        covRec.confidenceScore,
        JSON.stringify(covRec.reasoning),
        JSON.stringify(covRec.scoreBreakdown),
      ]
    );
    console.log(`seeded 1 coverage-aware recommendation (simulation, algorithm ${covRec.algorithmVersion}, unit ${covRec.recommendedUnitId})`);

    await client.query('COMMIT');
    console.log(
      `done: ${users.length} users, ${entrances.length} entrances, ${units.length} units, ` +
        `${historicalIncidents.length} historical incidents, ${activeIncidents.length} active incidents, ` +
        `${captureDrafts.length} assisted-capture drafts, ${fieldSuggestions.length} field suggestions, ` +
        `${anchors.length} location anchors, ${locationObservations.length} location observations, ${locationResolutions.length} location resolutions, ` +
        `${dispatch.routeSnapshots.length} route snapshots, 2 recommendations, ${fieldLink.fieldActions.length} field actions, ` +
        `${h3Predictions.length} H3 demand predictions`
    );
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

// Only connect to Postgres and run when this file is executed directly
// (`tsx scripts/seed-demo.ts` / `npm run seed`) — NOT when it is imported,
// e.g. by tests/unit/seed-synthetic.test.ts importing the pure builder
// functions above. That import must never open a database connection.
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  run().catch((err) => {
    console.error('seed-demo failed:', err);
    process.exitCode = 1;
  });
}
