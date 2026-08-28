import { describe, expect, it } from 'vitest';
import {
  computeCoverageMetrics,
  computeCoverageProtection,
  percentile,
  NoUnitsForCoverageError,
  NoCellsForCoverageError,
  DEFAULT_COVERAGE_GAP_THRESHOLD_SECONDS,
} from '@/lib/gis/coverage';
import type { RoutingProvider, RoutingProviderMode } from '@/lib/routing/provider';

/**
 * A stub RoutingProvider whose `matrix()` returns durations from a
 * hand-crafted lookup table keyed by ORIGIN COORDINATE (not position),
 * so it responds correctly no matter which subset/order of units a given
 * call actually passes as origins — `computeCoverageProtection()` calls
 * `matrix()` once per "unit removed" scenario with a shrinking origin
 * list, and a position-keyed stub would silently misattribute rows.
 */
function locationKey(point: { latitude: number; longitude: number }): string {
  return `${point.latitude},${point.longitude}`;
}

function stubRoutingProvider(
  durationsByOrigin: Array<{ location: { latitude: number; longitude: number }; durationsSeconds: number[] }>,
  providerMode: RoutingProviderMode = 'MOCK'
): RoutingProvider {
  const byOrigin = new Map(durationsByOrigin.map((o) => [locationKey(o.location), o.durationsSeconds]));
  return {
    name: 'stub-routing-provider',
    async route() {
      throw new Error('stubRoutingProvider.route() not used by these tests');
    },
    async matrix(input) {
      const durationsSeconds = input.origins.map((origin) => {
        const row = byOrigin.get(locationKey(origin));
        if (!row) throw new Error(`stubRoutingProvider: no fixture for origin ${locationKey(origin)}`);
        return row;
      });
      return {
        durationsSeconds,
        distancesMeters: durationsSeconds.map((row) => row.map((s) => s * 10)),
        provider: 'stub-routing-provider',
        providerMode,
        dataFreshnessAt: new Date('2026-08-24T00:00:00.000Z'),
      };
    },
    async health() {
      return { status: 'SIMULATED' as const, provider: 'stub-routing-provider' };
    },
  };
}

const CELLS = [
  { h3Index: 'cell-a', center: { latitude: 24.71, longitude: 46.67 } },
  { h3Index: 'cell-b', center: { latitude: 24.72, longitude: 46.68 } },
  { h3Index: 'cell-c', center: { latitude: 24.73, longitude: 46.69 } },
];

const UNIT_1_LOC = { latitude: 24.711, longitude: 46.671 };
const UNIT_2_LOC = { latitude: 24.732, longitude: 46.692 };

const UNITS = [
  { id: 'unit-1', location: UNIT_1_LOC },
  { id: 'unit-2', location: UNIT_2_LOC },
];

describe('percentile', () => {
  it('returns the single value for a 1-element array', () => {
    expect(percentile([42], 0.9)).toBe(42);
  });

  it('returns 0 for an empty array', () => {
    expect(percentile([], 0.9)).toBe(0);
  });

  it('P90 of [10,20,...,100] matches the standard linear-interpolation result', () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    // rank = 0.9 * 9 = 8.1 -> interpolate between index 8 (90) and 9 (100)
    expect(percentile(values, 0.9)).toBeCloseTo(91, 5);
  });

  it('P50 of an odd-length array returns the exact median', () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
  });
});

describe('computeCoverageMetrics', () => {
  it('picks the minimum ETA across units for each cell and identifies the nearest unit', async () => {
    const routingProvider = stubRoutingProvider([
      { location: UNIT_1_LOC, durationsSeconds: [100, 300, 500] },
      { location: UNIT_2_LOC, durationsSeconds: [500, 300, 100] },
    ]);
    const metrics = await computeCoverageMetrics({ cells: CELLS, units: UNITS, routingProvider });
    const byCell = Object.fromEntries(metrics.cells.map((c) => [c.h3Index, c]));
    expect(byCell['cell-a']!.minEtaSeconds).toBe(100);
    expect(byCell['cell-a']!.nearestUnitId).toBe('unit-1');
    expect(byCell['cell-c']!.minEtaSeconds).toBe(100);
    expect(byCell['cell-c']!.nearestUnitId).toBe('unit-2');
    expect(byCell['cell-b']!.minEtaSeconds).toBe(300);
  });

  it('computes a plain (unweighted) mean across cells', async () => {
    const routingProvider = stubRoutingProvider([
      { location: UNIT_1_LOC, durationsSeconds: [100, 200, 300] },
      { location: UNIT_2_LOC, durationsSeconds: [900, 900, 900] },
    ]);
    const metrics = await computeCoverageMetrics({ cells: CELLS, units: UNITS, routingProvider });
    expect(metrics.meanEtaSeconds).toBe(Math.round((100 + 200 + 300) / 3));
  });

  it('classifies a cell as a gap when its min ETA exceeds the threshold', async () => {
    const routingProvider = stubRoutingProvider([
      { location: UNIT_1_LOC, durationsSeconds: [100, 200, 900] },
      { location: UNIT_2_LOC, durationsSeconds: [900, 900, 900] },
    ]);
    const metrics = await computeCoverageMetrics({ cells: CELLS, units: UNITS, routingProvider, gapThresholdSeconds: 500 });
    expect(metrics.gapCellCount).toBe(1);
    expect(metrics.cells.find((c) => c.h3Index === 'cell-c')!.isGap).toBe(true);
    expect(metrics.cells.find((c) => c.h3Index === 'cell-a')!.isGap).toBe(false);
  });

  it('uses the documented default gap threshold when none is supplied', async () => {
    const routingProvider = stubRoutingProvider([
      { location: UNIT_1_LOC, durationsSeconds: [DEFAULT_COVERAGE_GAP_THRESHOLD_SECONDS + 1, 100, 100] },
      { location: UNIT_2_LOC, durationsSeconds: [900, 900, 900] },
    ]);
    const metrics = await computeCoverageMetrics({ cells: CELLS, units: UNITS, routingProvider });
    expect(metrics.gapThresholdSeconds).toBe(DEFAULT_COVERAGE_GAP_THRESHOLD_SECONDS);
    expect(metrics.cells.find((c) => c.h3Index === 'cell-a')!.isGap).toBe(true);
  });

  it('identifies the true worst (max ETA) cell, independent of P90', async () => {
    const routingProvider = stubRoutingProvider([
      { location: UNIT_1_LOC, durationsSeconds: [100, 200, 5000] },
      { location: UNIT_2_LOC, durationsSeconds: [900, 900, 6000] },
    ]);
    const metrics = await computeCoverageMetrics({ cells: CELLS, units: UNITS, routingProvider });
    expect(metrics.worstCell.h3Index).toBe('cell-c');
    expect(metrics.worstCell.etaSeconds).toBe(5000);
  });

  it('labels mode "simulation" for a MOCK provider and "live" for a LIVE provider', async () => {
    const flatFixture = [
      { location: UNIT_1_LOC, durationsSeconds: [100, 100, 100] },
      { location: UNIT_2_LOC, durationsSeconds: [100, 100, 100] },
    ];
    const mockMetrics = await computeCoverageMetrics({
      cells: CELLS,
      units: UNITS,
      routingProvider: stubRoutingProvider(flatFixture, 'MOCK'),
    });
    expect(mockMetrics.mode).toBe('simulation');
    const liveMetrics = await computeCoverageMetrics({
      cells: CELLS,
      units: UNITS,
      routingProvider: stubRoutingProvider(flatFixture, 'LIVE'),
    });
    expect(liveMetrics.mode).toBe('live');
  });

  it('throws NoUnitsForCoverageError with zero units', async () => {
    await expect(
      computeCoverageMetrics({ cells: CELLS, units: [], routingProvider: stubRoutingProvider([]) })
    ).rejects.toThrow(NoUnitsForCoverageError);
  });

  it('throws NoCellsForCoverageError with zero cells', async () => {
    await expect(
      computeCoverageMetrics({ cells: [], units: UNITS, routingProvider: stubRoutingProvider([]) })
    ).rejects.toThrow(NoCellsForCoverageError);
  });
});

describe('computeCoverageProtection', () => {
  it('a unit with a near-equal backup gets a high protection score', async () => {
    const CELLS2 = [
      { h3Index: 'cell-a', center: { latitude: 24.71, longitude: 46.67 } },
      { h3Index: 'cell-b', center: { latitude: 24.72, longitude: 46.68 } },
    ];
    const soleCovererLoc = { latitude: 24.711, longitude: 46.671 };
    const redundantLoc = { latitude: 24.712, longitude: 46.672 };
    const units = [
      { id: 'sole-coverer', location: soleCovererLoc },
      { id: 'redundant', location: redundantLoc },
    ];
    // sole-coverer -> [a:60, b:60]; redundant -> [a:65, b:65] (nearly as fast, real backup)
    const routingProvider = stubRoutingProvider([
      { location: soleCovererLoc, durationsSeconds: [60, 60] },
      { location: redundantLoc, durationsSeconds: [65, 65] },
    ]);
    const protection = await computeCoverageProtection({ cells: CELLS2, units, routingProvider });
    // Removing "redundant" barely moves coverage (the other unit is almost as fast).
    expect(protection.perUnit['redundant']!.meanEtaDeltaSeconds).toBeLessThanOrEqual(5);
    expect(protection.perUnit['redundant']!.protectionScore).toBeGreaterThan(90);
  });

  it('removing the truly indispensable unit produces a larger mean-ETA delta than removing a replaceable one', async () => {
    const CELLS2 = [{ h3Index: 'cell-a', center: { latitude: 24.71, longitude: 46.67 } }];
    const farLoc = { latitude: 24.9, longitude: 46.9 };
    const nearLoc = { latitude: 24.711, longitude: 46.671 };
    const units = [
      { id: 'far-unit', location: farLoc },
      { id: 'near-unit', location: nearLoc },
    ];
    // near-unit -> [a:60]; far-unit -> [a:2000] (much slower backup)
    const routingProvider = stubRoutingProvider([
      { location: farLoc, durationsSeconds: [2000] },
      { location: nearLoc, durationsSeconds: [60] },
    ]);
    const protection = await computeCoverageProtection({ cells: CELLS2, units, routingProvider });
    // Removing near-unit leaves only the far, slow unit -> big mean-ETA jump.
    // Removing far-unit leaves the near, fast unit -> mean ETA barely changes.
    expect(protection.perUnit['near-unit']!.meanEtaDeltaSeconds).toBeGreaterThan(protection.perUnit['far-unit']!.meanEtaDeltaSeconds);
    expect(protection.perUnit['near-unit']!.protectionScore).toBeLessThan(protection.perUnit['far-unit']!.protectionScore);
  });

  it('throws with fewer than 2 units — there is no "without this unit" state to compare', async () => {
    await expect(
      computeCoverageProtection({
        cells: CELLS,
        units: [UNITS[0]!],
        routingProvider: stubRoutingProvider([{ location: UNIT_1_LOC, durationsSeconds: [100, 100, 100] }]),
      })
    ).rejects.toThrow(NoUnitsForCoverageError);
  });
});
