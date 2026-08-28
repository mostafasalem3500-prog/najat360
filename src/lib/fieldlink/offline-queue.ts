/**
 * OfflineActionQueue — spec 30.5: "طبّق offline queue محلية صغيرة للأفعال،
 * مع idempotency key، ثم sync عند الاتصال" (a small local offline queue
 * for actions, with an idempotency key, synced on reconnect). This is the
 * CLIENT-side half of C5's idempotency guarantee — the server-side half is
 * `submitFieldAction()` (field-action.ts) plus the DB's UNIQUE constraint
 * on `FieldAction.idempotencyKey`.
 *
 * Unlike this project's pure algorithm modules (resolveLocation(),
 * computeAccessScore(), state-machine.transition()), a queue that lives in
 * a real medic's browser is inherently stateful — it holds pending
 * actions in memory (or whatever `persist`/`restore` hooks a caller wires
 * up) and calls out to a real network. What stays true to this project's
 * conventions is DEPENDENCY INJECTION for everything that would otherwise
 * make this untestable: the clock, id generation, and the "am I online"
 * check are all constructor parameters with real-world defaults, same
 * pattern as `MockRoutingProvider`'s injectable `clock`.
 *
 * Ordering: actions flush in FIFO order and STOP at the first item that
 * fails, rather than skipping ahead — a medic's ACCEPT_TASK must reach the
 * server before their later ON_SCENE does, and letting a later action
 * overtake an earlier stuck one would let the server see an impossible
 * sequence (e.g. ON_SCENE before START_MOVING, which `submitFieldAction()`
 * would then correctly reject via `InvalidTransitionError` — but the
 * MEDIC's own action would be lost for a reason they never caused).
 *
 * Permanent vs. transient failure: `send()` rejecting with a
 * `PermanentFieldActionRejection` (wrap a server-side validation error in
 * one) removes that item from the queue — retrying it can never succeed.
 * Any OTHER thrown value (a network error, a timeout) is treated as
 * transient: the item stays queued for the next flush. Reviewing an
 * independent AI's C5 attempt found its offline queue does not make this
 * distinction (every failure is retried identically, including ones that
 * can never succeed) — this project's queue does, so a genuinely invalid
 * action does not sit retrying forever and silently blocking every action
 * queued after it.
 */
import type { FieldActionType } from '@/lib/domain/types';

export class PermanentFieldActionRejection extends Error {
  constructor(
    public readonly cause: unknown,
    message?: string
  ) {
    super(message ?? 'Field action permanently rejected by the server — will not be retried');
    this.name = 'PermanentFieldActionRejection';
  }
}

export interface QueuedFieldAction {
  idempotencyKey: string;
  incidentId: string;
  unitId: string;
  actionType: FieldActionType;
  payload?: Record<string, unknown>;
  queuedAt: Date;
  attempts: number;
  lastError?: string;
}

export type FieldActionSender = (action: QueuedFieldAction) => Promise<{ duplicate: boolean }>;

export interface EnqueueInput {
  incidentId: string;
  unitId: string;
  actionType: FieldActionType;
  payload?: Record<string, unknown>;
}

export interface FlushResult {
  sent: number;
  rejected: number;
  /** Items still queued after this flush — either untried this round (an earlier item failed and flush stopped, per this file's FIFO ordering note) or transiently failed and left in place for the next attempt. */
  remaining: number;
}

export interface OfflineActionQueueOptions {
  send: FieldActionSender;
  isOnline: () => boolean;
  clock?: () => Date;
  generateIdempotencyKey?: () => string;
}

let fallbackIdCounter = 0;
/** Only used when the environment has no `crypto.randomUUID` AND the caller supplied no generator — extremely unlikely in practice, but keeps the default total. */
function fallbackGenerateId(): string {
  fallbackIdCounter += 1;
  return `fallback-idempotency-key-${fallbackIdCounter}`;
}

export class OfflineActionQueue {
  private readonly send: FieldActionSender;
  private readonly isOnline: () => boolean;
  private readonly clock: () => Date;
  private readonly generateIdempotencyKey: () => string;
  private queue: QueuedFieldAction[] = [];

  constructor(options: OfflineActionQueueOptions) {
    this.send = options.send;
    this.isOnline = options.isOnline;
    this.clock = options.clock ?? (() => new Date());
    this.generateIdempotencyKey =
      options.generateIdempotencyKey ??
      (() => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : fallbackGenerateId()));
  }

  get pending(): readonly QueuedFieldAction[] {
    return this.queue;
  }

  /**
   * Adds an action to the queue and assigns it its permanent idempotency
   * key immediately (not at send time) — the key must survive being
   * queued offline for an arbitrary length of time and still dedup
   * correctly whenever it eventually reaches the server, including across
   * a page reload if the caller persists `pending` themselves.
   */
  enqueue(input: EnqueueInput): QueuedFieldAction {
    const action: QueuedFieldAction = {
      idempotencyKey: this.generateIdempotencyKey(),
      incidentId: input.incidentId,
      unitId: input.unitId,
      actionType: input.actionType,
      payload: input.payload,
      queuedAt: this.clock(),
      attempts: 0,
    };
    this.queue.push(action);
    return action;
  }

  /**
   * Attempts to send every queued action in order. Stops at the first
   * transient failure (see this file's header) rather than skipping ahead.
   * A `duplicate: true` response from `send()` is treated exactly like
   * success — the server already has this action, so it is removed from
   * the local queue the same as a fresh accept.
   */
  async flush(): Promise<FlushResult> {
    if (!this.isOnline()) {
      return { sent: 0, rejected: 0, remaining: this.queue.length };
    }

    let sent = 0;
    let rejected = 0;
    const stillQueued: QueuedFieldAction[] = [];
    let stopped = false;

    for (const action of this.queue) {
      if (stopped) {
        stillQueued.push(action);
        continue;
      }
      action.attempts += 1;
      try {
        await this.send(action);
        sent += 1;
      } catch (err) {
        if (err instanceof PermanentFieldActionRejection) {
          rejected += 1;
          // Dropped, not requeued — retrying can never succeed.
        } else {
          action.lastError = err instanceof Error ? err.message : String(err);
          stillQueued.push(action);
          stopped = true; // preserve FIFO ordering — see header comment
        }
      }
    }

    this.queue = stillQueued;
    return { sent, rejected, remaining: this.queue.length };
  }
}
