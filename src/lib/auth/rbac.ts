/**
 * Role-based access control — section 30.11 of NAJAT360_CLAUDE_MASTER_BUILD_PROMPT.md.
 *
 * Design rule from the spec (line 110): "طبّق RBAC على الخادم، وليس إخفاء أزرار
 * في الواجهة فقط" — apply RBAC on the server, not by hiding UI buttons. This
 * module is therefore the single place both kinds of authorization live:
 *
 *   1. Field-level view models — `serializeIncidentForRole()` /
 *      `serializeUnitForRole()` strip fields a role has no business seeing
 *      BEFORE the object ever reaches a response body or a client component.
 *      A UI that hides a field it was never sent cannot leak that field.
 *
 *   2. Action-level permission checks — `canPerformAction()` gates the
 *      server-side mutations (confirm location, decide dispatch, approve
 *      destination, ...). Route handlers / server actions call this and
 *      throw before touching the database; they must never rely on the
 *      client not having rendered the button.
 *
 * Row-level access (test 30.14 #5: "FieldLink يمنع Medic من رؤية بلاغ آخر")
 * is a THIRD, separate concern from field-level projection: a MEDIC can be
 * field-eligible for a shape of data and still be forbidden from seeing a
 * *specific row* because it isn't their assignment. `canViewIncidentRow()`
 * enforces that and must be called before `serializeIncidentForRole()`.
 *
 * Per docs/product/NAJAT360-قرارات-ما-بعد-C0.md this module intentionally
 * ships only the C1 role set's incident/unit fields. Hospital handover
 * fields (destination card, hospital linkage) are deferred to C8 — see the
 * HOSPITAL_LIAISON section below for how that role expands then.
 */
import type { AmbulanceUnit, Incident, Role } from '@/lib/domain/types';

/** Minimal context about the person asking, beyond their role. */
export interface Viewer {
  role: Role;
  userId: string;
  /** Set only for MEDIC-shaped viewers: the unit they are currently crewing. */
  unitId?: string | null;
}

// ---------------------------------------------------------------------------
// 1. Field-level view models
// ---------------------------------------------------------------------------

type IncidentField = keyof Incident;

/**
 * Per-role allowlist of Incident fields, keyed by role. This is an
 * allowlist (not a denylist) on purpose: a newly added Incident field is
 * invisible to every role until a human deliberately adds it to a set
 * below, which is the safe failure direction for PII.
 */
const INCIDENT_FIELDS_BY_ROLE: Record<Role, readonly IncidentField[]> = {
  // Submits via a one-time token; reads back only enough to know their
  // report was received and roughly what is happening — never the
  // operational decision fields.
  CALLER: ['id', 'rescueCode', 'status'],

  // Reviews the AI-assisted draft and confirms location. Needs the full
  // intake + location-confidence picture and a way to reach the caller
  // back, but does not decide dispatch, so unit/entrance assignment is
  // excluded (spec: "يراجع AI draft ويثبت location، ولا يعتمد dispatch").
  CALL_TAKER: [
    'id',
    'rescueCode',
    'status',
    'priority',
    'proposedPriority',
    'latitude',
    'longitude',
    'gpsAccuracyMeters',
    'uncertaintyRadiusMeters',
    'confidenceScore',
    'placeType',
    'floorLevel',
    'language',
    'unableToSpeak',
    'callerName',
    'callerPhone',
    'suggestedEntranceId',
    'synthetic',
  ],

  // Full operational visibility — approves unit/entrance and is the
  // escalation point, so sees everything the platform knows about the
  // incident. Still cannot edit the original transcript (enforced at the
  // action layer, not here: there is no "edit transcript" action at all).
  SUPERVISOR: [
    'id',
    'rescueCode',
    'status',
    'priority',
    'proposedPriority',
    'latitude',
    'longitude',
    'gpsAccuracyMeters',
    'uncertaintyRadiusMeters',
    'confidenceScore',
    'placeType',
    'floorLevel',
    'language',
    'unableToSpeak',
    'callerName',
    'callerPhone',
    'suggestedEntranceId',
    'assignedEntranceId',
    'assignedUnitId',
    'synthetic',
  ],

  // Field crew. Deliberately excludes callerName/callerPhone: the medic's
  // job is "where do I stop, which entrance, how far" — not calling the
  // patient directly (that stays a call-taker/supervisor function). Row
  // access is additionally restricted to their own assignment by
  // `canViewIncidentRow()` below.
  MEDIC: [
    'id',
    'rescueCode',
    'status',
    'priority',
    'latitude',
    'longitude',
    'placeType',
    'floorLevel',
    'language',
    'unableToSpeak',
    'assignedEntranceId',
  ],

  // Approves the destination decision. Destination/hospital fields land in
  // C8; for C1 this role sees the same operational shape as call-taker
  // minus direct caller contact details, since destination decisions are
  // about routing, not talking to the caller.
  RESPONSE_COORDINATOR: [
    'id',
    'rescueCode',
    'status',
    'priority',
    'latitude',
    'longitude',
    'placeType',
    'assignedEntranceId',
    'assignedUnitId',
    'synthetic',
  ],

  // "يحدث مستشفاه فقط" + acceptance test 30.14 #8: must never see caller
  // fields. C1 ships this role a deliberately narrow shape; it grows a
  // hospital-scoped destination view in C8, not more caller-side detail.
  HOSPITAL_LIAISON: ['id', 'rescueCode', 'status', 'priority', 'placeType'],

  // De-identified analytics only: no callerName/callerPhone, no precise
  // coordinates (raw lat/lng is exact-location PII; spatial aggregation to
  // an H3 cell is a C6 concern, so for C1 analysts simply don't get
  // coordinates at all rather than a half-de-identified approximation).
  ANALYST: ['id', 'rescueCode', 'status', 'priority', 'placeType', 'confidenceScore', 'synthetic'],

  // "دون صلاحية افتراضية لقراءة المحتوى الطبي" — admin manages providers
  // and config, not incident content. Kept to bare operational metadata.
  ADMIN: ['id', 'rescueCode', 'status', 'synthetic'],
};

type UnitField = keyof AmbulanceUnit;

const UNIT_FIELDS_BY_ROLE: Record<Role, readonly UnitField[]> = {
  CALLER: [],
  CALL_TAKER: ['id', 'code', 'crewType', 'status'],
  SUPERVISOR: ['id', 'code', 'label', 'crewType', 'status', 'readinessScore', 'homeZone', 'synthetic'],
  MEDIC: ['id', 'code', 'label', 'crewType', 'status'],
  RESPONSE_COORDINATOR: ['id', 'code', 'label', 'crewType', 'status', 'readinessScore', 'homeZone'],
  HOSPITAL_LIAISON: ['id', 'code', 'crewType', 'status'],
  ANALYST: ['id', 'crewType', 'status', 'readinessScore', 'homeZone', 'synthetic'],
  ADMIN: ['id', 'code', 'crewType', 'status', 'synthetic'],
};

function projectFields<T extends object, K extends keyof T>(
  source: T,
  fields: readonly K[]
): Pick<T, K> {
  const projected = {} as Pick<T, K>;
  for (const field of fields) {
    if (field in source) {
      projected[field] = source[field];
    }
  }
  return projected;
}

/**
 * Row-level access gate. Must be checked BEFORE serializing — a role being
 * field-eligible for incidents in general does not mean it may see this
 * specific one.
 *
 * MEDIC: only the incident currently assigned to their unit (spec 30.14
 * #5, "FieldLink يمنع Medic من رؤية بلاغ آخر").
 * CALLER: only their own incident — enforced by whoever looks the incident
 * up via the caller's one-time token, not by this function (the token
 * lookup itself IS the row scope), so CALLER always passes here.
 * All other roles are operational staff with blanket read access to
 * incidents within their field-level shape.
 */
export function canViewIncidentRow(viewer: Viewer, incident: Pick<Incident, 'assignedUnitId'>): boolean {
  if (viewer.role === 'MEDIC') {
    return Boolean(viewer.unitId) && incident.assignedUnitId === viewer.unitId;
  }
  return true;
}

/**
 * Project an Incident down to exactly what `viewer.role` is allowed to see.
 * Returns `null` if the row-level check fails, so callers can respond with
 * a 404-shaped "not found" rather than a 403 that would confirm the
 * incident exists (standard practice for row-scoped resources).
 */
export function serializeIncidentForRole(incident: Incident, viewer: Viewer): Partial<Incident> | null {
  if (!canViewIncidentRow(viewer, incident)) {
    return null;
  }
  return projectFields(incident, INCIDENT_FIELDS_BY_ROLE[viewer.role]);
}

export function serializeUnitForRole(unit: AmbulanceUnit, viewer: Viewer): Partial<AmbulanceUnit> {
  return projectFields(unit, UNIT_FIELDS_BY_ROLE[viewer.role]);
}

// ---------------------------------------------------------------------------
// 2. Action-level permission checks
// ---------------------------------------------------------------------------

/**
 * Every mutating action in the system, named after what it does rather
 * than after an HTTP verb, so the mapping below reads as a permissions
 * table. This is intentionally NOT exhaustive of every future action —
 * add a case here the same day you add the route/server action that
 * performs it, never after.
 */
export type Action =
  | 'SUBMIT_CALLER_REPORT'
  | 'REVIEW_ASSISTED_DRAFT'
  | 'CONFIRM_LOCATION'
  | 'DECIDE_DISPATCH'
  | 'DECIDE_ENTRANCE'
  | 'SUBMIT_FIELD_ACTION'
  | 'APPROVE_DESTINATION'
  | 'UPDATE_OWN_HOSPITAL_STATUS'
  | 'VIEW_DEIDENTIFIED_ANALYTICS'
  | 'EXPORT_DEIDENTIFIED_DATA'
  | 'CONFIGURE_PROVIDERS'
  | 'CANCEL_INCIDENT';

const ACTION_ROLES: Record<Action, readonly Role[]> = {
  SUBMIT_CALLER_REPORT: ['CALLER'],
  REVIEW_ASSISTED_DRAFT: ['CALL_TAKER', 'SUPERVISOR'],
  CONFIRM_LOCATION: ['CALL_TAKER', 'SUPERVISOR'],
  DECIDE_DISPATCH: ['SUPERVISOR'],
  DECIDE_ENTRANCE: ['SUPERVISOR'],
  // C5 — spec 30.5's FieldLink is a MEDIC-only surface; row-level scoping
  // to the medic's own assigned incident is a SEPARATE check
  // (canViewIncidentRow() above, reused by
  // lib/fieldlink/field-action.ts's submitFieldAction()), not expressed
  // here — this table only answers "may this role ever do this", not
  // "may this actor do it to this row".
  SUBMIT_FIELD_ACTION: ['MEDIC'],
  APPROVE_DESTINATION: ['RESPONSE_COORDINATOR', 'SUPERVISOR'],
  UPDATE_OWN_HOSPITAL_STATUS: ['HOSPITAL_LIAISON'],
  VIEW_DEIDENTIFIED_ANALYTICS: ['ANALYST', 'ADMIN', 'SUPERVISOR'],
  EXPORT_DEIDENTIFIED_DATA: ['ANALYST', 'ADMIN'],
  CONFIGURE_PROVIDERS: ['ADMIN'],
  CANCEL_INCIDENT: ['SUPERVISOR', 'CALL_TAKER'],
};

export function canPerformAction(role: Role, action: Action): boolean {
  return ACTION_ROLES[action].includes(role);
}

export class ForbiddenActionError extends Error {
  constructor(
    public readonly role: Role,
    public readonly action: Action
  ) {
    super(`Role ${role} may not perform ${action}`);
    this.name = 'ForbiddenActionError';
  }
}

/** Throwing counterpart of `canPerformAction`, for use at the top of a server action/route handler. */
export function assertCanPerformAction(role: Role, action: Action): void {
  if (!canPerformAction(role, action)) {
    throw new ForbiddenActionError(role, action);
  }
}
