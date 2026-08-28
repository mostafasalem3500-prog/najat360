import { describe, expect, it } from 'vitest';
import {
  decideDispatch,
  markNoUnitAvailable,
  MissingDecidedByError,
  UnitNotAvailableError,
  UnitAlreadyAssignedError,
  MissingDispatchOverrideReasonError,
  type DecideDispatchInput,
} from '@/lib/dispatch/decision';
import { InvalidTransitionError } from '@/lib/incidents/state-machine';

function baseInput(overrides: Partial<DecideDispatchInput> = {}): DecideDispatchInput {
  return {
    incidentStatus: 'READY_FOR_DECISION',
    recommendedUnitId: 'unit-1',
    recommendedEntranceId: 'ent-1',
    chosenUnitId: 'unit-1',
    chosenEntranceId: 'ent-1',
    chosenUnit: { id: 'unit-1', status: 'AVAILABLE', hasOtherActiveIncidentAssigned: false },
    decidedById: 'supervisor-1',
    ...overrides,
  };
}

describe('decideDispatch', () => {
  it('accepts the recommended unit/entrance with no override reason needed', () => {
    const result = decideDispatch(baseInput());
    expect(result.wasOverride).toBe(false);
    expect(result.assignedUnitId).toBe('unit-1');
    expect(result.assignedEntranceId).toBe('ent-1');
    expect(result.incidentTransition.to).toBe('DISPATCHED');
    expect(result.overrideReason).toBeUndefined();
  });

  it('throws MissingDecidedByError when decidedById is empty or whitespace', () => {
    expect(() => decideDispatch(baseInput({ decidedById: '' }))).toThrow(MissingDecidedByError);
    expect(() => decideDispatch(baseInput({ decidedById: '   ' }))).toThrow(MissingDecidedByError);
  });

  it('throws UnitNotAvailableError when the freshly-checked unit status is not AVAILABLE, even if it was AVAILABLE in the recommendation', () => {
    const input = baseInput({ chosenUnit: { id: 'unit-1', status: 'BUSY', hasOtherActiveIncidentAssigned: false } });
    expect(() => decideDispatch(input)).toThrow(UnitNotAvailableError);
    try {
      decideDispatch(input);
    } catch (e) {
      expect((e as UnitNotAvailableError).status).toBe('BUSY');
      expect((e as UnitNotAvailableError).unitId).toBe('unit-1');
    }
  });

  it('throws UnitAlreadyAssignedError when the unit already holds another active incident', () => {
    const input = baseInput({ chosenUnit: { id: 'unit-1', status: 'AVAILABLE', hasOtherActiveIncidentAssigned: true } });
    expect(() => decideDispatch(input)).toThrow(UnitAlreadyAssignedError);
  });

  it('checks unit availability before override-reason validation (a BUSY unit fails for the right reason even with no reason supplied)', () => {
    const input = baseInput({
      chosenUnitId: 'unit-2',
      chosenUnit: { id: 'unit-2', status: 'BUSY', hasOtherActiveIncidentAssigned: false },
    });
    expect(() => decideDispatch(input)).toThrow(UnitNotAvailableError);
  });

  it('treats choosing a different unit than recommended as an override requiring a reason', () => {
    const input = baseInput({ chosenUnitId: 'unit-2', chosenUnit: { id: 'unit-2', status: 'AVAILABLE', hasOtherActiveIncidentAssigned: false } });
    expect(() => decideDispatch(input)).toThrow(MissingDispatchOverrideReasonError);
  });

  it('treats choosing a different entrance than recommended as an override requiring a reason', () => {
    const input = baseInput({ chosenEntranceId: 'ent-2' });
    expect(() => decideDispatch(input)).toThrow(MissingDispatchOverrideReasonError);
  });

  it('rejects an override reason shorter than MIN_OVERRIDE_REASON_LENGTH', () => {
    const input = baseInput({ chosenEntranceId: 'ent-2', overrideReason: 'hi' });
    expect(() => decideDispatch(input)).toThrow(MissingDispatchOverrideReasonError);
  });

  it('accepts an override with a sufficiently long reason and marks wasOverride true', () => {
    const input = baseInput({
      chosenUnitId: 'unit-2',
      chosenUnit: { id: 'unit-2', status: 'AVAILABLE', hasOtherActiveIncidentAssigned: false },
      overrideReason: 'closer unit available on scene',
    });
    const result = decideDispatch(input);
    expect(result.wasOverride).toBe(true);
    expect(result.overrideReason).toBe('closer unit available on scene');
  });

  it('does not surface an overrideReason on the result when the choice matched the recommendation, even if one was supplied', () => {
    const input = baseInput({ overrideReason: 'irrelevant reason text' });
    const result = decideDispatch(input);
    expect(result.wasOverride).toBe(false);
    expect(result.overrideReason).toBeUndefined();
  });

  it('rejects a decision when the incident is not in READY_FOR_DECISION (delegates to state-machine.transition)', () => {
    const input = baseInput({ incidentStatus: 'NEW' });
    expect(() => decideDispatch(input)).toThrow(InvalidTransitionError);
  });

  it('is a pure function: does not mutate its input', () => {
    const input = baseInput();
    const snapshot = JSON.parse(JSON.stringify(input));
    decideDispatch(input);
    expect(input).toEqual(snapshot);
  });
});

describe('markNoUnitAvailable', () => {
  it('transitions READY_FOR_DECISION to NO_UNIT_AVAILABLE', () => {
    const result = markNoUnitAvailable('READY_FOR_DECISION');
    expect(result.to).toBe('NO_UNIT_AVAILABLE');
  });

  it('throws InvalidTransitionError from a status with no such edge', () => {
    expect(() => markNoUnitAvailable('NEW')).toThrow(InvalidTransitionError);
  });
});
