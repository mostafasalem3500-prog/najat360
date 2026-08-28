/**
 * Incident state machine — section 6 / 30.12 of NAJAT360_CLAUDE_MASTER_BUILD_PROMPT.md.
 *
 * Scope note: only the golden-path (NEW -> CLOSED) and its documented
 * exceptional states are modeled here. Hospital handover states
 * (TRANSPORT_DECISION -> ... -> END_HANDOVER) are explicitly deferred to C8
 * per docs/product/NAJAT360-قرارات-ما-بعد-C0.md and are NOT in this graph —
 * adding them is a follow-up migration + graph extension, not a rewrite.
 *
 * Design rule enforced here: every transition is looked up from an explicit
 * adjacency map. There is no "anything goes" fallback, so an invalid jump
 * (e.g. NEW -> ON_SCENE) throws instead of silently succeeding.
 */
import type { IncidentStatus } from '@/lib/domain/types';
import { TERMINAL_STATUSES } from '@/lib/domain/types';

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: IncidentStatus,
    public readonly to: IncidentStatus
  ) {
    super(`Invalid incident transition: ${from} -> ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export class MissingOverrideReasonError extends Error {
  constructor(to: IncidentStatus) {
    super(`Transition to ${to} requires an overrideReason of at least ${MIN_OVERRIDE_REASON_LENGTH} characters`);
    this.name = 'MissingOverrideReasonError';
  }
}

/**
 * Connectivity recovery (LOST_CONNECTIVITY -> anything but CANCELLED_BY_OPERATOR)
 * must land back on the exact status the incident was in before connectivity
 * was lost — never a different downstream status guessed by the caller.
 * Without this, a reconnect could silently "skip ahead" (e.g. claim EN_ROUTE
 * recovered straight to ON_SCENE) with no record of what actually happened
 * in between. Idea credited to comparing this module against a second
 * independent C1 attempt (ChatGPT) — see
 * docs/product/NAJAT360-قرارات-ما-بعد-C0.md.
 */
export class ConnectivityRecoveryMismatchError extends Error {
  constructor(
    public readonly attempted: IncidentStatus,
    public readonly expected: IncidentStatus | null | undefined
  ) {
    super(
      `Recovery from LOST_CONNECTIVITY must return to the status recorded before the loss ` +
        `(expected ${expected ?? '(none recorded)'}, got ${attempted})`
    );
    this.name = 'ConnectivityRecoveryMismatchError';
  }
}

/**
 * Adjacency map: for each status, the set of statuses it may transition to.
 * Any two states not listed here in either direction cannot be reached from
 * one another in a single transition.
 */
const TRANSITIONS: Record<IncidentStatus, readonly IncidentStatus[]> = {
  NEW: ['VERIFYING', 'LOW_CONFIDENCE', 'CANCELLED_BY_OPERATOR', 'DUPLICATE_SUSPECTED'],
  VERIFYING: ['READY_FOR_DECISION', 'LOW_CONFIDENCE', 'CANCELLED_BY_OPERATOR', 'DUPLICATE_SUSPECTED'],
  LOW_CONFIDENCE: ['VERIFYING', 'CANCELLED_BY_OPERATOR'],
  READY_FOR_DECISION: ['DISPATCHED', 'NO_UNIT_AVAILABLE', 'CANCELLED_BY_OPERATOR'],
  NO_UNIT_AVAILABLE: ['READY_FOR_DECISION', 'CANCELLED_BY_OPERATOR'],
  DISPATCHED: ['EN_ROUTE', 'LOST_CONNECTIVITY', 'CANCELLED_BY_OPERATOR'],
  EN_ROUTE: ['AT_ACCESS_POINT', 'ACCESS_BLOCKED', 'LOST_CONNECTIVITY', 'CANCELLED_BY_OPERATOR'],
  ACCESS_BLOCKED: ['EN_ROUTE', 'CANCELLED_BY_OPERATOR'],
  AT_ACCESS_POINT: ['ON_SCENE', 'LOST_CONNECTIVITY', 'CANCELLED_BY_OPERATOR'],
  ON_SCENE: ['CLOSED', 'CANCELLED_BY_OPERATOR'],
  LOST_CONNECTIVITY: ['EN_ROUTE', 'AT_ACCESS_POINT', 'DISPATCHED', 'CANCELLED_BY_OPERATOR'],
  DUPLICATE_SUSPECTED: ['VERIFYING', 'CANCELLED_BY_OPERATOR'],
  CANCELLED_BY_OPERATOR: [],
  CLOSED: [],
};

/** Statuses that require a documented reason to enter, per spec line 190. */
const REQUIRES_OVERRIDE_REASON: readonly IncidentStatus[] = ['CANCELLED_BY_OPERATOR'];

/**
 * Minimum trimmed length for overrideReason. Matches the DB-level
 * Incident_cancel_requires_reason CHECK constraint exactly
 * (prisma/migrations/0001_init/migration.sql) — this app-layer check must
 * never be looser than the DB's, or a reason this layer accepts could
 * still be rejected by Postgres with a raw, unfriendly constraint-violation
 * error instead of MissingOverrideReasonError.
 */
/**
 * Exported (not module-private) because C4's dispatch-decision gatekeeper
 * (`lib/dispatch/decision.ts`) needs the exact same "what counts as a real
 * reason" threshold for `Recommendation.overrideReason` — a second literal
 * `5` in that file would risk drifting from this one and from the DB CHECK
 * constraints both are meant to match.
 */
export const MIN_OVERRIDE_REASON_LENGTH = 5;

export function isTerminal(status: IncidentStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function canTransition(from: IncidentStatus, to: IncidentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface TransitionInput {
  from: IncidentStatus;
  to: IncidentStatus;
  overrideReason?: string;
  /**
   * Required (and checked) only when `from` is LOST_CONNECTIVITY and `to`
   * is not CANCELLED_BY_OPERATOR: the status the incident was in right
   * before it lost connectivity, as currently stored on the Incident row.
   * The caller supplies this — this function has no I/O and does not fetch
   * it itself. See `TransitionResult.statusBeforeConnectivityLoss` for how
   * to keep that stored value in sync going forward.
   */
  statusBeforeConnectivityLoss?: IncidentStatus | null;
}

export interface TransitionResult {
  from: IncidentStatus;
  to: IncidentStatus;
  overrideReason?: string;
  /**
   * What the caller should now persist as the incident's
   * statusBeforeConnectivityLoss column: set to `from` when entering
   * LOST_CONNECTIVITY, cleared to `null` when successfully recovering out
   * of it, and left `undefined` (meaning: don't touch the stored value)
   * for every other transition.
   */
  statusBeforeConnectivityLoss?: IncidentStatus | null;
}

/**
 * Validate and apply a transition. Pure function — no I/O. The caller is
 * responsible for persisting the resulting status and writing the
 * IncidentEvent/AuditLog rows (kept out of this module on purpose so it can
 * be unit tested without a database).
 */
export function transition(input: TransitionInput): TransitionResult {
  const { from, to, overrideReason, statusBeforeConnectivityLoss } = input;

  if (isTerminal(from)) {
    throw new InvalidTransitionError(from, to);
  }

  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }

  if (
    REQUIRES_OVERRIDE_REASON.includes(to) &&
    (!overrideReason || overrideReason.trim().length < MIN_OVERRIDE_REASON_LENGTH)
  ) {
    throw new MissingOverrideReasonError(to);
  }

  if (from === 'LOST_CONNECTIVITY' && to !== 'CANCELLED_BY_OPERATOR' && to !== statusBeforeConnectivityLoss) {
    throw new ConnectivityRecoveryMismatchError(to, statusBeforeConnectivityLoss);
  }

  let nextStatusBeforeConnectivityLoss: IncidentStatus | null | undefined;
  if (to === 'LOST_CONNECTIVITY') {
    nextStatusBeforeConnectivityLoss = from;
  } else if (from === 'LOST_CONNECTIVITY') {
    nextStatusBeforeConnectivityLoss = null;
  }

  return { from, to, overrideReason, statusBeforeConnectivityLoss: nextStatusBeforeConnectivityLoss };
}
