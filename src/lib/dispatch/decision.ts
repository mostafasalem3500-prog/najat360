/**
 * decideDispatch() — the single gatekeeper for turning a generated
 * Access Score recommendation into an actual unit/entrance assignment.
 * Mirrors the C2 `acceptSuggestion()` pattern: one function is the only
 * code path permitted to move an incident into DISPATCHED, and it
 * re-validates everything at the moment of decision rather than trusting
 * a recommendation snapshot that may be stale by the time a human acts on
 * it (idea credited to comparing this phase against an independent AI
 * attempt — see docs/product for the comparison notes).
 *
 * Two things are re-checked fresh here, NOT read off the `Recommendation`
 * row:
 *   1. The chosen unit's live `status` — spec's own C4 acceptance
 *      criterion is "لا يمكن إسناد وحدة غير متاحة" (an unavailable unit can
 *      never be assigned). A unit that was AVAILABLE when the
 *      recommendation was generated may have gone BUSY/OUT_OF_SERVICE
 *      seconds later.
 *   2. Whether the chosen unit already holds another non-terminal
 *      incident — the same invariant C1's
 *      `Incident_one_active_assignment_per_unit` partial unique index
 *      enforces at the DB layer. Checking it here first means a genuine
 *      double-booking attempt fails with a clear `UnitAlreadyAssignedError`
 *      instead of a raw Postgres constraint-violation bubbling up.
 *
 * Does not touch a database — returns the validated decision plus the
 * underlying `state-machine.transition()` result for the caller's
 * repository layer to persist alongside the `Recommendation`/`Incident`
 * updates and the required `IncidentEvent`/`AuditLog` rows.
 */
import { MIN_OVERRIDE_REASON_LENGTH, transition, type TransitionResult } from '@/lib/incidents/state-machine';
import type { IncidentStatus, UnitStatus } from '@/lib/domain/types';

export class MissingDecidedByError extends Error {
  constructor() {
    super('decideDispatch: a human decidedById is required — there is no unattended dispatch decision path');
    this.name = 'MissingDecidedByError';
  }
}

export class UnitNotAvailableError extends Error {
  constructor(
    public readonly unitId: string,
    public readonly status: UnitStatus
  ) {
    super(`Unit "${unitId}" is not AVAILABLE (current status: ${status}) and cannot be assigned`);
    this.name = 'UnitNotAvailableError';
  }
}

export class UnitAlreadyAssignedError extends Error {
  constructor(public readonly unitId: string) {
    super(`Unit "${unitId}" is already assigned to another non-terminal incident`);
    this.name = 'UnitAlreadyAssignedError';
  }
}

export class MissingDispatchOverrideReasonError extends Error {
  constructor() {
    super(
      `Choosing a unit/entrance other than the recommendation requires an overrideReason of at least ${MIN_OVERRIDE_REASON_LENGTH} characters`
    );
    this.name = 'MissingDispatchOverrideReasonError';
  }
}

/** Freshly re-fetched status for the unit actually being assigned — never the stale value a `Recommendation` row might carry. */
export interface FreshUnitStatus {
  id: string;
  status: UnitStatus;
  /** True if any OTHER non-terminal incident already has this unit as `assignedUnitId`. Caller computes this (e.g. a COUNT query excluding the current incident and terminal statuses) — mirrors the WHERE clause of `Incident_one_active_assignment_per_unit`. */
  hasOtherActiveIncidentAssigned: boolean;
}

export interface DecideDispatchInput {
  /** The incident's currently-stored status — must be `READY_FOR_DECISION` (enforced by `state-machine.transition()`, which throws `InvalidTransitionError` otherwise). */
  incidentStatus: IncidentStatus;
  recommendedUnitId: string;
  recommendedEntranceId: string;
  chosenUnitId: string;
  chosenEntranceId: string;
  chosenUnit: FreshUnitStatus;
  /** The supervisor approving this decision. Required — spec 30.11: only SUPERVISOR may perform DECIDE_DISPATCH; RBAC enforcement itself belongs to the caller (route/service layer), not this function. */
  decidedById: string;
  /** Required only when `chosenUnitId`/`chosenEntranceId` differ from the recommendation. */
  overrideReason?: string;
}

export interface DecideDispatchResult {
  incidentTransition: TransitionResult;
  assignedUnitId: string;
  assignedEntranceId: string;
  wasOverride: boolean;
  decidedById: string;
  overrideReason?: string;
}

export function decideDispatch(input: DecideDispatchInput): DecideDispatchResult {
  const { incidentStatus, recommendedUnitId, recommendedEntranceId, chosenUnitId, chosenEntranceId, chosenUnit, decidedById, overrideReason } =
    input;

  if (!decidedById?.trim()) {
    throw new MissingDecidedByError();
  }

  if (chosenUnit.status !== 'AVAILABLE') {
    throw new UnitNotAvailableError(chosenUnitId, chosenUnit.status);
  }
  if (chosenUnit.hasOtherActiveIncidentAssigned) {
    throw new UnitAlreadyAssignedError(chosenUnitId);
  }

  const wasOverride = chosenUnitId !== recommendedUnitId || chosenEntranceId !== recommendedEntranceId;
  if (wasOverride && (!overrideReason || overrideReason.trim().length < MIN_OVERRIDE_REASON_LENGTH)) {
    throw new MissingDispatchOverrideReasonError();
  }

  // Spec 15: "اختيار المشرف يلغي التوصية فقط للحالة الحالية ولا يغير
  // الخوارزمية تلقائيًا" — this function has no learned/mutable state to
  // change even if it wanted to; computeAccessScore/generateRecommendation
  // are pure functions of their inputs, so an override here structurally
  // cannot alter future recommendations.
  const incidentTransition = transition({ from: incidentStatus, to: 'DISPATCHED' });

  return {
    incidentTransition,
    assignedUnitId: chosenUnitId,
    assignedEntranceId: chosenEntranceId,
    wasOverride,
    decidedById,
    overrideReason: wasOverride ? overrideReason : undefined,
  };
}

/**
 * The other outcome `READY_FOR_DECISION` can reach (spec's own adjacency:
 * `READY_FOR_DECISION -> NO_UNIT_AVAILABLE`) — for when
 * `generateRecommendation()` throws `NoAvailableUnitsError`. Kept as a
 * separate tiny function rather than a branch inside `decideDispatch()`
 * because it has none of that function's unit/override validation to do.
 */
export function markNoUnitAvailable(incidentStatus: IncidentStatus): TransitionResult {
  return transition({ from: incidentStatus, to: 'NO_UNIT_AVAILABLE' });
}
