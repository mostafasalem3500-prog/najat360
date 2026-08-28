import { describe, expect, it } from 'vitest';
import { generateCoverageAwareRecommendation } from '@/lib/dispatch/generate-coverage-recommendation';
import { NoAvailableUnitsError, NoCandidateEntrancesError, type EntranceCandidateInput, type UnitCandidateInput } from '@/lib/dispatch/generate-recommendation';
import type { CoverageCellInput } from '@/lib/gis/coverage';
import type { LatLng } from '@/lib/geo';
import type { MatrixResult, RouteInput, RouteResult, RoutingProvider } from '@/lib/routing/provider';
import type { ProviderHealth } from '@/lib/providers/health';

const NOW = new Date('2026-08-24T12:00:00.000Z');

function locKey(p: LatLng): string {
  return `${p.latitude},${p.longitude}`;
}

/**
 * Combined fake: pre-registered `route()` results (for the per-candidate
 * unit->entrance leg) AND pre-registered `matrix()` rows keyed by ORIGIN
 * (for the coverage engine's unit->cell ETA scan). Everything must be
 * pre-registered — an unregistered lookup throws, so a test can never
 * silently pass on an un-pinned value.
 */
class FakeRoutingProvider implements RoutingProvider {
  readonly name = 'fake-routing-provider';
  private readonly routeSpecs = new Map<string, { durationSeconds: number; distanceMeters: number }>();
  private readonly matrixRows = new Map<string, number[]>();

  registerRoute(origin: LatLng, destination: LatLng, mode: 'VEHICLE' | 'PEDESTRIAN', durationSeconds: number, distanceMeters = durationSeconds * 10) {
    this.routeSpecs.set(`${locKey(origin)}->${locKey(destination)}:${mode}`, { durationSeconds, distanceMeters });
  }

  /** `durationsSeconds` must be in the SAME order as the `cells` array the test passes as `coverageCells`. */
  registerMatrixRow(origin: LatLng, durationsSeconds: number[]) {
    this.matrixRows.set(locKey(origin), durationsSeconds);
  }

  async route(input: RouteInput): Promise<RouteResult> {
    const spec = this.routeSpecs.get(`${locKey(input.origin)}->${locKey(input.destination)}:${input.mode}`);
    if (!spec) throw new Error(`FakeRoutingProvider: no route configured for ${JSON.stringify(input)}`);
    return { ...spec, geometry: '{}', provider: this.name, providerMode: 'MOCK', dataFreshnessAt: NOW };
  }

  async matrix(input: { origins: LatLng[]; destinations: LatLng[]; mode: 'VEHICLE' | 'PEDESTRIAN' }): Promise<MatrixResult> {
    const durationsSeconds = input.origins.map((origin) => {
      const row = this.matrixRows.get(locKey(origin));
      if (!row) throw new Error(`FakeRoutingProvider: no matrix row for origin ${locKey(origin)}`);
      return row;
    });
    return {
      durationsSeconds,
      distancesMeters: durationsSeconds.map((row) => row.map((s) => s * 10)),
      provider: this.name,
      providerMode: 'MOCK',
      dataFreshnessAt: NOW,
    };
  }

  async health(): Promise<ProviderHealth> {
    return { status: 'SIMULATED', provider: this.name };
  }
}

function entrance(overrides: Partial<EntranceCandidateInput> & { id: string; latitude: number; longitude: number }): EntranceCandidateInput {
  return {
    active: true,
    validationStatus: 'FIELD_CONFIRMED',
    vehicleAccessible: true,
    pedestrianAccessible: true,
    isServiceGate: false,
    temporaryRestriction: undefined,
    floorLevel: undefined,
    hasElevator: false,
    vehicleStopLatitude: undefined,
    vehicleStopLongitude: undefined,
    ...overrides,
  };
}

function unit(overrides: Partial<UnitCandidateInput> & { id: string; location: LatLng }): UnitCandidateInput {
  return { readinessScore: 80, ...overrides };
}

describe('generateCoverageAwareRecommendation', () => {
  it('throws NoAvailableUnitsError when no units are supplied', async () => {
    const routingProvider = new FakeRoutingProvider();
    await expect(
      generateCoverageAwareRecommendation({
        incidentId: 'inc-1',
        locationConfidenceIndex: 100,
        availableUnits: [],
        candidateEntrances: [entrance({ id: 'ent-1', latitude: 10, longitude: 10 })],
        coverageCells: [],
        routingProvider,
      })
    ).rejects.toThrow(NoAvailableUnitsError);
  });

  it('throws NoCandidateEntrancesError when no active entrances are supplied', async () => {
    const routingProvider = new FakeRoutingProvider();
    await expect(
      generateCoverageAwareRecommendation({
        incidentId: 'inc-1',
        locationConfidenceIndex: 100,
        availableUnits: [unit({ id: 'unit-1', location: { latitude: 1, longitude: 1 } })],
        candidateEntrances: [],
        coverageCells: [],
        routingProvider,
      })
    ).rejects.toThrow(NoCandidateEntrancesError);
  });

  it('spec 29.9 acceptance test 6: the fastest unit, if it uniquely covers a critical cell, loses to a slower-but-coverage-safe alternative', async () => {
    const entX: LatLng = { latitude: 10, longitude: 10 };
    const fastUnitLoc: LatLng = { latitude: 10.001, longitude: 10.001 };
    const slowUnitLoc: LatLng = { latitude: 10.002, longitude: 10.002 };
    const criticalCell: CoverageCellInput = { h3Index: 'cell-critical', center: { latitude: 11, longitude: 11 } };

    const routingProvider = new FakeRoutingProvider();
    // Route to the incident's entrance: fast unit is genuinely faster.
    routingProvider.registerRoute(fastUnitLoc, entX, 'VEHICLE', 90);
    routingProvider.registerRoute(slowUnitLoc, entX, 'VEHICLE', 180);
    // Coverage of the (unrelated) critical cell elsewhere in the grid:
    // fast unit is the ONLY realistic responder to it; slow unit can't
    // reasonably reach it at all.
    routingProvider.registerMatrixRow(fastUnitLoc, [60]);
    routingProvider.registerMatrixRow(slowUnitLoc, [3000]);

    const result = await generateCoverageAwareRecommendation({
      incidentId: 'inc-1',
      locationConfidenceIndex: 100,
      availableUnits: [
        unit({ id: 'unit-fast', location: fastUnitLoc, readinessScore: 80 }),
        unit({ id: 'unit-slow', location: slowUnitLoc, readinessScore: 80 }),
      ],
      candidateEntrances: [entrance({ id: 'ent-X', latitude: entX.latitude, longitude: entX.longitude })],
      coverageCells: [criticalCell],
      routingProvider,
    });

    // Confirm this is a REAL flip, not a fluke: the fast unit does have
    // the better ETA score, and a low coverageProtection score explains
    // exactly why it lost (spec 29.9's "explained breakdown" requirement).
    const fastCandidate = result.candidates.find((c) => c.unitId === 'unit-fast')!;
    const slowCandidate = result.candidates.find((c) => c.unitId === 'unit-slow')!;
    expect(fastCandidate.breakdown.etaScore!).toBeGreaterThan(slowCandidate.breakdown.etaScore!);
    expect(fastCandidate.breakdown.coverageProtection!).toBeLessThan(slowCandidate.breakdown.coverageProtection!);

    expect(result.recommendedUnitId).toBe('unit-slow');
    expect(result.algorithmVersion).toBe('dispatch-score-v1');
  });

  it('reports coverageBefore/coverageAfter with mean, P90, worst cell, and gap count', async () => {
    const entX: LatLng = { latitude: 10, longitude: 10 };
    const unitALoc: LatLng = { latitude: 10.001, longitude: 10.001 };
    const unitBLoc: LatLng = { latitude: 10.002, longitude: 10.002 };
    const cell: CoverageCellInput = { h3Index: 'cell-1', center: { latitude: 11, longitude: 11 } };

    const routingProvider = new FakeRoutingProvider();
    routingProvider.registerRoute(unitALoc, entX, 'VEHICLE', 100);
    routingProvider.registerRoute(unitBLoc, entX, 'VEHICLE', 100);
    routingProvider.registerMatrixRow(unitALoc, [200]);
    routingProvider.registerMatrixRow(unitBLoc, [250]);

    const result = await generateCoverageAwareRecommendation({
      incidentId: 'inc-1',
      locationConfidenceIndex: 100,
      availableUnits: [unit({ id: 'unit-a', location: unitALoc }), unit({ id: 'unit-b', location: unitBLoc })],
      candidateEntrances: [entrance({ id: 'ent-X', latitude: entX.latitude, longitude: entX.longitude })],
      coverageCells: [cell],
      routingProvider,
    });

    expect(result.coverageBefore.totalCells).toBe(1);
    expect(result.coverageBefore.meanEtaSeconds).toBe(200); // min(200,250)
    expect(result.coverageAfter.totalCells).toBe(1);
    expect(result.reasoning.some((r) => r.startsWith('COVERAGE_BEFORE:'))).toBe(true);
    expect(result.reasoning.some((r) => r.startsWith('COVERAGE_AFTER:'))).toBe(true);
  });

  it('falls back to coverageBefore with a SINGLE_UNIT_NO_COMPARISON tag when only one unit is available', async () => {
    const entX: LatLng = { latitude: 10, longitude: 10 };
    const unitLoc: LatLng = { latitude: 10.001, longitude: 10.001 };
    const cell: CoverageCellInput = { h3Index: 'cell-1', center: { latitude: 11, longitude: 11 } };

    const routingProvider = new FakeRoutingProvider();
    routingProvider.registerRoute(unitLoc, entX, 'VEHICLE', 100);
    routingProvider.registerMatrixRow(unitLoc, [200]);

    const result = await generateCoverageAwareRecommendation({
      incidentId: 'inc-1',
      locationConfidenceIndex: 100,
      availableUnits: [unit({ id: 'unit-only', location: unitLoc })],
      candidateEntrances: [entrance({ id: 'ent-X', latitude: entX.latitude, longitude: entX.longitude })],
      coverageCells: [cell],
      routingProvider,
    });

    expect(result.coverageAfter).toEqual(result.coverageBefore);
    expect(result.reasoning).toContain('SINGLE_UNIT_NO_COMPARISON');
    expect(result.candidates[0]!.breakdown.coverageProtection).toBe(100 * 0.15);
  });

  it('is deterministic: repeated calls with the same input produce the same result', async () => {
    const entX: LatLng = { latitude: 10, longitude: 10 };
    const unitLoc: LatLng = { latitude: 10.001, longitude: 10.001 };
    const cell: CoverageCellInput = { h3Index: 'cell-1', center: { latitude: 11, longitude: 11 } };
    const routingProvider = new FakeRoutingProvider();
    routingProvider.registerRoute(unitLoc, entX, 'VEHICLE', 100);
    routingProvider.registerMatrixRow(unitLoc, [200]);

    const makeInput = () => ({
      incidentId: 'inc-1',
      locationConfidenceIndex: 100,
      availableUnits: [unit({ id: 'unit-only', location: unitLoc })],
      candidateEntrances: [entrance({ id: 'ent-X', latitude: entX.latitude, longitude: entX.longitude })],
      coverageCells: [cell],
      routingProvider,
    });
    const first = await generateCoverageAwareRecommendation(makeInput());
    const second = await generateCoverageAwareRecommendation(makeInput());
    expect(first.dispatchScore).toBe(second.dispatchScore);
    expect(first.recommendedUnitId).toBe(second.recommendedUnitId);
  });
});
