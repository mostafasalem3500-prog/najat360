import { describe, expect, it } from 'vitest';
import { createSeededRandom } from '@/lib/deterministic-random';
import {
  buildActiveIncidents,
  buildDispatchFixtures,
  buildEntrances,
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
  buildHistoricalIncidents(rng, usedRescueCodes, entrances, units);
  const activeIncidents = buildActiveIncidents(rng, usedRescueCodes, entrances, units);
  const anchors = buildLocationAnchors(entrances);
  const { resolutions } = await buildLocationFixtures(activeIncidents, anchors, entrances);
  const dispatch = await buildDispatchFixtures(activeIncidents, units, entrances, resolutions);
  return { entrances, units, activeIncidents, resolutions, dispatch };
}

describe('buildDispatchFixtures (C4 seed fixtures, spec 15/16)', () => {
  it('targets inc-active-03 (the READY_FOR_DECISION active incident) and produces a DISPATCHED update', async () => {
    const { dispatch } = await buildFixtures();
    expect(dispatch.incidentUpdate.id).toBe('inc-active-03');
    expect(dispatch.incidentUpdate.status).toBe('DISPATCHED');
    expect(dispatch.incidentUpdate.assignedUnitId).toBeTruthy();
    expect(dispatch.incidentUpdate.assignedEntranceId).toBeTruthy();
  });

  it('produces one RouteSnapshot per (unit, entrance) candidate considered, not just the winner', async () => {
    const { dispatch } = await buildFixtures();
    expect(dispatch.routeSnapshots.length).toBeGreaterThan(1);
    const pairs = new Set(dispatch.routeSnapshots.map((r) => `${r.unitId}:${r.entranceId}`));
    expect(pairs.size).toBe(dispatch.routeSnapshots.length); // no duplicate pairs
  });

  it('every RouteSnapshot references a real unit and entrance from the seed data', async () => {
    const { dispatch, units, entrances } = await buildFixtures();
    const unitIds = new Set(units.map((u) => u.id));
    const entranceIds = new Set(entrances.map((e) => e.id));
    for (const rs of dispatch.routeSnapshots) {
      expect(unitIds.has(rs.unitId)).toBe(true);
      expect(entranceIds.has(rs.entranceId)).toBe(true);
    }
  });

  it('every RouteSnapshot is tagged providerMode MOCK (no live routing provider this phase)', async () => {
    const { dispatch } = await buildFixtures();
    for (const rs of dispatch.routeSnapshots) {
      expect(rs.providerMode).toBe('MOCK');
    }
  });

  it('the Recommendation row references the same unit/entrance the incident update assigns', async () => {
    const { dispatch } = await buildFixtures();
    expect(dispatch.recommendation.recommendedUnitId).toBe(dispatch.incidentUpdate.assignedUnitId);
    expect(dispatch.recommendation.recommendedEntranceId).toBe(dispatch.incidentUpdate.assignedEntranceId);
  });

  it('the Recommendation is marked accepted (acceptedById/acceptedAt set), not rejected', async () => {
    const { dispatch } = await buildFixtures();
    expect(dispatch.recommendation.acceptedById).toBeTruthy();
    expect(dispatch.recommendation.acceptedAt).not.toBeNull();
    expect(dispatch.recommendation.rejectedAt).toBeNull();
    expect(dispatch.recommendation.overrideReason).toBeNull();
  });

  it('the Recommendation carries a real per-component score breakdown matching the recommended pair', async () => {
    const { dispatch } = await buildFixtures();
    const matchingSnapshot = dispatch.routeSnapshots.find(
      (rs) => rs.unitId === dispatch.recommendation.recommendedUnitId && rs.entranceId === dispatch.recommendation.recommendedEntranceId
    );
    expect(matchingSnapshot).toBeDefined();
    expect(Object.keys(dispatch.recommendation.scoreBreakdown).sort()).toEqual(
      ['dataFreshness', 'entranceAccessibility', 'etaScore', 'locationConfidence', 'unitReadiness'].sort()
    );
  });

  it('uses the real algorithm version from the Access Score module, not a hardcoded string', async () => {
    const { dispatch } = await buildFixtures();
    expect(dispatch.recommendation.algorithmVersion).toBe('access-score-v1');
  });

  it('only recommends AVAILABLE units not already assigned to another active incident', async () => {
    const { dispatch, activeIncidents, units } = await buildFixtures();
    const otherAssignedUnitIds = new Set(
      activeIncidents.filter((i) => i.id !== 'inc-active-03' && i.assignedUnitId).map((i) => i.assignedUnitId!)
    );
    expect(otherAssignedUnitIds.has(dispatch.recommendation.recommendedUnitId)).toBe(false);
    const unit = units.find((u) => u.id === dispatch.recommendation.recommendedUnitId);
    expect(unit?.status).toBe('AVAILABLE');
  });

  it('throws a clear error when the target incident is missing', async () => {
    await expect(buildDispatchFixtures([], [], [], [])).rejects.toThrow(/no active incident/);
  });

  it('is deterministic across two builds (content, not wall-clock-derived timestamps)', async () => {
    // dataFreshnessAt/createdAt-derived fields are NOT expected to be
    // byte-identical across builds — they anchor to Date.now() at build
    // time, same pre-existing, documented exception as
    // buildAssistedCaptureFixtures()/buildLocationFixtures() (see
    // seed-demo.ts's module docstring). Strip them before comparing, same
    // pattern as tests/unit/seed-assisted-capture-fixtures.test.ts.
    const stripTimestamps = (value: unknown) =>
      JSON.parse(JSON.stringify(value, (key, v) => (key === 'dataFreshnessAt' ? '<stripped>' : v)));

    const first = await buildFixtures();
    const second = await buildFixtures();
    expect(first.dispatch.recommendation.recommendedUnitId).toBe(second.dispatch.recommendation.recommendedUnitId);
    expect(first.dispatch.recommendation.recommendedEntranceId).toBe(second.dispatch.recommendation.recommendedEntranceId);
    expect(first.dispatch.recommendation.accessScore).toBe(second.dispatch.recommendation.accessScore);
    expect(stripTimestamps(first.dispatch.routeSnapshots)).toEqual(stripTimestamps(second.dispatch.routeSnapshots));
  });
});
