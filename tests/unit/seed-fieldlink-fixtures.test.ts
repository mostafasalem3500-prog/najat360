import { describe, expect, it } from 'vitest';
import { createSeededRandom } from '@/lib/deterministic-random';
import {
  buildActiveIncidents,
  buildDispatchFixtures,
  buildEntrances,
  buildFieldLinkFixtures,
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
  const dispatchedIncident = activeIncidents.find((i) => i.id === dispatch.incidentUpdate.id)!;
  dispatchedIncident.status = dispatch.incidentUpdate.status;
  dispatchedIncident.assignedUnitId = dispatch.incidentUpdate.assignedUnitId;
  dispatchedIncident.assignedEntranceId = dispatch.incidentUpdate.assignedEntranceId;
  dispatchedIncident.updatedAt = dispatch.incidentUpdate.updatedAt;
  const fieldLink = await buildFieldLinkFixtures(activeIncidents);
  return { activeIncidents, dispatch, fieldLink };
}

describe('buildFieldLinkFixtures (C5 seed fixtures, spec 30.5/30.14 #6)', () => {
  it('carries inc-active-03 from DISPATCHED all the way to CLOSED', async () => {
    const { fieldLink } = await buildFixtures();
    expect(fieldLink.incidentUpdate.id).toBe('inc-active-03');
    expect(fieldLink.incidentUpdate.status).toBe('CLOSED');
    expect(fieldLink.incidentUpdate.closedAt).not.toBeNull();
  });

  it('produces the full 5-action sequence in order', async () => {
    const { fieldLink } = await buildFixtures();
    expect(fieldLink.fieldActions.map((a) => a.actionType)).toEqual([
      'ACCEPT_TASK',
      'START_MOVING',
      'AT_ACCESS_POINT',
      'ON_SCENE',
      'CLOSE_TASK',
    ]);
  });

  it('every action is attributed to the medic assigned to the winning C4 unit', async () => {
    const { dispatch, fieldLink } = await buildFixtures();
    for (const a of fieldLink.fieldActions) {
      expect(a.unitId).toBe(dispatch.recommendation.recommendedUnitId);
      expect(a.actorId).toBe('user-medic');
    }
  });

  it('every action has a unique idempotency key', async () => {
    const { fieldLink } = await buildFixtures();
    const keys = fieldLink.fieldActions.map((a) => a.idempotencyKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('status-changing actions record accurate previous/resulting status pairs; log-only actions record null resultingStatus', async () => {
    const { fieldLink } = await buildFixtures();
    const byType = Object.fromEntries(fieldLink.fieldActions.map((a) => [a.actionType, a]));
    expect(byType.ACCEPT_TASK!.resultingStatus).toBeNull();
    expect(byType.START_MOVING!.previousStatus).toBe('DISPATCHED');
    expect(byType.START_MOVING!.resultingStatus).toBe('EN_ROUTE');
    expect(byType.AT_ACCESS_POINT!.previousStatus).toBe('EN_ROUTE');
    expect(byType.ON_SCENE!.previousStatus).toBe('AT_ACCESS_POINT');
    expect(byType.CLOSE_TASK!.previousStatus).toBe('ON_SCENE');
    expect(byType.CLOSE_TASK!.resultingStatus).toBe('CLOSED');
  });

  it('actions are timestamped in strictly increasing order', async () => {
    const { fieldLink } = await buildFixtures();
    for (let i = 1; i < fieldLink.fieldActions.length; i++) {
      expect(fieldLink.fieldActions[i]!.submittedAt.getTime()).toBeGreaterThan(fieldLink.fieldActions[i - 1]!.submittedAt.getTime());
    }
  });

  it('throws a clear error when the target incident has not been dispatched yet', async () => {
    const rng = createSeededRandom(SEED_VALUE);
    const usedRescueCodes = new Set<string>();
    const entrances = buildEntrances(rng);
    const units = buildUnits(rng);
    buildHistoricalIncidents(rng, usedRescueCodes, entrances, units);
    const activeIncidents = buildActiveIncidents(rng, usedRescueCodes, entrances, units); // inc-active-03 still READY_FOR_DECISION here
    await expect(buildFieldLinkFixtures(activeIncidents)).rejects.toThrow(/must be DISPATCHED/);
  });

  it('is deterministic across two builds (content, not wall-clock-derived fields)', async () => {
    const first = await buildFixtures();
    const second = await buildFixtures();
    expect(first.fieldLink.fieldActions.map((a) => a.actionType)).toEqual(second.fieldLink.fieldActions.map((a) => a.actionType));
    expect(first.fieldLink.incidentUpdate.status).toBe(second.fieldLink.incidentUpdate.status);
  });
});
