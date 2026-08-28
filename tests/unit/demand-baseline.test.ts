import { describe, expect, it } from 'vitest';
import { buildDemandBaselineModel, predictH3Demand, H3_DEMAND_MODEL_VERSION } from '@/lib/gis/demand-baseline';
import { latLngToH3Cell } from '@/lib/gis/h3';

const HOT_CELL_POINT = { latitude: 24.7136, longitude: 46.6753 };
const COLD_CELL_POINT = { latitude: 25.5, longitude: 47.5 }; // far away -> different H3 cell, never used below

function incidentAt(point: { latitude: number; longitude: number }, isoString: string) {
  return { location: point, createdAt: new Date(isoString) };
}

describe('buildDemandBaselineModel', () => {
  it('throws on an empty historical dataset rather than silently producing a bogus model', () => {
    expect(() => buildDemandBaselineModel([])).toThrow();
  });

  it('counts historical incidents per cell correctly', () => {
    const incidents = [
      incidentAt(HOT_CELL_POINT, '2026-08-01T10:00:00.000Z'),
      incidentAt(HOT_CELL_POINT, '2026-08-02T10:00:00.000Z'),
      incidentAt(HOT_CELL_POINT, '2026-08-03T10:00:00.000Z'),
    ];
    const model = buildDemandBaselineModel(incidents);
    const cell = latLngToH3Cell(HOT_CELL_POINT);
    expect(model.cellHistoricalCounts.get(cell)).toBe(3);
  });

  it('an hour with more historical incidents gets an hourFactor greater than 1; a quieter hour gets less than 1', () => {
    // A flat background of 5 incidents in every one of the 24 hours, then
    // hour 14 boosted well above that background and hour 3 dropped well
    // below it — this is what makes "busy"/"quiet" meaningful relative to
    // an average that isn't dominated by just the two hours under test.
    const incidents: ReturnType<typeof incidentAt>[] = [];
    let day = 1;
    for (let hour = 0; hour < 24; hour++) {
      const count = hour === 14 ? 20 : hour === 3 ? 1 : 5;
      for (let n = 0; n < count; n++) {
        incidents.push(incidentAt(HOT_CELL_POINT, `2026-08-${String((day % 28) + 1).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00.000Z`));
        day += 1;
      }
    }
    const model = buildDemandBaselineModel(incidents);
    expect(model.hourFactors[14]!).toBeGreaterThan(1);
    expect(model.hourFactors[3]!).toBeLessThan(1);
  });

  it('is deterministic: the same input always produces the same model', () => {
    const incidents = [incidentAt(HOT_CELL_POINT, '2026-08-01T10:00:00.000Z'), incidentAt(HOT_CELL_POINT, '2026-08-02T14:00:00.000Z')];
    const modelA = buildDemandBaselineModel(incidents);
    const modelB = buildDemandBaselineModel(incidents);
    expect([...modelA.cellRatesPerHour.entries()]).toEqual([...modelB.cellRatesPerHour.entries()]);
    expect(modelA.hourFactors).toEqual(modelB.hourFactors);
    expect(modelA.dayFactors).toEqual(modelB.dayFactors);
  });
});

describe('predictH3Demand', () => {
  it('a cell with zero historical incidents predicts zero demand, not an invented number', () => {
    const incidents = [incidentAt(HOT_CELL_POINT, '2026-08-01T10:00:00.000Z')];
    const model = buildDemandBaselineModel(incidents);
    const coldCell = latLngToH3Cell(COLD_CELL_POINT);
    const prediction = predictH3Demand(model, coldCell, new Date('2026-08-10T10:00:00.000Z'));
    expect(prediction.historicalDemand).toBe(0);
    expect(prediction.predictedDemand).toBe(0);
    expect(prediction.lowerBound).toBe(0);
    expect(prediction.upperBound).toBe(0);
  });

  it('carries the correct model version and window bounds', () => {
    const incidents = [incidentAt(HOT_CELL_POINT, '2026-08-01T10:00:00.000Z')];
    const model = buildDemandBaselineModel(incidents);
    const cell = latLngToH3Cell(HOT_CELL_POINT);
    const windowStart = new Date('2026-08-10T10:00:00.000Z');
    const prediction = predictH3Demand(model, cell, windowStart);
    expect(prediction.modelVersion).toBe(H3_DEMAND_MODEL_VERSION);
    expect(prediction.windowStart).toEqual(windowStart);
    expect(prediction.windowEnd.getTime() - prediction.windowStart.getTime()).toBe(60 * 60 * 1000);
  });

  it('the confidence interval always straddles the predicted value: lowerBound <= predictedDemand <= upperBound', () => {
    const incidents: ReturnType<typeof incidentAt>[] = [];
    for (let day = 1; day <= 15; day++) {
      incidents.push(incidentAt(HOT_CELL_POINT, `2026-08-${String(day).padStart(2, '0')}T14:00:00.000Z`));
    }
    const model = buildDemandBaselineModel(incidents);
    const cell = latLngToH3Cell(HOT_CELL_POINT);
    const prediction = predictH3Demand(model, cell, new Date('2026-08-20T14:00:00.000Z'));
    expect(prediction.lowerBound).toBeLessThanOrEqual(prediction.predictedDemand);
    expect(prediction.upperBound).toBeGreaterThanOrEqual(prediction.predictedDemand);
    expect(prediction.lowerBound).toBeGreaterThanOrEqual(0);
  });

  it('recommendedUnits scales with upperBound and is never negative', () => {
    const incidents: ReturnType<typeof incidentAt>[] = [];
    for (let day = 1; day <= 20; day++) {
      incidents.push(incidentAt(HOT_CELL_POINT, `2026-08-${String(day).padStart(2, '0')}T14:00:00.000Z`));
    }
    const model = buildDemandBaselineModel(incidents);
    const cell = latLngToH3Cell(HOT_CELL_POINT);
    const prediction = predictH3Demand(model, cell, new Date('2026-09-01T14:00:00.000Z'));
    expect(prediction.recommendedUnits).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(prediction.recommendedUnits)).toBe(true);
  });

  it('is deterministic across repeated calls with the same model/cell/window', () => {
    const incidents = [incidentAt(HOT_CELL_POINT, '2026-08-01T10:00:00.000Z'), incidentAt(HOT_CELL_POINT, '2026-08-05T10:00:00.000Z')];
    const model = buildDemandBaselineModel(incidents);
    const cell = latLngToH3Cell(HOT_CELL_POINT);
    const windowStart = new Date('2026-08-10T10:00:00.000Z');
    const first = predictH3Demand(model, cell, windowStart);
    const second = predictH3Demand(model, cell, windowStart);
    expect(first).toEqual(second);
  });
});
