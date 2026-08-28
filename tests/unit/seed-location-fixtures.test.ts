import { describe, expect, it } from 'vitest';
import { createSeededRandom } from '@/lib/deterministic-random';
import {
  ANCHOR_COUNT,
  buildActiveIncidents,
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
  const location = await buildLocationFixtures(activeIncidents, anchors, entrances);
  return { entrances, anchors, ...location };
}

describe('buildLocationAnchors (C3 seed fixtures, spec 29.1)', () => {
  it('produces between 6 and 10 anchors (spec range)', async () => {
    const { anchors } = await buildFixtures();
    expect(ANCHOR_COUNT).toBeGreaterThanOrEqual(6);
    expect(ANCHOR_COUNT).toBeLessThanOrEqual(10);
    expect(anchors.length).toBe(ANCHOR_COUNT);
  });

  it('every anchor references an entrance that actually exists', async () => {
    const { anchors, entrances } = await buildFixtures();
    const entranceIds = new Set(entrances.map((e) => e.id));
    for (const a of anchors) {
      expect(entranceIds.has(a.entranceId)).toBe(true);
    }
  });

  it('includes both ENTRANCE and FLOOR anchor types', async () => {
    const { anchors } = await buildFixtures();
    const types = new Set(anchors.map((a) => a.anchorType));
    expect(types.has('ENTRANCE')).toBe(true);
    expect(types.has('FLOOR')).toBe(true);
  });

  it('is deterministic across two builds', async () => {
    const first = await buildFixtures();
    const second = await buildFixtures();
    expect(first.anchors).toEqual(second.anchors);
  });

  it('every anchor code is unique', async () => {
    const { anchors } = await buildFixtures();
    expect(new Set(anchors.map((a) => a.code)).size).toBe(anchors.length);
  });
});

describe('buildLocationFixtures (C3 seed fixtures, spec 29.2)', () => {
  it('produces a resolution for every scenario incident, each referencing a real primary observation', async () => {
    const { observations, resolutions } = await buildFixtures();
    const observationIds = new Set(observations.map((o) => o.id));
    expect(resolutions.length).toBeGreaterThan(0);
    for (const r of resolutions) {
      expect(observationIds.has(r.primaryObservationId)).toBe(true);
    }
  });

  it('the near-GPS scenario (inc-active-01) has no conflict', async () => {
    const { resolutions } = await buildFixtures();
    const r = resolutions.find((r) => r.incidentId === 'inc-active-01')!;
    expect(r.conflictingObservationIds).toEqual([]);
  });

  it('the far-GPS scenario (inc-active-02) surfaces a real conflict, not a silently dropped observation', async () => {
    const { observations, resolutions } = await buildFixtures();
    const r = resolutions.find((r) => r.incidentId === 'inc-active-02')!;
    expect(r.conflictingObservationIds.length).toBeGreaterThan(0);
    // The conflicting observation must still exist in the persisted set —
    // "surfaced, not dropped" per spec 29.2 rule #3.
    const observationIds = new Set(observations.map((o) => o.id));
    for (const id of r.conflictingObservationIds) {
      expect(observationIds.has(id)).toBe(true);
    }
  });

  it('every ANCHOR_QR observation carries SERVER_ANCHOR_RECORD coordinate authority', async () => {
    const { observations } = await buildFixtures();
    const anchorObs = observations.filter((o) => o.source === 'ANCHOR_QR');
    expect(anchorObs.length).toBeGreaterThan(0);
    for (const o of anchorObs) {
      expect(o.metadata.coordinateAuthority).toBe('SERVER_ANCHOR_RECORD');
    }
  });

  it('every BROWSER_GPS observation carries CALLER_DEVICE coordinate authority', async () => {
    const { observations } = await buildFixtures();
    const gpsObs = observations.filter((o) => o.source === 'BROWSER_GPS');
    expect(gpsObs.length).toBeGreaterThan(0);
    for (const o of gpsObs) {
      expect(o.metadata.coordinateAuthority).toBe('CALLER_DEVICE');
    }
  });

  it('every observation id is unique across the whole fixture set', async () => {
    const { observations } = await buildFixtures();
    expect(new Set(observations.map((o) => o.id)).size).toBe(observations.length);
  });

  it('throws a clear error for a scenario incident id that does not exist', async () => {
    const { anchors, entrances } = await buildFixtures();
    await expect(buildLocationFixtures([], anchors, entrances)).rejects.toThrow(/no active incident/);
  });
});
