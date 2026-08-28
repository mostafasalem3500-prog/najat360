import { describe, expect, it } from 'vitest';
import { computeEntranceAccessibilityScore, ENTRANCE_ACCESSIBILITY_VERSION } from '@/lib/dispatch/entrance-accessibility';

function baseEntrance() {
  return {
    active: true,
    validationStatus: 'FIELD_CONFIRMED' as const,
    vehicleAccessible: true,
    pedestrianAccessible: true,
    isServiceGate: false,
    temporaryRestriction: null as string | null | undefined,
    floorLevel: null as string | null | undefined,
    hasElevator: false,
  };
}

describe('computeEntranceAccessibilityScore', () => {
  it('a fully-accessible, field-confirmed, active entrance scores 100', () => {
    expect(computeEntranceAccessibilityScore({ entrance: baseEntrance() })).toBe(100);
  });

  it('an inactive entrance scores 0 outright, regardless of other fields', () => {
    const entrance = { ...baseEntrance(), active: false };
    expect(computeEntranceAccessibilityScore({ entrance })).toBe(0);
  });

  it('applies validation-status penalties: MANUALLY_REVIEWED -10, UNVERIFIED -20', () => {
    const reviewed = computeEntranceAccessibilityScore({ entrance: { ...baseEntrance(), validationStatus: 'MANUALLY_REVIEWED' } });
    expect(reviewed).toBe(90);
    const unverified = computeEntranceAccessibilityScore({ entrance: { ...baseEntrance(), validationStatus: 'UNVERIFIED' } });
    expect(unverified).toBe(80);
  });

  it('penalizes lack of vehicle access (-25) and lack of pedestrian access (-10) independently', () => {
    const noVehicle = computeEntranceAccessibilityScore({ entrance: { ...baseEntrance(), vehicleAccessible: false } });
    expect(noVehicle).toBe(75);
    const noPedestrian = computeEntranceAccessibilityScore({ entrance: { ...baseEntrance(), pedestrianAccessible: false } });
    expect(noPedestrian).toBe(90);
  });

  it('penalizes a service gate (-15)', () => {
    const serviceGate = computeEntranceAccessibilityScore({ entrance: { ...baseEntrance(), isServiceGate: true } });
    expect(serviceGate).toBe(85);
  });

  it('penalizes a non-empty temporaryRestriction (-30) but not an empty or whitespace-only one', () => {
    const restricted = computeEntranceAccessibilityScore({ entrance: { ...baseEntrance(), temporaryRestriction: 'blocked for construction' } });
    expect(restricted).toBe(70);
    const emptyString = computeEntranceAccessibilityScore({ entrance: { ...baseEntrance(), temporaryRestriction: '' } });
    expect(emptyString).toBe(100);
    const whitespaceOnly = computeEntranceAccessibilityScore({ entrance: { ...baseEntrance(), temporaryRestriction: '   ' } });
    expect(whitespaceOnly).toBe(100);
  });

  it('does not penalize a floor mismatch when either side has no known floor', () => {
    const noResolvedFloor = computeEntranceAccessibilityScore({
      entrance: { ...baseEntrance(), floorLevel: '3' },
      resolvedFloorLevel: null,
    });
    expect(noResolvedFloor).toBe(100);
    const noEntranceFloor = computeEntranceAccessibilityScore({
      entrance: { ...baseEntrance(), floorLevel: null },
      resolvedFloorLevel: '3',
    });
    expect(noEntranceFloor).toBe(100);
  });

  it('does not penalize when the resolved floor matches the entrance floor', () => {
    const match = computeEntranceAccessibilityScore({
      entrance: { ...baseEntrance(), floorLevel: '3' },
      resolvedFloorLevel: '3',
    });
    expect(match).toBe(100);
  });

  it('penalizes a floor mismatch -5 when an elevator exists, -15 when it does not', () => {
    const withElevator = computeEntranceAccessibilityScore({
      entrance: { ...baseEntrance(), floorLevel: '3', hasElevator: true },
      resolvedFloorLevel: '5',
    });
    expect(withElevator).toBe(95);
    const withoutElevator = computeEntranceAccessibilityScore({
      entrance: { ...baseEntrance(), floorLevel: '3', hasElevator: false },
      resolvedFloorLevel: '5',
    });
    expect(withoutElevator).toBe(85);
  });

  it('stacks multiple penalties and floors the result at 0', () => {
    const worst = computeEntranceAccessibilityScore({
      entrance: {
        active: true,
        validationStatus: 'UNVERIFIED',
        vehicleAccessible: false,
        pedestrianAccessible: false,
        isServiceGate: true,
        temporaryRestriction: 'fully blocked',
        floorLevel: '3',
        hasElevator: false,
      },
      resolvedFloorLevel: '9',
    });
    // 100 - 20 - 25 - 10 - 15 - 30 - 15 = -15, floored to 0
    expect(worst).toBe(0);
  });

  it('is a pure function: does not mutate its input', () => {
    const entrance = baseEntrance();
    const snapshot = { ...entrance };
    computeEntranceAccessibilityScore({ entrance, resolvedFloorLevel: '3' });
    expect(entrance).toEqual(snapshot);
  });

  it('exposes a stable version string', () => {
    expect(ENTRANCE_ACCESSIBILITY_VERSION).toBe('entrance-accessibility-v1');
  });
});
