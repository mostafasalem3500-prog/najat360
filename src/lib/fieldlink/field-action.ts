/**
 * submitFieldAction() — spec 30.5's FieldLink action gatekeeper. Same
 * single-gatekeeper-function pattern as `acceptSuggestion()` (C2),
 * `decideDispatch()`/`overrideLocation()` (C4): one function is the only
 * code path permitted to turn a medic's tap into a persisted
 * `FieldAction` row (and, for actions that carry one, an incident status
 * transition) — no shortcut writes the incident directly.
 *
 * Three things this function exists to make structurally true:
 *
 *   1. "FieldLink يمنع Medic من رؤية بلاغ آخر" (spec 30.14 #6 covers
 *      offline idempotency; this project's own `canViewIncidentRow()` in
 *      lib/auth/rbac.ts covers the READ side of "another incident"). This
 *      function enforces the WRITE side of the same rule: a medic may only
 *      submit an action for the incident actually assigned to their own
 *      unit — checked here via `assignedUnitId`, independent of and in
 *      addition to the RBAC row-scope check a route handler would also run
 *      on the read path.
 *   2. "offline action يعاد إرساله مرة واحدة بفضل idempotency" (spec 30.14
 *      #6): resubmitting an action with the SAME idempotencyKey (e.g. the
 *      offline queue retries after a flaky response whose result never
 *      reached the client) is a safe no-op, never a second apply. This is
 *      the pure-function half of that guarantee; the DB layer's UNIQUE
 *      constraint on `FieldAction.idempotencyKey` (see the C5 migration)
 *      is the second, defense-in-depth half — same
 *      app-layer-plus-DB-layer discipline as every other invariant in this
 *      project (idea for enforcing this specific one at the DB layer with
 *      a real UNIQUE constraint, not just app-layer convention, credited
 *      to comparing against an independent AI's C5 attempt — see
 *      docs/product for the comparison notes).
 *   3. A once-per-incident action (ACCEPT_TASK, CLOSE_TASK) submitted a
 *      SECOND time with a genuinely different idempotencyKey (not a
 *      retried duplicate — a real second attempt, e.g. a UI bug that lets
 *      a medic tap "accept" twice before the first tap's queued action has
 *      even round-tripped) is rejected outright rather than silently
 *      accepted or silently ignored. Generalizes an idea from that same
 *      comparison: their attempt hard-coded this guard for ACCEPT_TASK
 *      only; this project applies it to every action spec's own semantics
 *      say can only happen once (ACCEPT_TASK, CLOSE_TASK).
 *
 * Pure function: does not touch a database. Returns what to insert (and,
 * for a status-changing action, the `state-machine.transition()` result)
 * for the caller's repository layer to persist inside a transaction
 * alongside the required IncidentEvent/AuditLog rows.
 */
import { transition, type TransitionResult } from '@/lib/incidents/state-machine';
import type { FieldActionType, IncidentStatus } from '@/lib/domain/types';

export class MissingActorError extends Error {
  constructor() {
    super('submitFieldAction: actorId is required — there is no unattended field action path');
    this.name = 'MissingActorError';
  }
}

export class MissingIdempotencyKeyError extends Error {
  constructor() {
    super('submitFieldAction: idempotencyKey is required — every FieldLink action must be safely retryable');
    this.name = 'MissingIdempotencyKeyError';
  }
}

export class IncidentNotAssignedToUnitError extends Error {
  constructor(
    public readonly incidentId: string,
    public readonly unitId: string
  ) {
    super(`submitFieldAction: incident "${incidentId}" is not currently assigned to unit "${unitId}"`);
    this.name = 'IncidentNotAssignedToUnitError';
  }
}

export class DuplicateOnceOnlyActionError extends Error {
  constructor(
    public readonly incidentId: string,
    public readonly actionType: FieldActionType
  ) {
    super(`submitFieldAction: "${actionType}" was already submitted for incident "${incidentId}" — it may only happen once`);
    this.name = 'DuplicateOnceOnlyActionError';
  }
}

/**
 * Action types spec's own semantics say can only genuinely happen once per
 * incident: a medic accepts a task once, and closes it once. Every other
 * action (ACCESS_BLOCKED, REQUEST_LOCATION_REFRESH, ...) may legitimately
 * repeat.
 */
const ONCE_PER_INCIDENT_ACTION_TYPES: readonly FieldActionType[] = ['ACCEPT_TASK', 'CLOSE_TASK'];

/**
 * Which incident status each action type moves an incident TO, reusing
 * this project's EXISTING state graph (lib/incidents/state-machine.ts)
 * completely unchanged — no new states, no new edges. `null` means the
 * action is logged but does not itself move the incident (ACCEPT_TASK is
 * an acknowledgement; REQUEST_LOCATION_REFRESH/PROPOSE_ALTERNATE_ENTRANCE
 * are requests a call-taker/supervisor acts on separately, matching this
 * project's "a medic proposes, a human with dispatch authority decides"
 * principle established since C4's overrideLocation()).
 */
const ACTION_TARGET_STATUS: Record<FieldActionType, IncidentStatus | null> = {
  ACCEPT_TASK: null,
  START_MOVING: 'EN_ROUTE',
  AT_ACCESS_POINT: 'AT_ACCESS_POINT',
  ON_SCENE: 'ON_SCENE',
  ACCESS_BLOCKED: 'ACCESS_BLOCKED',
  REQUEST_LOCATION_REFRESH: null,
  PROPOSE_ALTERNATE_ENTRANCE: null,
  CLOSE_TASK: 'CLOSED',
};

/** Minimal shape of a previously-persisted action, as needed for the two dedup checks — callers fetch this (e.g. `WHERE incidentId = $1`), not the full row. */
export interface ExistingFieldActionRef {
  idempotencyKey: string;
  actionType: FieldActionType;
}

export interface SubmitFieldActionInput {
  incidentId: string;
  unitId: string;
  actorId: string;
  actionType: FieldActionType;
  idempotencyKey: string;
  /** The incident's currently-stored status. Required even for a log-only action, since `previousStatus`/`resultingStatus` are recorded on every FieldAction row regardless of whether this submission changes it. */
  incidentStatus: IncidentStatus;
  /** The incident's currently-stored assignedUnitId — row-scope check target (see this file's header, point 1). */
  assignedUnitId: string | null;
  payload?: Record<string, unknown>;
  /** Every existing FieldAction for this SAME incident — used for both the idempotency-key dedup and the once-per-incident guard. */
  existingActionsForIncident: ExistingFieldActionRef[];
  /** Client-side timestamp of when the medic actually performed the action (may predate `now` if it sat in an offline queue). */
  submittedAt: Date;
  now: Date;
}

export interface NewFieldActionForInsert {
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

export type SubmitFieldActionResult =
  | { duplicate: true }
  | { duplicate: false; action: NewFieldActionForInsert; incidentTransition: TransitionResult | null };

export function submitFieldAction(input: SubmitFieldActionInput): SubmitFieldActionResult {
  const {
    incidentId,
    unitId,
    actorId,
    actionType,
    idempotencyKey,
    incidentStatus,
    assignedUnitId,
    payload,
    existingActionsForIncident,
    submittedAt,
    now,
  } = input;

  if (!actorId?.trim()) {
    throw new MissingActorError();
  }
  if (!idempotencyKey?.trim()) {
    throw new MissingIdempotencyKeyError();
  }
  if (assignedUnitId !== unitId) {
    throw new IncidentNotAssignedToUnitError(incidentId, unitId);
  }

  // Idempotent retry: the SAME key already produced a row — safe no-op,
  // never re-applied. Checked BEFORE the once-per-incident guard so a
  // genuine retry of an already-accepted ACCEPT_TASK is never mistaken for
  // an illegal second acceptance.
  const isRetry = existingActionsForIncident.some((a) => a.idempotencyKey === idempotencyKey);
  if (isRetry) {
    return { duplicate: true };
  }

  if (
    ONCE_PER_INCIDENT_ACTION_TYPES.includes(actionType) &&
    existingActionsForIncident.some((a) => a.actionType === actionType)
  ) {
    throw new DuplicateOnceOnlyActionError(incidentId, actionType);
  }

  const targetStatus = ACTION_TARGET_STATUS[actionType];
  const incidentTransition = targetStatus ? transition({ from: incidentStatus, to: targetStatus }) : null;

  const action: NewFieldActionForInsert = {
    incidentId,
    unitId,
    actorId,
    actionType,
    idempotencyKey,
    payload: payload ?? null,
    previousStatus: incidentStatus,
    resultingStatus: incidentTransition?.to ?? null,
    submittedAt,
    processedAt: now,
  };

  return { duplicate: false, action, incidentTransition };
}
