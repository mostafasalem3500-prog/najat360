/**
 * Hand-written domain types mirroring prisma/schema.prisma.
 *
 * Why hand-written instead of `import { Incident } from '@prisma/client'`:
 * this sandbox's network egress blocks binaries.prisma.sh, so `prisma
 * generate` cannot download the query engine here and no generated client
 * exists. These types are deliberately kept in exact sync with the schema so
 * that once `prisma generate` runs on a machine with normal internet access,
 * `@prisma/client`'s generated types are a drop-in superset of these — swap
 * imports at that point and delete this file. See docs/product/C1-phase-report.md.
 */

export const ROLES = [
  'CALLER',
  'CALL_TAKER',
  'SUPERVISOR',
  'MEDIC',
  'RESPONSE_COORDINATOR',
  'HOSPITAL_LIAISON',
  'ANALYST',
  'ADMIN',
] as const;
export type Role = (typeof ROLES)[number];

export type ActorType = Role | 'SYSTEM';

export const INCIDENT_STATUSES = [
  'NEW',
  'VERIFYING',
  'READY_FOR_DECISION',
  'DISPATCHED',
  'EN_ROUTE',
  'AT_ACCESS_POINT',
  'ON_SCENE',
  'CLOSED',
  'LOW_CONFIDENCE',
  'NO_UNIT_AVAILABLE',
  'ACCESS_BLOCKED',
  'DUPLICATE_SUSPECTED',
  'CANCELLED_BY_OPERATOR',
  'LOST_CONNECTIVITY',
] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const TERMINAL_STATUSES: readonly IncidentStatus[] = ['CLOSED', 'CANCELLED_BY_OPERATOR'];

export type Priority = 'HIGH' | 'MEDIUM' | 'LOW';

export const PLACE_TYPES = [
  'RESIDENTIAL',
  'COMMERCIAL',
  'OUTDOOR_PUBLIC',
  'RELIGIOUS_SITE',
  'TRANSPORT_HUB',
  'EVENT_VENUE',
  'OTHER',
] as const;
export type PlaceType = (typeof PLACE_TYPES)[number];

/**
 * Not enumerated explicitly in spec 30.4 (preferredCommunicationMode is
 * listed only by name); this fixed set is this project's own choice, kept
 * small and spec-adjacent to section 29.6's "unableToSpeak" flow (voice vs.
 * text vs. a human relay). Domain's `Incident.preferredCommunicationMode`
 * stays a plain `string | null` so this list can grow without a migration;
 * the AI-suggestion boundary (assisted-capture/allowlist.ts) is what
 * actually restricts suggested values to this set.
 */
export const COMMUNICATION_MODES = ['VOICE', 'TEXT_ONLY', 'SIGN_LANGUAGE', 'THIRD_PARTY_RELAY'] as const;
export type CommunicationMode = (typeof COMMUNICATION_MODES)[number];

export type CrewType = 'AMBULANCE' | 'RAPID_RESPONSE' | 'FOOT_TEAM';
export type UnitStatus = 'AVAILABLE' | 'BUSY' | 'OUT_OF_SERVICE';
export type EntranceAccessType = 'ROAD' | 'PEDESTRIAN' | 'SERVICE';
export type ValidationStatus = 'UNVERIFIED' | 'MANUALLY_REVIEWED' | 'FIELD_CONFIRMED';

export type IncidentEventType =
  | 'CREATED'
  | 'LOCATION_UPDATED'
  | 'PRIORITY_PROPOSED'
  | 'PRIORITY_APPROVED'
  | 'UNIT_ASSIGNED'
  | 'RECOMMENDATION_OVERRIDDEN'
  | 'STATUS_TRANSITION'
  | 'EN_ROUTE'
  | 'AT_ACCESS_POINT'
  | 'ON_SCENE'
  | 'DELAY_ALERT'
  | 'ACCESS_BLOCKED'
  | 'SUGGESTION_ACCEPTED'
  | 'SUGGESTION_EDITED'
  | 'SUGGESTION_REJECTED'
  | 'SUGGESTION_REJECTED_INVALID_FIELD'
  | 'CLOSED';

export type CaptureSourceType = 'TEXT' | 'AUDIO_TRANSCRIPT';
export type DraftStatus = 'DRAFT' | 'PARTIALLY_CONFIRMED' | 'CONFIRMED' | 'REJECTED';
export type SuggestionStatus = 'PENDING' | 'ACCEPTED' | 'EDITED' | 'REJECTED';
export type Connectivity = 'ONLINE' | 'DEGRADED' | 'STALE' | 'OUT_OF_REACH';

export interface User {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
  scopeZone?: string | null;
  active: boolean;
  createdAt: Date;
}

export interface Incident {
  id: string;
  rescueCode: string;
  /** Hash of the caller's one-time link token — the raw token is never stored (spec section 13). */
  callerTokenHash: string;
  callerTokenExpiresAt: Date;
  status: IncidentStatus;
  priority?: Priority | null;
  proposedPriority?: Priority | null;
  latitude: number;
  longitude: number;
  gpsAccuracyMeters?: number | null;
  locationCapturedAt?: Date | null;
  uncertaintyRadiusMeters?: number | null;
  confidenceScore?: number | null;
  confidenceVersion?: string | null;
  placeType?: PlaceType | null;
  floorLevel?: string | null;
  language: string;
  unableToSpeak: boolean;
  /** Callback contact captured during intake — see schema.prisma for the RBAC rationale. */
  callerName?: string | null;
  callerPhone?: string | null;
  /** Free-text intake description — caller-facing content, not a clinical field. */
  description?: string | null;
  /** ALLOWLIST-target fields (lib/assisted-capture/allowlist.ts) — see lib/assisted-capture/field-mapping.ts for how a suggestion's fieldName lands on one of these. */
  reportedPatientCount?: number | null;
  entranceOrGateHint?: string | null;
  landmarkText?: string | null;
  accessObstacle?: string | null;
  sceneHazardReported?: string | null;
  preferredCommunicationMode?: string | null;
  h3Index?: string | null;
  suggestedEntranceId?: string | null;
  assignedEntranceId?: string | null;
  assignedUnitId?: string | null;
  /** Enforced non-null (and >= 5 trimmed chars) at the DB layer whenever status is CANCELLED_BY_OPERATOR — see prisma/migrations/0001_init/migration.sql's Incident_cancel_requires_reason CHECK constraint. */
  cancellationOverrideReason?: string | null;
  /** The status this incident was in right before entering LOST_CONNECTIVITY, so recovery can be validated against it — see lib/incidents/state-machine.ts's ConnectivityRecoveryMismatchError. Null except while status is LOST_CONNECTIVITY. */
  statusBeforeConnectivityLoss?: IncidentStatus | null;
  synthetic: boolean;
  createdAt: Date;
  updatedAt: Date;
  closedAt?: Date | null;
}

export interface AmbulanceUnit {
  id: string;
  code: string;
  label: string;
  crewType: CrewType;
  status: UnitStatus;
  readinessScore: number;
  homeZone: string;
  estimatedAvailabilityMinutes?: number | null;
  synthetic: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Entrance {
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
  lastValidatedAt?: Date | null;
  synthetic: boolean;

  // C3 / spec 29.3 "آخر 100 متر والطابق" — last-100-meters + floor support.
  // Deliberately DATA fields only: no routing/route-computation logic is
  // built this phase (that needs a RoutingProvider abstraction, out of
  // scope until it has its own phase). This is the last-mile geometry a
  // future medic-screen "two route cards" feature will read.
  /** Where a responding vehicle should actually stop — often not the same point as `latitude`/`longitude`, which is the entrance door itself. */
  vehicleStopLatitude?: number | null;
  vehicleStopLongitude?: number | null;
  /** Raw GeoJSON (LineString) text for the walking path from the vehicle stop point to this entrance. Opaque to this project's own code — stored and rendered, never parsed/validated as real geometry (no PostGIS this phase; see prisma/schema.prisma header notes). */
  pedestrianPathGeoJson?: string | null;
  /** The floor this specific entrance/access point serves, when relevant (e.g. a basement service entrance vs. the main ground-floor door). Independent of any per-incident `LocationAnchor.floorLevel`. */
  floorLevel?: string | null;
  hasStairs: boolean;
  hasElevator: boolean;
  accessibilityNotes?: string | null;
  /** True for a staff/service gate not meant for general public routing — spec 29.3's "service gate and temporary restriction". */
  isServiceGate: boolean;
  /** Free-text note for a known, currently-active restriction (e.g. "مغلق للصيانة حتى الساعة 5"). Null when nothing is currently restricted. */
  temporaryRestriction?: string | null;
  /** Who/what last confirmed `lastValidatedAt` — e.g. 'FIELD_SURVEY', 'CALL_TAKER_CONFIRMED', 'SEED_DEMO'. Spec 29.3's "last validated date and validator source" — the date half is `lastValidatedAt` above. */
  lastValidatedBySource?: string | null;
}

export const LOCATION_OBSERVATION_SOURCES = [
  'BROWSER_GPS',
  'MANUAL_PIN',
  'ANCHOR_QR',
  'LANDMARK',
  'NATIONAL_ADDRESS',
  'WHAT3WORDS_OPTIONAL',
  'CALL_TAKER',
] as const;
export type LocationObservationSource = (typeof LOCATION_OBSERVATION_SOURCES)[number];

export const ANCHOR_TYPES = ['ENTRANCE', 'FLOOR', 'ZONE'] as const;
export type AnchorType = (typeof ANCHOR_TYPES)[number];

/**
 * A pre-registered QR/NFC physical point (spec 29.1 "Rescue Anchors").
 * `code` is the only thing a client is ever trusted to supply; every other
 * field here is looked up server-side by `code` — see
 * `lib/location/anchor-resolution.ts`, which has no code path that accepts
 * caller-supplied coordinates for an ANCHOR_QR observation.
 */
export interface LocationAnchor {
  id: string;
  code: string;
  entranceId: string;
  floorLevel?: string | null;
  latitude: number;
  longitude: number;
  anchorType: AnchorType;
  validationStatus: ValidationStatus;
  validFrom: Date;
  validUntil?: Date | null;
  active: boolean;
  synthetic: boolean;
}

/**
 * One raw location signal for an incident (spec 29.2). Append-only by
 * design: nothing in this codebase updates or deletes a row here once
 * created (enforced additionally at the DB layer — see the
 * `LocationObservation` trigger in the C3 migration). A new, corrected
 * reading is always a NEW row, never an edit to an old one.
 */
export interface LocationObservation {
  id: string;
  incidentId: string;
  source: LocationObservationSource;
  latitude: number;
  longitude: number;
  horizontalAccuracyMeters?: number | null;
  verticalAccuracyMeters?: number | null;
  floorLevel?: string | null;
  capturedAt: Date;
  provenanceLabel: string;
  /** Free-form JSON, e.g. `{coordinateAuthority: 'SERVER_ANCHOR_RECORD' | 'CALLER_DEVICE', anchorId?, anchorType?}` — see anchor-resolution.ts. Never contains raw caller PII beyond what the source itself already carries. */
  metadata: Record<string, unknown>;
  synthetic: boolean;
}

/**
 * A resolved best-estimate location for an incident at a point in time
 * (spec 29.2). Every call to `resolveLocation()` that gets persisted is a
 * NEW snapshot row, never an update to a previous one — the full history
 * of how the incident's location understanding evolved stays queryable.
 * `confidenceIndex` is the same 0–100 operational index as
 * `lib/confidence.ts`'s Location Confidence Index (NOT a probability —
 * spec line 659's naming rule applies here identically).
 */
export interface LocationResolution {
  id: string;
  incidentId: string;
  latitude: number;
  longitude: number;
  uncertaintyRadiusMeters: number;
  confidenceIndex: number;
  primaryObservationId: string;
  supportingObservationIds: string[];
  conflictingObservationIds: string[];
  selectedEntranceId?: string | null;
  floorLevel?: string | null;
  algorithmVersion: string;
  resolvedById?: string | null;
  createdAt: Date;
}

export interface IncidentEvent {
  id: string;
  incidentId: string;
  actorType: ActorType;
  actorId?: string | null;
  eventType: IncidentEventType;
  previousStatus?: IncidentStatus | null;
  nextStatus?: IncidentStatus | null;
  latitude?: number | null;
  longitude?: number | null;
  overrideReason?: string | null;
  metadata?: unknown;
  createdAt: Date;
}

export interface AssistedCaptureDraft {
  id: string;
  incidentId: string;
  sourceType: CaptureSourceType;
  sourceLanguage: string;
  targetLanguage: string;
  translatedText?: string | null;
  provider: string;
  modelVersion: string;
  status: DraftStatus;
  synthetic: boolean;
  createdAt: Date;
  expiresAt: Date;
}

export interface ExtractedFieldSuggestion {
  id: string;
  draftId: string;
  fieldName: string;
  suggestedValue: unknown;
  evidenceTextMasked?: string | null;
  confidence: number;
  status: SuggestionStatus;
  finalValue?: unknown;
  reviewedById?: string | null;
  reviewedAt?: Date | null;
  createdAt: Date;
}

export interface DeviceHeartbeat {
  id: string;
  unitId: string;
  deviceIdHash: string;
  connectivity: Connectivity;
  batteryLevel?: number | null;
  capturedAt: Date;
  synthetic: boolean;
}

/**
 * spec 30.5 — FieldLink's fixed action list. Deliberately does NOT include
 * START_TRANSPORT/START_HANDOVER/END_HANDOVER even though spec's own
 * FieldLink action list names them: those three are hospital-handover
 * concepts explicitly deferred to C8 (see
 * lib/incidents/state-machine.ts's header comment — the handover states
 * TRANSPORT_DECISION -> ... -> END_HANDOVER aren't in this project's state
 * graph yet). Confirmed via a C5 comparison review that an independent AI
 * attempt at this same phase correctly made the same exclusion (added the
 * three handover actions only in its own later C8 migration) — this
 * project follows the same discipline, not by coincidence.
 */
export const FIELD_ACTION_TYPES = [
  'ACCEPT_TASK',
  'START_MOVING',
  'AT_ACCESS_POINT',
  'ON_SCENE',
  'ACCESS_BLOCKED',
  'REQUEST_LOCATION_REFRESH',
  'PROPOSE_ALTERNATE_ENTRANCE',
  'CLOSE_TASK',
] as const;
export type FieldActionType = (typeof FIELD_ACTION_TYPES)[number];

/**
 * spec 30.5 — one medic action, always processed through
 * lib/fieldlink/field-action.ts's submitFieldAction() gatekeeper.
 * APPEND-ONLY (same trigger-enforced pattern as C3's LocationObservation/
 * LocationResolution — see prisma/migrations/0004_c5_fieldlink): a field
 * action log is inherently a historical record, never edited in place.
 */
export interface FieldAction {
  id: string;
  incidentId: string;
  unitId: string;
  actorId: string;
  actionType: FieldActionType;
  /** Client-generated, unique — spec 30.5/30.14 #6: resubmitting the same offline-queued action must be a no-op, not a second apply. */
  idempotencyKey: string;
  payload?: Record<string, unknown> | null;
  previousStatus?: IncidentStatus | null;
  resultingStatus?: IncidentStatus | null;
  /** When the medic's device recorded the action — may be well before `processedAt` if it sat in an offline queue. */
  submittedAt: Date;
  processedAt: Date;
  synthetic: boolean;
  createdAt: Date;
}

export interface AuditLog {
  id: string;
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  createdAt: Date;
}
