import { describe, expect, it } from 'vitest';
import { createSeededRandom } from '@/lib/deterministic-random';
import { ALLOWLIST } from '@/lib/assisted-capture/allowlist';
import {
  buildActiveIncidents,
  buildAssistedCaptureFixtures,
  buildEntrances,
  buildHistoricalIncidents,
  buildUnits,
  SEED_VALUE,
} from '../../scripts/seed-demo';

/**
 * Mirrors seed-synthetic.test.ts's pattern: import the seed script's pure
 * builder functions directly, no database. `buildAssistedCaptureFixtures`
 * is async (it genuinely runs MockAssistedCaptureProvider) but still has
 * zero I/O — no DB, no network, no timers.
 */
async function buildFixtures() {
  const rng = createSeededRandom(SEED_VALUE);
  const usedRescueCodes = new Set<string>();
  const entrances = buildEntrances(rng);
  const units = buildUnits(rng);
  buildHistoricalIncidents(rng, usedRescueCodes, entrances, units); // advances rng identically to run()
  const activeIncidents = buildActiveIncidents(rng, usedRescueCodes, entrances, units);
  return buildAssistedCaptureFixtures(activeIncidents);
}

describe('buildAssistedCaptureFixtures (C2 seed fixtures)', () => {
  it('is deterministic across two builds, except timestamps (which derive from real Date.now() via the underlying incidents\' createdAt — same caveat this module\'s header docstring already notes for historical/active incidents)', async () => {
    const stripTimestamps = (v: unknown) =>
      JSON.parse(
        JSON.stringify(v, (key, val) =>
          key === 'createdAt' || key === 'expiresAt' || key === 'reviewedAt' ? '<timestamp>' : val
        )
      );
    const first = await buildFixtures();
    const second = await buildFixtures();
    expect(stripTimestamps(first)).toEqual(stripTimestamps(second));
  });

  it('covers all four DraftStatus values across the fixture set', async () => {
    const { drafts } = await buildFixtures();
    const statuses = new Set(drafts.map((d) => d.status));
    expect(statuses).toEqual(new Set(['DRAFT', 'PARTIALLY_CONFIRMED', 'CONFIRMED', 'REJECTED']));
  });

  it('covers all four SuggestionStatus values across the fixture set', async () => {
    const { suggestions } = await buildFixtures();
    const statuses = new Set(suggestions.map((s) => s.status));
    expect(statuses).toEqual(new Set(['PENDING', 'ACCEPTED', 'EDITED', 'REJECTED']));
  });

  it('every suggestion names a field that is actually in ALLOWLIST', async () => {
    const { suggestions } = await buildFixtures();
    for (const s of suggestions) {
      expect(ALLOWLIST).toContain(s.fieldName);
    }
  });

  it('every suggestion references a draft that actually exists in the same fixture set', async () => {
    const { drafts, suggestions } = await buildFixtures();
    const draftIds = new Set(drafts.map((d) => d.id));
    for (const s of suggestions) {
      expect(draftIds.has(s.draftId)).toBe(true);
    }
  });

  it('a REJECTED suggestion always has finalValue null and no PENDING suggestion has a reviewer', async () => {
    const { suggestions } = await buildFixtures();
    for (const s of suggestions) {
      if (s.status === 'REJECTED') {
        expect(s.finalValue).toBeNull();
      }
      if (s.status === 'PENDING') {
        expect(s.reviewedById).toBeNull();
        expect(s.reviewedAt).toBeNull();
        expect(s.finalValue).toBeNull();
      } else {
        expect(s.reviewedById).not.toBeNull();
        expect(s.reviewedAt).not.toBeNull();
      }
    }
  });

  it('an EDITED suggestion keeps both the original suggestedValue and the reviewer finalValue, and they differ', async () => {
    const { suggestions } = await buildFixtures();
    const edited = suggestions.filter((s) => s.status === 'EDITED');
    expect(edited.length).toBeGreaterThan(0);
    for (const s of edited) {
      expect(s.finalValue).not.toBeNull();
      expect(s.finalValue).not.toEqual(s.suggestedValue);
    }
  });

  it('an ACCEPTED suggestion carries a finalValue equal to its suggestedValue', async () => {
    const { suggestions } = await buildFixtures();
    const accepted = suggestions.filter((s) => s.status === 'ACCEPTED');
    expect(accepted.length).toBeGreaterThan(0);
    for (const s of accepted) {
      expect(s.finalValue).toEqual(s.suggestedValue);
    }
  });

  it('every draft expiresAt is after its createdAt', async () => {
    const { drafts } = await buildFixtures();
    for (const d of drafts) {
      expect(d.expiresAt.getTime()).toBeGreaterThan(d.createdAt.getTime());
    }
  });

  it('throws a clear error if a scenario references an incident id that does not exist in the active set', async () => {
    await expect(buildAssistedCaptureFixtures([])).rejects.toThrow(/no active incident/);
  });
});
