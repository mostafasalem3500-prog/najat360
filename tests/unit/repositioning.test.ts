import { describe, expect, it } from 'vitest';
import { computeRepositioningHotspots } from '@/lib/gis/repositioning';
import type { CellCoverageResult } from '@/lib/gis/coverage';

function cell(overrides: Partial<CellCoverageResult> = {}): CellCoverageResult {
  return {
    h3Index: 'cellA',
    minEtaSeconds: 600,
    nearestUnitId: 'unit-1',
    isGap: true,
    ...overrides,
  };
}

describe('computeRepositioningHotspots', () => {
  it('returns nothing when there are no coverage gaps', () => {
    const result = computeRepositioningHotspots({
      cells: [cell({ isGap: false })],
      demandByCell: { cellA: { predictedDemand: 3, recommendedUnits: 2 } },
    });
    expect(result).toEqual([]);
  });

  it('excludes gap cells with no demand prediction at all', () => {
    const result = computeRepositioningHotspots({
      cells: [cell({ h3Index: 'cellA', isGap: true })],
      demandByCell: {},
    });
    expect(result).toEqual([]);
  });

  it('excludes gap cells whose prediction recommends 0 units', () => {
    const result = computeRepositioningHotspots({
      cells: [cell({ h3Index: 'cellA', isGap: true })],
      demandByCell: { cellA: { predictedDemand: 0.4, recommendedUnits: 0 } },
    });
    expect(result).toEqual([]);
  });

  it('surfaces a gap cell with demand, including nearestUnitId and reasoning', () => {
    const result = computeRepositioningHotspots({
      cells: [cell({ h3Index: 'cellA', minEtaSeconds: 660, nearestUnitId: 'unit-9', isGap: true })],
      demandByCell: { cellA: { predictedDemand: 2.5, recommendedUnits: 2 } },
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.h3Index).toBe('cellA');
    expect(result[0]!.nearestUnitId).toBe('unit-9');
    expect(result[0]!.recommendedUnits).toBe(2);
    expect(result[0]!.reasoning.length).toBeGreaterThan(0);
  });

  it('ranks by recommendedUnits desc, then by ETA desc as a tiebreaker', () => {
    const result = computeRepositioningHotspots({
      cells: [
        cell({ h3Index: 'low-need', minEtaSeconds: 900, nearestUnitId: 'u1' }),
        cell({ h3Index: 'high-need-slower', minEtaSeconds: 800, nearestUnitId: 'u2' }),
        cell({ h3Index: 'high-need-faster', minEtaSeconds: 700, nearestUnitId: 'u3' }),
      ],
      demandByCell: {
        'low-need': { predictedDemand: 1, recommendedUnits: 1 },
        'high-need-slower': { predictedDemand: 3, recommendedUnits: 3 },
        'high-need-faster': { predictedDemand: 3, recommendedUnits: 3 },
      },
    });
    expect(result.map((h) => h.h3Index)).toEqual(['high-need-slower', 'high-need-faster', 'low-need']);
  });

  it('caps results at maxResults', () => {
    const cells = Array.from({ length: 8 }, (_, i) => cell({ h3Index: `c${i}`, minEtaSeconds: 600 + i }));
    const demandByCell = Object.fromEntries(cells.map((c) => [c.h3Index, { predictedDemand: 2, recommendedUnits: 1 }]));
    const result = computeRepositioningHotspots({ cells, demandByCell, maxResults: 3 });
    expect(result).toHaveLength(3);
  });

  it('defaults to at most 5 results when maxResults is not given', () => {
    const cells = Array.from({ length: 8 }, (_, i) => cell({ h3Index: `c${i}`, minEtaSeconds: 600 + i }));
    const demandByCell = Object.fromEntries(cells.map((c) => [c.h3Index, { predictedDemand: 2, recommendedUnits: 1 }]));
    const result = computeRepositioningHotspots({ cells, demandByCell });
    expect(result).toHaveLength(5);
  });
});
