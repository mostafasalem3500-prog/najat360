import { describe, expect, it } from 'vitest';
import { optimizeRepositioning } from '@/lib/gis/repositioning';
import { MockRoutingProvider } from '@/lib/routing/mock-provider';
import type { CoverageCellInput } from '@/lib/gis/coverage';
import type { OptimizeRepositioningUnit } from '@/lib/gis/repositioning';

// Two cells ~5.2km apart (well past the 480s default gap threshold at
// MockRoutingProvider's assumed vehicle speed, and comfortably inside the
// optimizer's default 150m-6000m relocation-distance window) — real
// MockRoutingProvider math, not a hand-registered fake, since the
// optimizer probes locations it invents itself (candidate target cells),
// which a pre-registered fake can't anticipate.
const CELL_NEAR: CoverageCellInput = { h3Index: 'cellNear', center: { latitude: 24.7136, longitude: 46.6753 } };
const CELL_FAR: CoverageCellInput = { h3Index: 'cellFar', center: { latitude: 24.7486, longitude: 46.7103 } };

function unitsAtCellNear(): OptimizeRepositioningUnit[] {
  return [
    { id: 'unitA', location: { ...CELL_NEAR.center } },
    { id: 'unitB', location: { ...CELL_NEAR.center } },
  ];
}

describe('optimizeRepositioning', () => {
  it('recommends moving a unit to close a real coverage gap when it clears every safety bar', async () => {
    const plan = await optimizeRepositioning({
      cells: [CELL_NEAR, CELL_FAR],
      units: unitsAtCellNear(),
      demandByCell: { cellFar: { predictedDemand: 3, recommendedUnits: 2 } },
      routingProvider: new MockRoutingProvider(),
    });

    expect(plan.status).toBe('RECOMMENDED');
    expect(plan.recommendation).not.toBeNull();
    expect(plan.recommendation!.targetH3Index).toBe('cellFar');
    expect(plan.recommendation!.after.gapCellCount).toBeLessThan(plan.recommendation!.before.gapCellCount);
    expect(plan.recommendation!.requiresHumanApproval).toBe(true);
    expect(plan.recommendation!.relocationDistanceMeters).toBeGreaterThan(150);
    expect(plan.recommendation!.relocationDistanceMeters).toBeLessThan(6000);
    expect(plan.recommendation!.reasoning.length).toBeGreaterThan(0);
  });

  it('abstains with INSUFFICIENT_AVAILABLE_UNITS when fewer than 2 units are supplied', async () => {
    const plan = await optimizeRepositioning({
      cells: [CELL_NEAR, CELL_FAR],
      units: [unitsAtCellNear()[0]!],
      demandByCell: { cellFar: { predictedDemand: 3, recommendedUnits: 2 } },
      routingProvider: new MockRoutingProvider(),
    });
    expect(plan.status).toBe('ABSTAINED');
    expect(plan.abstentionReasons).toContain('INSUFFICIENT_AVAILABLE_UNITS');
  });

  it('abstains with NO_COVERAGE_CELLS when no cells are supplied', async () => {
    const plan = await optimizeRepositioning({
      cells: [],
      units: unitsAtCellNear(),
      demandByCell: {},
      routingProvider: new MockRoutingProvider(),
    });
    expect(plan.status).toBe('ABSTAINED');
    expect(plan.abstentionReasons).toContain('NO_COVERAGE_CELLS');
  });

  it('abstains with NO_DEMAND_HOTSPOTS when no cell has a qualifying demand prediction', async () => {
    const plan = await optimizeRepositioning({
      cells: [CELL_NEAR, CELL_FAR],
      units: unitsAtCellNear(),
      demandByCell: {},
      routingProvider: new MockRoutingProvider(),
    });
    expect(plan.status).toBe('ABSTAINED');
    expect(plan.abstentionReasons).toContain('NO_DEMAND_HOTSPOTS');
  });

  it('abstains with NO_SAFE_MATERIAL_GAIN when minGainSeconds is set unreasonably high', async () => {
    const plan = await optimizeRepositioning({
      cells: [CELL_NEAR, CELL_FAR],
      units: unitsAtCellNear(),
      demandByCell: { cellFar: { predictedDemand: 3, recommendedUnits: 2 } },
      routingProvider: new MockRoutingProvider(),
      options: { minGainSeconds: 1_000_000 },
    });
    expect(plan.status).toBe('ABSTAINED');
    expect(plan.abstentionReasons).toContain('NO_SAFE_MATERIAL_GAIN');
    expect(plan.evaluatedCandidates).toBeGreaterThan(0);
  });

  it('every returned plan reports the same algorithmVersion', async () => {
    const plan = await optimizeRepositioning({
      cells: [],
      units: [],
      demandByCell: {},
      routingProvider: new MockRoutingProvider(),
    });
    expect(plan.algorithmVersion).toBe('najat360.repositioning-optimizer.v1');
  });
});
