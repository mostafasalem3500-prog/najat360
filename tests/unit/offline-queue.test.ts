import { describe, expect, it, vi } from 'vitest';
import { OfflineActionQueue, PermanentFieldActionRejection } from '@/lib/fieldlink/offline-queue';

const FIXED_NOW = new Date('2026-08-24T12:00:00.000Z');

function makeQueue(overrides: Partial<{ send: any; isOnline: () => boolean }> = {}) {
  const sent: any[] = [];
  const innerSend =
    overrides.send ??
    (async () => {
      return { duplicate: false };
    });
  // Always track successfully-sent actions here, regardless of which send()
  // implementation a test supplies — a thrown rejection means this action
  // was NOT actually sent, so it's correctly excluded from `sent`.
  const send = vi.fn(async (action: any) => {
    const result = await innerSend(action);
    sent.push(action);
    return result;
  });
  const isOnline = overrides.isOnline ?? (() => true);
  let keyCounter = 0;
  const queue = new OfflineActionQueue({
    send,
    isOnline,
    clock: () => FIXED_NOW,
    generateIdempotencyKey: () => `key-${++keyCounter}`,
  });
  return { queue, send, sent };
}

describe('OfflineActionQueue.enqueue', () => {
  it('assigns a unique idempotency key immediately, at enqueue time', () => {
    const { queue } = makeQueue();
    const a = queue.enqueue({ incidentId: 'inc-1', unitId: 'unit-1', actionType: 'START_MOVING' });
    const b = queue.enqueue({ incidentId: 'inc-1', unitId: 'unit-1', actionType: 'ON_SCENE' });
    expect(a.idempotencyKey).not.toBe(b.idempotencyKey);
    expect(queue.pending).toHaveLength(2);
  });

  it('stamps queuedAt from the injected clock, not the real system clock', () => {
    const { queue } = makeQueue();
    const a = queue.enqueue({ incidentId: 'inc-1', unitId: 'unit-1', actionType: 'ACCEPT_TASK' });
    expect(a.queuedAt).toEqual(FIXED_NOW);
  });

  it('starts every action at 0 attempts', () => {
    const { queue } = makeQueue();
    const a = queue.enqueue({ incidentId: 'inc-1', unitId: 'unit-1', actionType: 'ACCEPT_TASK' });
    expect(a.attempts).toBe(0);
  });
});

describe('OfflineActionQueue.flush', () => {
  it('does nothing and reports everything as remaining when offline', async () => {
    const { queue, send } = makeQueue({ isOnline: () => false });
    queue.enqueue({ incidentId: 'inc-1', unitId: 'unit-1', actionType: 'ACCEPT_TASK' });
    const result = await queue.flush();
    expect(result).toEqual({ sent: 0, rejected: 0, remaining: 1 });
    expect(send).not.toHaveBeenCalled();
  });

  it('sends every queued action in FIFO order and empties the queue on full success', async () => {
    const { queue, sent } = makeQueue();
    queue.enqueue({ incidentId: 'inc-1', unitId: 'unit-1', actionType: 'ACCEPT_TASK' });
    queue.enqueue({ incidentId: 'inc-1', unitId: 'unit-1', actionType: 'START_MOVING' });
    queue.enqueue({ incidentId: 'inc-1', unitId: 'unit-1', actionType: 'ON_SCENE' });
    const result = await queue.flush();
    expect(result).toEqual({ sent: 3, rejected: 0, remaining: 0 });
    expect(sent.map((a) => a.actionType)).toEqual(['ACCEPT_TASK', 'START_MOVING', 'ON_SCENE']);
    expect(queue.pending).toHaveLength(0);
  });

  it('treats a duplicate:true response the same as success — removed from the queue', async () => {
    const send = vi.fn(async () => ({ duplicate: true }));
    const { queue } = makeQueue({ send });
    queue.enqueue({ incidentId: 'inc-1', unitId: 'unit-1', actionType: 'ACCEPT_TASK' });
    const result = await queue.flush();
    expect(result).toEqual({ sent: 1, rejected: 0, remaining: 0 });
  });

  it('a transient failure leaves the action queued and stops before later actions (preserves order)', async () => {
    let call = 0;
    const send = vi.fn(async (action: any) => {
      call += 1;
      if (action.actionType === 'START_MOVING') throw new Error('network timeout');
      return { duplicate: false };
    });
    const { queue, sent } = makeQueue({ send });
    queue.enqueue({ incidentId: 'inc-1', unitId: 'unit-1', actionType: 'ACCEPT_TASK' });
    queue.enqueue({ incidentId: 'inc-1', unitId: 'unit-1', actionType: 'START_MOVING' });
    queue.enqueue({ incidentId: 'inc-1', unitId: 'unit-1', actionType: 'ON_SCENE' });

    const result = await queue.flush();
    // ACCEPT_TASK sent, START_MOVING failed transiently, ON_SCENE never attempted (order preserved).
    expect(result).toEqual({ sent: 1, rejected: 0, remaining: 2 });
    expect(queue.pending.map((a) => a.actionType)).toEqual(['START_MOVING', 'ON_SCENE']);
    expect(sent.map((a) => a.actionType)).toEqual(['ACCEPT_TASK']);
    expect(call).toBe(2); // ON_SCENE's send() was never called
  });

  it('records lastError and increments attempts on a transient failure', async () => {
    const send = vi.fn(async () => {
      throw new Error('boom');
    });
    const { queue } = makeQueue({ send });
    queue.enqueue({ incidentId: 'inc-1', unitId: 'unit-1', actionType: 'ACCEPT_TASK' });
    await queue.flush();
    expect(queue.pending[0]!.attempts).toBe(1);
    expect(queue.pending[0]!.lastError).toBe('boom');
  });

  it('a PermanentFieldActionRejection drops the action from the queue instead of retrying it', async () => {
    const send = vi.fn(async () => {
      throw new PermanentFieldActionRejection(new Error('invalid transition'));
    });
    const { queue } = makeQueue({ send });
    queue.enqueue({ incidentId: 'inc-1', unitId: 'unit-1', actionType: 'ACCEPT_TASK' });
    const result = await queue.flush();
    expect(result).toEqual({ sent: 0, rejected: 1, remaining: 0 });
    expect(queue.pending).toHaveLength(0);
  });

  it('a permanent rejection on an earlier item does not block later items from being attempted', async () => {
    const send = vi.fn(async (action: any) => {
      if (action.actionType === 'ACCEPT_TASK') throw new PermanentFieldActionRejection(new Error('bad'));
      return { duplicate: false };
    });
    const { queue, sent } = makeQueue({ send });
    queue.enqueue({ incidentId: 'inc-1', unitId: 'unit-1', actionType: 'ACCEPT_TASK' });
    queue.enqueue({ incidentId: 'inc-1', unitId: 'unit-1', actionType: 'START_MOVING' });
    const result = await queue.flush();
    // Only the permanent rejection stops nothing — it's dropped and processing continues (unlike a transient failure, which stops the FIFO walk).
    expect(result).toEqual({ sent: 1, rejected: 1, remaining: 0 });
    expect(sent.map((a) => a.actionType)).toEqual(['START_MOVING']);
  });

  it('retrying flush() after a transient failure succeeds once the underlying condition clears', async () => {
    let shouldFail = true;
    const send = vi.fn(async () => {
      if (shouldFail) throw new Error('temporarily down');
      return { duplicate: false };
    });
    const { queue } = makeQueue({ send });
    queue.enqueue({ incidentId: 'inc-1', unitId: 'unit-1', actionType: 'ACCEPT_TASK' });

    const first = await queue.flush();
    expect(first.remaining).toBe(1);

    shouldFail = false;
    const second = await queue.flush();
    expect(second).toEqual({ sent: 1, rejected: 0, remaining: 0 });
  });
});
