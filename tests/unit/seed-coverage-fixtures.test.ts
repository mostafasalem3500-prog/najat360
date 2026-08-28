import { describe, expect, it } from 'vitest';
import { createSeededRandom } from '@/lib/deterministic-random';
import {
  buildActiveIncidents,
  buildCoverageAwareRecommendationFixture,
  buildCoverageGridCells,
  buildDispatchFixtures,
  buildEntrances,
  buildH3DemandFixtures,
  buildHistoricalIncidents,
  buildLocationAnchors,
  buildLocationFixtures,
  buildUnits,
  SEED_VALUE,
} from '../../scripts/seed-demo';

async function buildFixtures() {
  const rng = createSeededRandom(SEED_VALUE);
  const usedRescueCodes = new Set<string>();
  const entrances = buildEntrances(rng);
  const units = buildUnits(rng);
  const historicalIncidents = buildHistoricalIncidents(rng, usedRescueCodes, entrances, units);
  const activeIncidents = buildActiveIncidents(rng, usedRescueCodes, entrances, units);
  const anchors = buildLocationAnchors(entrances);
  const { resolutions } = await buildLocationFixtures(activeIncidents, anchors, entrances);
  const dispatch = await buildDispatchFixtures(activeIncidents, units, entrances, resolutions);
  const dispatchedIncident = activeIncidents.find((i) => i.id === dispatch.incidentUpdate.id)!;
  dispatchedIncident.status = dispatch.incidentUpdate.status;
  dispatchedIncident.assignedUnitId = dispatch.incidentUpdate.assignedUnitId;
  dispatchedIncident.assignedEntranceId = dispatch.incidentUpdate.assignedEntranceId;
  dispatchedIncident.updatedAt = dispatch.incidentUpdate.updatedAt;

  const coverageCells = buildCoverageGridCells();
  const coverageRecommendation = await buildCoverageAwareRecommendationFixture(
    activeIncidents,
    units,
    entrances,
    resolutions,
    coverageCells
  );
  return { historicalIncidents, activeIncidents, units, coverageCells, coverageRecommendation };
}

describe('buildCoverageGridCells (C6 seed fixtures, spec 17/18/29.4)', () => {
  it('produces a non-empty grid of valid, unique H3 cells', () => {
    const cells = buildCoverageGridCells();
    expect(cells.length).toBeGreaterThan(0);
    const uniqueIndexes = new Set(cells.map((c) => c.h3Index));
    expect(uniqueIndexes.size).toBe(cells.length);
  });

  it('is deterministic across calls', () => {
    expect(buildCoverageGridCells()).toEqual(buildCoverageGridCells());
  });
});

describe('buildH3DemandFixtures', () => {
  it('produces one row per (cell, hour) with a consistent model version', async () => {
    const { historicalIncidents, coverageCells } = await buildFixtures();
    const now = new Date('2026-08-24T15:23:00.000Z');
    const predictions = buildH3DemandFixtures(historicalIncidents, now);
    expect(predictions.length).toBe(coverageCells.length * 6);
    expect(new Set(predictions.map((p) => p.modelVersion)).size).toBe(1);
  });

  it('every prediction has non-negative bounds that straddle predictedDemand', async () => {
    const { historicalIncidents } = await buildFixtures();
    const predictions = buildH3DemandFixtures(historicalIncidents, new Date('2026-08-24T15:23:00.000Z'));
    for (const p of predictions) {
      expect(p.lowerBound).toBeGreaterThanOrEqual(0);
      expect(p.lowerBound).toBeLessThanOrEqual(p.predictedDemand);
      expect(p.upperBound).toBeGreaterThanOrEqual(p.predictedDemand);
    }
  });

  it('is deterministic: the same historical dataset and `now` always produce the same predictions', async () => {
    const { historicalIncidents } = await buildFixtures();
    const now = new Date('2026-08-24T15:23:00.000Z');
    const first = buildH3DemandFixtures(historicalIncidents, now);
    const second = buildH3DemandFixtures(historicalIncidents, now);
    expect(first).toEqual(second);
  });

  it('at least one cell in the demo grid has real historical demand (the seeded incidents are not all outside the grid)', async () => {
    const { historicalIncidents } = await buildFixtures();
    const predictions = buildH3DemandFixtures(historicalIncidents, new Date('2026-08-24T15:23:00.000Z'));
    expect(predictions.some((p) => p.historicalDemand > 0)).toBe(true);
  });
});

describe('buildCoverageAwareRecommendationFixture', () => {
  it('produces an informational (not accepted/rejected) recommendation for inc-active-03', async () => {
    const { coverageRecommendation } = await buildFixtures();
    expect(coverageRecommendation.incidentId).toBe('inc-active-03');
    expect(coverageRecommendation.algorithmVersion).toBe('dispatch-score-v1');
  });

  it('reasoning includes coverage before/after tags', async () => {
    const { coverageRecommendation } = await buildFixtures();
    expect(coverageRecommendation.reasoning.some((r) => r.startsWith('COVERAGE_BEFORE:'))).toBe(true);
    expect(coverageRecommendation.reasoning.some((r) => r.startsWith('COVERAGE_AFTER:'))).toBe(true);
  });

  it('scoreBreakdown includes a coverageProtection component', async () => {
    const { coverageRecommendation } = await buildFixtures();
    expect(coverageRecommendation.scoreBreakdown).toHaveProperty('coverageProtection');
  });

  it('is deterministic across two independent builds', async () => {
    const first = await buildFixtures();
    const second = await buildFixtures();
    expect(first.coverageRecommendation.recommendedUnitId).toBe(second.coverageRecommendation.recommendedUnitId);
    expect(first.coverageRecommendation.dispatchScore).toBe(second.coverageRecommendation.dispatchScore);
  });

  it('throws a clear error when the target incident does not exist in the supplied active incidents', async () => {
    const rng = createSeededRandom(SEED_VALUE);
    const usedRescueCodes = new Set<string>();
    const entrances = buildEntrances(rng);
    const units = buildUnits(rng);
    buildHistoricalIncidents(rng, usedRescueCodes, entrances, units);
    const activeIncidents = buildActiveIncidents(rng, usedRescueCodes, entrances, units).filter((i) => i.id !== 'inc-active-03');
    await expect(
      buildCoverageAwareRecommendationFixture(activeIncidents, units, entrances, [], buildCoverageGridCells())
    ).rejects.toThrow(/no active incident/);
  });
});
