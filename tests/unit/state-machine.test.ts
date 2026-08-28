import { describe, expect, it } from 'vitest';
import {
  canTransition,
  ConnectivityRecoveryMismatchError,
  InvalidTransitionError,
  isTerminal,
  MissingOverrideReasonError,
  transition,
} from '@/lib/incidents/state-machine';
import { INCIDENT_STATUSES, type IncidentStatus } from '@/lib/domain/types';

describe('state machine — golden path', () => {
  it('allows the full NEW -> CLOSED happy path in order', () => {
    const path: IncidentStatus[] = [
      'NEW',
      'VERIFYING',
      'READY_FOR_DECISION',
      'DISPATCHED',
      'EN_ROUTE',
      'AT_ACCESS_POINT',
      'ON_SCENE',
      'CLOSED',
    ];
    for (let i = 0; i < path.length - 1; i++) {
      const from = path[i]!;
      const to = path[i + 1]!;
      expect(() => transition({ from, to })).not.toThrow();
    }
  });
});

describe('state machine — invalid jumps', () => {
  it('rejects skipping states (NEW -> ON_SCENE)', () => {
    expect(() => transition({ from: 'NEW', to: 'ON_SCENE' })).toThrow(InvalidTransitionError);
  });

  it('rejects moving out of a terminal state', () => {
    expect(() => transition({ from: 'CLOSED', to: 'VERIFYING' })).toThrow(InvalidTransitionError);
    expect(() => transition({ from: 'CANCELLED_BY_OPERATOR', to: 'NEW' })).toThrow(
      InvalidTransitionError
    );
  });

  it('canTransition mirrors transition() without throwing', () => {
    expect(canTransition('NEW', 'VERIFYING')).toBe(true);
    expect(canTransition('NEW', 'ON_SCENE')).toBe(false);
  });
});

describe('state machine — override reason requirement (spec line 190)', () => {
  it('rejects CANCELLED_BY_OPERATOR without a reason', () => {
    expect(() => transition({ from: 'EN_ROUTE', to: 'CANCELLED_BY_OPERATOR' })).toThrow(
      MissingOverrideReasonError
    );
  });

  it('rejects a whitespace-only reason', () => {
    expect(() =>
      transition({ from: 'EN_ROUTE', to: 'CANCELLED_BY_OPERATOR', overrideReason: '   ' })
    ).toThrow(MissingOverrideReasonError);
  });

  it('accepts CANCELLED_BY_OPERATOR with a real reason', () => {
    expect(() =>
      transition({
        from: 'EN_ROUTE',
        to: 'CANCELLED_BY_OPERATOR',
        overrideReason: 'caller unreachable',
      })
    ).not.toThrow();
  });

  it('rejects a reason shorter than the DB-enforced minimum of 5 trimmed characters', () => {
    expect(() =>
      transition({ from: 'EN_ROUTE', to: 'CANCELLED_BY_OPERATOR', overrideReason: 'na ' })
    ).toThrow(MissingOverrideReasonError);
  });

  it('accepts a reason exactly at the 5-character minimum', () => {
    expect(() =>
      transition({ from: 'EN_ROUTE', to: 'CANCELLED_BY_OPERATOR', overrideReason: '12345' })
    ).not.toThrow();
  });
});

describe('state machine — exceptional states', () => {
  it('supports LOW_CONFIDENCE round trip back to VERIFYING', () => {
    expect(() => transition({ from: 'NEW', to: 'LOW_CONFIDENCE' })).not.toThrow();
    expect(() => transition({ from: 'LOW_CONFIDENCE', to: 'VERIFYING' })).not.toThrow();
  });

  it('supports NO_UNIT_AVAILABLE retry back to READY_FOR_DECISION', () => {
    expect(() => transition({ from: 'READY_FOR_DECISION', to: 'NO_UNIT_AVAILABLE' })).not.toThrow();
    expect(() => transition({ from: 'NO_UNIT_AVAILABLE', to: 'READY_FOR_DECISION' })).not.toThrow();
  });

  it('supports ACCESS_BLOCKED -> EN_ROUTE after an alternate entrance is accepted', () => {
    expect(() => transition({ from: 'EN_ROUTE', to: 'ACCESS_BLOCKED' })).not.toThrow();
    expect(() => transition({ from: 'ACCESS_BLOCKED', to: 'EN_ROUTE' })).not.toThrow();
  });
});

describe('state machine — LOST_CONNECTIVITY (exact-recovery, credited to comparing against a second independent C1 attempt)', () => {
  it('entering LOST_CONNECTIVITY records the status it came from', () => {
    const result = transition({ from: 'EN_ROUTE', to: 'LOST_CONNECTIVITY' });
    expect(result.statusBeforeConnectivityLoss).toBe('EN_ROUTE');
  });

  it('recovering to the exact recorded prior status succeeds and clears the stored value', () => {
    const result = transition({
      from: 'LOST_CONNECTIVITY',
      to: 'EN_ROUTE',
      statusBeforeConnectivityLoss: 'EN_ROUTE',
    });
    expect(result.statusBeforeConnectivityLoss).toBeNull();
  });

  it('rejects recovering to a DIFFERENT status than the one recorded before the loss (both structurally valid adjacency targets)', () => {
    expect(() =>
      transition({
        from: 'LOST_CONNECTIVITY',
        to: 'AT_ACCESS_POINT',
        statusBeforeConnectivityLoss: 'EN_ROUTE',
      })
    ).toThrow(ConnectivityRecoveryMismatchError);
  });

  it('rejects recovery when no prior status was recorded at all', () => {
    expect(() =>
      transition({ from: 'LOST_CONNECTIVITY', to: 'EN_ROUTE', statusBeforeConnectivityLoss: undefined })
    ).toThrow(ConnectivityRecoveryMismatchError);
  });

  it('cancelling out of LOST_CONNECTIVITY does not require matching a recorded prior status', () => {
    expect(() =>
      transition({
        from: 'LOST_CONNECTIVITY',
        to: 'CANCELLED_BY_OPERATOR',
        overrideReason: 'unit unreachable',
        statusBeforeConnectivityLoss: 'EN_ROUTE',
      })
    ).not.toThrow();
  });

  it('a transition unrelated to LOST_CONNECTIVITY leaves statusBeforeConnectivityLoss undefined (do not touch stored value)', () => {
    const result = transition({ from: 'NEW', to: 'VERIFYING' });
    expect(result.statusBeforeConnectivityLoss).toBeUndefined();
  });
});

describe('state machine — completeness', () => {
  it('every non-terminal status has at least one legal outgoing transition', () => {
    // Guards against silently adding a new status with no way out of it.
    for (const status of INCIDENT_STATUSES) {
      if (isTerminal(status)) continue;
      const hasAnOutgoingEdge = INCIDENT_STATUSES.some((candidate) =>
        canTransition(status, candidate)
      );
      expect(hasAnOutgoingEdge, `${status} has no outgoing transitions`).toBe(true);
    }
  });

  it('isTerminal agrees with an empty outgoing transition list', () => {
    for (const status of INCIDENT_STATUSES) {
      if (isTerminal(status)) {
        expect(() => transition({ from: status, to: 'VERIFYING' })).toThrow(InvalidTransitionError);
      }
    }
  });
});
