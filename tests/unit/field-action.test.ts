import { describe, expect, it } from 'vitest';
import {
  submitFieldAction,
  MissingActorError,
  MissingIdempotencyKeyError,
  IncidentNotAssignedToUnitError,
  DuplicateOnceOnlyActionError,
  type SubmitFieldActionInput,
} from '@/lib/fieldlink/field-action';
import { InvalidTransitionError } from '@/lib/incidents/state-machine';

const NOW = new Date('2026-08-24T12:00:00.000Z');

function baseInput(overrides: Partial<SubmitFieldActionInput> = {}): SubmitFieldActionInput {
  return {
    incidentId: 'inc-1',
    unitId: 'unit-1',
    actorId: 'medic-1',
    actionType: 'START_MOVING',
    idempotencyKey: 'key-1',
    incidentStatus: 'DISPATCHED',
    assignedUnitId: 'unit-1',
    existingActionsForIncident: [],
    submittedAt: NOW,
    now: NOW,
    ...overrides,
  };
}

describe('submitFieldAction', () => {
  it('throws MissingActorError when actorId is empty or whitespace', () => {
    expect(() => submitFieldAction(baseInput({ actorId: '' }))).toThrow(MissingActorError);
    expect(() => submitFieldAction(baseInput({ actorId: '   ' }))).toThrow(MissingActorError);
  });

  it('throws MissingIdempotencyKeyError when idempotencyKey is empty or whitespace', () => {
    expect(() => submitFieldAction(baseInput({ idempotencyKey: '' }))).toThrow(MissingIdempotencyKeyError);
    expect(() => submitFieldAction(baseInput({ idempotencyKey: '  ' }))).toThrow(MissingIdempotencyKeyError);
  });

  it('throws IncidentNotAssignedToUnitError when the incident is assigned to a different unit', () => {
    expect(() => submitFieldAction(baseInput({ assignedUnitId: 'unit-2' }))).toThrow(IncidentNotAssignedToUnitError);
  });

  it('throws IncidentNotAssignedToUnitError when the incident has no assigned unit at all', () => {
    expect(() => submitFieldAction(baseInput({ assignedUnitId: null }))).toThrow(IncidentNotAssignedToUnitError);
  });

  it('checks actor/idempotency presence before the row-scope check', () => {
    // Even with a mismatched unit, a missing actor should fail for the actor reason.
    expect(() => submitFieldAction(baseInput({ actorId: '', assignedUnitId: 'unit-2' }))).toThrow(MissingActorError);
  });

  it('START_MOVING transitions DISPATCHED -> EN_ROUTE', () => {
    const result = submitFieldAction(baseInput({ actionType: 'START_MOVING', incidentStatus: 'DISPATCHED' }));
    expect(result.duplicate).toBe(false);
    if (!result.duplicate) {
      expect(result.incidentTransition?.to).toBe('EN_ROUTE');
      expect(result.action.previousStatus).toBe('DISPATCHED');
      expect(result.action.resultingStatus).toBe('EN_ROUTE');
    }
  });

  it('AT_ACCESS_POINT transitions EN_ROUTE -> AT_ACCESS_POINT', () => {
    const result = submitFieldAction(baseInput({ actionType: 'AT_ACCESS_POINT', incidentStatus: 'EN_ROUTE' }));
    expect(result.duplicate).toBe(false);
    if (!result.duplicate) expect(result.incidentTransition?.to).toBe('AT_ACCESS_POINT');
  });

  it('ON_SCENE transitions AT_ACCESS_POINT -> ON_SCENE', () => {
    const result = submitFieldAction(baseInput({ actionType: 'ON_SCENE', incidentStatus: 'AT_ACCESS_POINT' }));
    expect(result.duplicate).toBe(false);
    if (!result.duplicate) expect(result.incidentTransition?.to).toBe('ON_SCENE');
  });

  it('ACCESS_BLOCKED transitions EN_ROUTE -> ACCESS_BLOCKED', () => {
    const result = submitFieldAction(baseInput({ actionType: 'ACCESS_BLOCKED', incidentStatus: 'EN_ROUTE' }));
    expect(result.duplicate).toBe(false);
    if (!result.duplicate) expect(result.incidentTransition?.to).toBe('ACCESS_BLOCKED');
  });

  it('CLOSE_TASK transitions ON_SCENE -> CLOSED', () => {
    const result = submitFieldAction(baseInput({ actionType: 'CLOSE_TASK', incidentStatus: 'ON_SCENE' }));
    expect(result.duplicate).toBe(false);
    if (!result.duplicate) expect(result.incidentTransition?.to).toBe('CLOSED');
  });

  it('ACCEPT_TASK, REQUEST_LOCATION_REFRESH, and PROPOSE_ALTERNATE_ENTRANCE are log-only: no status transition', () => {
    for (const actionType of ['ACCEPT_TASK', 'REQUEST_LOCATION_REFRESH', 'PROPOSE_ALTERNATE_ENTRANCE'] as const) {
      const result = submitFieldAction(baseInput({ actionType, incidentStatus: 'DISPATCHED' }));
      expect(result.duplicate).toBe(false);
      if (!result.duplicate) {
        expect(result.incidentTransition).toBeNull();
        expect(result.action.resultingStatus).toBeNull();
        expect(result.action.previousStatus).toBe('DISPATCHED');
      }
    }
  });

  it('rejects an action whose target status is not reachable from the current status (delegates to state-machine.transition)', () => {
    // ON_SCENE action while still NEW — no such edge in the state graph.
    expect(() => submitFieldAction(baseInput({ actionType: 'ON_SCENE', incidentStatus: 'NEW' }))).toThrow(InvalidTransitionError);
  });

  it('a resubmission with the SAME idempotencyKey is a safe no-op (duplicate: true), not reprocessed', () => {
    const existing = [{ idempotencyKey: 'key-1', actionType: 'START_MOVING' as const }];
    const result = submitFieldAction(baseInput({ idempotencyKey: 'key-1', existingActionsForIncident: existing }));
    expect(result).toEqual({ duplicate: true });
  });

  it('a resubmission of an already-once-only action with the SAME key is still just a duplicate no-op, not DuplicateOnceOnlyActionError', () => {
    const existing = [{ idempotencyKey: 'key-1', actionType: 'ACCEPT_TASK' as const }];
    const result = submitFieldAction(
      baseInput({ actionType: 'ACCEPT_TASK', idempotencyKey: 'key-1', existingActionsForIncident: existing })
    );
    expect(result).toEqual({ duplicate: true });
  });

  it('throws DuplicateOnceOnlyActionError for a genuinely SECOND ACCEPT_TASK (different key) on the same incident', () => {
    const existing = [{ idempotencyKey: 'key-1', actionType: 'ACCEPT_TASK' as const }];
    expect(() =>
      submitFieldAction(baseInput({ actionType: 'ACCEPT_TASK', idempotencyKey: 'key-2', existingActionsForIncident: existing }))
    ).toThrow(DuplicateOnceOnlyActionError);
  });

  it('throws DuplicateOnceOnlyActionError for a genuinely SECOND CLOSE_TASK (different key) on the same incident', () => {
    const existing = [{ idempotencyKey: 'key-1', actionType: 'CLOSE_TASK' as const }];
    expect(() =>
      submitFieldAction(
        baseInput({ actionType: 'CLOSE_TASK', idempotencyKey: 'key-2', incidentStatus: 'ON_SCENE', existingActionsForIncident: existing })
      )
    ).toThrow(DuplicateOnceOnlyActionError);
  });

  it('does NOT reject a repeated ACCESS_BLOCKED — only ACCEPT_TASK/CLOSE_TASK are once-per-incident', () => {
    const existing = [{ idempotencyKey: 'key-1', actionType: 'ACCESS_BLOCKED' as const }];
    const result = submitFieldAction(
      baseInput({ actionType: 'ACCESS_BLOCKED', idempotencyKey: 'key-2', incidentStatus: 'EN_ROUTE', existingActionsForIncident: existing })
    );
    expect(result.duplicate).toBe(false);
  });

  it('is a pure function: does not mutate its input', () => {
    const input = baseInput({ existingActionsForIncident: [{ idempotencyKey: 'x', actionType: 'ACCEPT_TASK' }] });
    const snapshot = JSON.parse(JSON.stringify(input));
    submitFieldAction(input);
    expect(JSON.parse(JSON.stringify(input))).toEqual(snapshot);
  });

  it('carries the payload through unchanged when provided, and null when omitted', () => {
    const withPayload = submitFieldAction(baseInput({ actionType: 'ACCESS_BLOCKED', incidentStatus: 'EN_ROUTE', payload: { reason: 'crowd' } }));
    if (!withPayload.duplicate) expect(withPayload.action.payload).toEqual({ reason: 'crowd' });
    const withoutPayload = submitFieldAction(baseInput({ actionType: 'ACCEPT_TASK' }));
    if (!withoutPayload.duplicate) expect(withoutPayload.action.payload).toBeNull();
  });
});
