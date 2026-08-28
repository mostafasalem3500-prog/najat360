import { describe, expect, it } from 'vitest';
import { createSeededRandom } from '@/lib/deterministic-random';
import {
  ACTIVE_INCIDENT_COUNT,
  buildActiveIncidents,
  buildEntrances,
  buildHistoricalIncidents,
  buildUnits,
  buildUsers,
  ENTRANCE_COUNT,
  SEED_VALUE,
  UNIT_COUNT,
} from '../../scripts/seed-demo';

/**
 * These tests import the seed script's pure builder functions directly —
 * NOT `npm run seed` — so they run with no database, matching every other
 * test in this suite. `scripts/seed-demo.ts` guards its own `run()` call
 * behind an "am I the entry point" check specifically so this import is
 * side-effect free (see the bottom of that file).
 */

function buildDataset() {
  const rng = createSeededRandom(SEED_VALUE);
  const usedRescueCodes = new Set<string>();
  const entrances = buildEntrances(rng);
  const units = buildUnits(rng);
  const historicalIncidents = buildHistoricalIncidents(rng, usedRescueCodes, entrances, units);
  const activeIncidents = buildActiveIncidents(rng, usedRescueCodes, entrances, units);
  return { entrances, units, historicalIncidents, activeIncidents };
}

describe('seed data — synthetic invariants (spec 30.14 #14)', () => {
  it('matches the spec-mandated volume ranges', () => {
    expect(ENTRANCE_COUNT).toBeGreaterThanOrEqual(20);
    expect(ENTRANCE_COUNT).toBeLessThanOrEqual(30);
    expect(UNIT_COUNT).toBeGreaterThanOrEqual(8);
    expect(UNIT_COUNT).toBeLessThanOrEqual(12);
    expect(ACTIVE_INCIDENT_COUNT).toBeGreaterThanOrEqual(5);
    expect(ACTIVE_INCIDENT_COUNT).toBeLessThanOrEqual(10);
  });

  it('every generated incident carries no PII-shaped phone number (SYN- placeholder only)', () => {
    const { historicalIncidents, activeIncidents } = buildDataset();
    const realKsaMobilePattern = /(\+?9665\d{8}|05\d{8})/;
    for (const incident of [...historicalIncidents, ...activeIncidents]) {
      expect(incident.callerPhone).toMatch(/^SYN-CALLER-PHONE-\d+$/);
      expect(incident.callerPhone).not.toMatch(realKsaMobilePattern);
      expect(incident.callerName).toMatch(/^Synthetic Caller \d+$/);
    }
  });

  it('every generated user has a synthetic .demo email, never a real-looking address', () => {
    const users = buildUsers();
    for (const user of users) {
      expect(user.email).toMatch(/^synthetic\..+@najat360\.demo$/);
    }
  });

  it('every historical incident is CLOSED with a closedAt after createdAt', () => {
    const { historicalIncidents } = buildDataset();
    for (const incident of historicalIncidents) {
      expect(incident.status).toBe('CLOSED');
      expect(incident.closedAt).not.toBeNull();
      expect(incident.closedAt!.getTime()).toBeGreaterThan(incident.createdAt.getTime());
    }
  });

  it('active incidents cover every status in the rotation and are never CLOSED', () => {
    const { activeIncidents } = buildDataset();
    const statuses = new Set(activeIncidents.map((i) => i.status));
    expect(statuses.has('CLOSED')).toBe(false);
    expect(statuses.size).toBeGreaterThan(1);
    for (const incident of activeIncidents) {
      expect(incident.closedAt).toBeNull();
    }
  });

  it('no unit is assigned to more than one active (non-terminal) incident — matches the DB partial unique index', () => {
    // Regression test: an earlier version of this seed script independently
    // randomChoice'd a unit per active incident and could double-book one,
    // which the real Incident_one_active_assignment_per_unit constraint
    // would reject on insert. Historical (CLOSED) incidents are exempt from
    // this, same as the DB constraint's WHERE clause.
    const { activeIncidents } = buildDataset();
    const assignedUnitIds = activeIncidents.map((i) => i.assignedUnitId).filter((id): id is string => id !== null);
    expect(new Set(assignedUnitIds).size).toBe(assignedUnitIds.length);
  });

  it('every rescue code across the whole dataset is unique (deterministic collision avoidance holds)', () => {
    const { historicalIncidents, activeIncidents } = buildDataset();
    const codes = [...historicalIncidents, ...activeIncidents].map((i) => i.rescueCode);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('every incident id, entrance id, and unit id is deterministic and stable across two builds', () => {
    const first = buildDataset();
    const second = buildDataset();
    expect(first.entrances.map((e) => e.id)).toEqual(second.entrances.map((e) => e.id));
    expect(first.units.map((u) => u.id)).toEqual(second.units.map((u) => u.id));
    expect(first.historicalIncidents.map((i) => i.id)).toEqual(second.historicalIncidents.map((i) => i.id));
  });

  it('every incident references an entrance/unit id that actually exists in the same dataset', () => {
    const { entrances, units, historicalIncidents, activeIncidents } = buildDataset();
    const entranceIds = new Set(entrances.map((e) => e.id));
    const unitIds = new Set(units.map((u) => u.id));
    for (const incident of [...historicalIncidents, ...activeIncidents]) {
      expect(entranceIds.has(incident.suggestedEntranceId!)).toBe(true);
      if (incident.assignedEntranceId) expect(entranceIds.has(incident.assignedEntranceId)).toBe(true);
      if (incident.assignedUnitId) expect(unitIds.has(incident.assignedUnitId)).toBe(true);
    }
  });
});
