import { describe, expect, it } from 'vitest';
import { LOCATION_RESOLVER_VERSION, resolveLocation, type ObservationForResolution } from '@/lib/location/resolver';

const NOW = new Date('2026-08-24T10:10:00Z');

function obs(overrides: Partial<ObservationForResolution> & Pick<ObservationForResolution, 'id' | 'source'>): ObservationForResolution {
  return {
    latitude: 24.7136,
    longitude: 46.6753,
    capturedAt: new Date('2026-08-24T10:08:00Z'),
    ...overrides,
  };
}

describe('resolveLocation', () => {
  it('throws when given zero observations', () => {
    expect(() => resolveLocation({ observations: [], now: NOW })).toThrow(/at least one observation/);
  });

  it('resolves a single observation as its own primary, with no conflict', () => {
    const result = resolveLocation({
      observations: [obs({ id: 'o1', source: 'BROWSER_GPS', horizontalAccuracyMeters: 10 })],
      now: NOW,
    });
    expect(result.primaryObservationId).toBe('o1');
    expect(result.hasConflict).toBe(false);
    expect(result.supportingObservationIds).toEqual([]);
    expect(result.conflictingObservationIds).toEqual([]);
    expect(result.algorithmVersion).toBe(LOCATION_RESOLVER_VERSION);
  });

  it('picks ANCHOR_QR as primary over BROWSER_GPS regardless of order', () => {
    const gps = obs({ id: 'gps-1', source: 'BROWSER_GPS', latitude: 24.71, longitude: 46.68 });
    const anchor = obs({ id: 'anchor-1', source: 'ANCHOR_QR', latitude: 24.7136, longitude: 46.6753 });
    const result = resolveLocation({ observations: [gps, anchor], now: NOW });
    expect(result.primaryObservationId).toBe('anchor-1');
    expect(result.reasoning).toContain('PRIMARY_SOURCE:ANCHOR_QR');
  });

  it('treats an observation within 60m as supporting, not conflicting', () => {
    const primary = obs({ id: 'p', source: 'ANCHOR_QR', latitude: 24.7136, longitude: 46.6753 });
    // ~30m north
    const near = obs({ id: 'near', source: 'BROWSER_GPS', latitude: 24.71387, longitude: 46.6753 });
    const result = resolveLocation({ observations: [primary, near], now: NOW });
    expect(result.supportingObservationIds).toEqual(['near']);
    expect(result.conflictingObservationIds).toEqual([]);
    expect(result.hasConflict).toBe(false);
  });

  it('treats an observation beyond 60m as conflicting and never drops it from the output', () => {
    const primary = obs({ id: 'p', source: 'ANCHOR_QR', latitude: 24.7136, longitude: 46.6753 });
    // ~1km away
    const far = obs({ id: 'far', source: 'BROWSER_GPS', latitude: 24.7226, longitude: 46.6753 });
    const result = resolveLocation({ observations: [primary, far], now: NOW });
    expect(result.hasConflict).toBe(true);
    expect(result.conflictingObservationIds).toEqual(['far']);
    expect(result.reasoning).toContain('SOURCE_CONFLICT:1');
  });

  it('widens uncertaintyRadiusMeters to cover a conflicting observation rather than hiding the disagreement', () => {
    const primary = obs({ id: 'p', source: 'ANCHOR_QR', latitude: 24.7136, longitude: 46.6753 });
    const far = obs({ id: 'far', source: 'BROWSER_GPS', latitude: 24.7226, longitude: 46.6753 }); // ~1km
    const result = resolveLocation({ observations: [primary, far], now: NOW });
    // ANCHOR_QR's own default accuracy is 3m — the radius must reflect the ~1km conflict, not stay at 3.
    expect(result.uncertaintyRadiusMeters).toBeGreaterThan(500);
  });

  it('selects the nearest entrance within 150m', () => {
    const primary = obs({ id: 'p', source: 'ANCHOR_QR', latitude: 24.7136, longitude: 46.6753 });
    const far = { id: 'ent-far', latitude: 24.73, longitude: 46.6753 };
    const near = { id: 'ent-near', latitude: 24.71365, longitude: 46.6753 };
    const result = resolveLocation({ observations: [primary], entrances: [far, near], now: NOW });
    expect(result.selectedEntranceId).toBe('ent-near');
    expect(result.reasoning).toContain('ENTRANCE_SELECTED:ent-near');
  });

  it('leaves selectedEntranceId undefined when no entrance is within range', () => {
    const primary = obs({ id: 'p', source: 'ANCHOR_QR' });
    const distant = { id: 'ent-1', latitude: 24.9, longitude: 46.9 };
    const result = resolveLocation({ observations: [primary], entrances: [distant], now: NOW });
    expect(result.selectedEntranceId).toBeUndefined();
    expect(result.reasoning).toContain('NO_ENTRANCE_WITHIN_RANGE');
  });

  it('takes floorLevel from the primary observation when present', () => {
    const primary = obs({ id: 'p', source: 'ANCHOR_QR', floorLevel: '3' });
    const result = resolveLocation({ observations: [primary], now: NOW });
    expect(result.floorLevel).toBe('3');
  });

  it('falls back to a supporting observation floorLevel when the primary has none', () => {
    const primary = obs({ id: 'p', source: 'ANCHOR_QR' }); // no floorLevel
    const supporting = obs({ id: 's', source: 'CALL_TAKER', floorLevel: '5', latitude: 24.71362, longitude: 46.6753 });
    const result = resolveLocation({ observations: [primary, supporting], now: NOW });
    expect(result.floorLevel).toBe('5');
  });

  it('does not pull floorLevel from a CONFLICTING observation', () => {
    const primary = obs({ id: 'p', source: 'ANCHOR_QR' }); // no floorLevel
    const conflicting = obs({ id: 'c', source: 'CALL_TAKER', floorLevel: '9', latitude: 24.73, longitude: 46.6753 });
    const result = resolveLocation({ observations: [primary, conflicting], now: NOW });
    expect(result.floorLevel).toBeUndefined();
  });

  it('scores confidence lower when there is a conflict than an otherwise-identical case with none', () => {
    const primary = obs({ id: 'p', source: 'ANCHOR_QR', horizontalAccuracyMeters: 3 });
    const supporting = obs({ id: 's', source: 'BROWSER_GPS', latitude: 24.71362, longitude: 46.6753 });
    const conflicting = obs({ id: 'c', source: 'BROWSER_GPS', latitude: 24.73, longitude: 46.6753 });

    const withConflict = resolveLocation({ observations: [primary, conflicting], now: NOW });
    const withoutConflict = resolveLocation({ observations: [primary, supporting], now: NOW });

    expect(withConflict.confidenceIndex).toBeLessThan(withoutConflict.confidenceIndex);
  });

  it('always includes the demo-heuristic road-plausibility self-label in reasoning', () => {
    const result = resolveLocation({ observations: [obs({ id: 'p', source: 'ANCHOR_QR' })], now: NOW });
    expect(result.reasoning).toContain('ROAD_PLAUSIBILITY:DEMO_HEURISTIC_NOT_LIVE_ROUTING');
  });

  it('confidenceIndex is bounded 0-100 and paired with a valid band', () => {
    const result = resolveLocation({ observations: [obs({ id: 'p', source: 'WHAT3WORDS_OPTIONAL' })], now: NOW });
    expect(result.confidenceIndex).toBeGreaterThanOrEqual(0);
    expect(result.confidenceIndex).toBeLessThanOrEqual(100);
    expect(['HIGH', 'MEDIUM', 'LOW']).toContain(result.confidenceBand);
  });

  it('scores a stale observation lower than a fresh one, all else equal', () => {
    const fresh = obs({ id: 'fresh', source: 'ANCHOR_QR', capturedAt: new Date('2026-08-24T10:09:30Z') });
    const stale = obs({ id: 'stale', source: 'ANCHOR_QR', capturedAt: new Date('2026-08-24T09:00:00Z') });
    const freshResult = resolveLocation({ observations: [fresh], now: NOW });
    const staleResult = resolveLocation({ observations: [stale], now: NOW });
    expect(staleResult.confidenceIndex).toBeLessThan(freshResult.confidenceIndex);
  });

  it('is a pure function: calling it twice with equivalent input gives an identical result', () => {
    const input = {
      observations: [obs({ id: 'p', source: 'ANCHOR_QR', floorLevel: '2' })],
      entrances: [{ id: 'e1', latitude: 24.7137, longitude: 46.6753 }],
      now: NOW,
    };
    const a = resolveLocation(input);
    const b = resolveLocation(input);
    expect(a).toEqual(b);
  });

  it('never mutates the input observations array', () => {
    const observations = [obs({ id: 'p', source: 'ANCHOR_QR' })];
    const snapshot = JSON.parse(JSON.stringify(observations));
    resolveLocation({ observations, now: NOW });
    expect(JSON.parse(JSON.stringify(observations))).toEqual(snapshot);
  });
});
