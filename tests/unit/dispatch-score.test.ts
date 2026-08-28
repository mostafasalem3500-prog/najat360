import { describe, expect, it } from 'vitest';
import { computeDispatchScore, DISPATCH_SCORE_VERSION } from '@/lib/dispatch/dispatch-score';

describe('computeDispatchScore', () => {
  it('all components at 100 yields a score of 100', () => {
    const result = computeDispatchScore({
      etaScore: 100,
      entranceAccessibility: 100,
      unitReadiness: 100,
      locationConfidence: 100,
      coverageProtection: 100,
    });
    expect(result.score).toBe(100);
    expect(result.version).toBe(DISPATCH_SCORE_VERSION);
  });

  it('all components at 0 yields a score of 0', () => {
    const result = computeDispatchScore({
      etaScore: 0,
      entranceAccessibility: 0,
      unitReadiness: 0,
      locationConfidence: 0,
      coverageProtection: 0,
    });
    expect(result.score).toBe(0);
  });

  it('applies the spec 29.4-exact weights: 0.40/0.20/0.15/0.10/0.15', () => {
    const eta = computeDispatchScore({ etaScore: 100, entranceAccessibility: 0, unitReadiness: 0, locationConfidence: 0, coverageProtection: 0 });
    expect(eta.score).toBe(40);
    const entrance = computeDispatchScore({ etaScore: 0, entranceAccessibility: 100, unitReadiness: 0, locationConfidence: 0, coverageProtection: 0 });
    expect(entrance.score).toBe(20);
    const readiness = computeDispatchScore({ etaScore: 0, entranceAccessibility: 0, unitReadiness: 100, locationConfidence: 0, coverageProtection: 0 });
    expect(readiness.score).toBe(15);
    const confidence = computeDispatchScore({ etaScore: 0, entranceAccessibility: 0, unitReadiness: 0, locationConfidence: 100, coverageProtection: 0 });
    expect(confidence.score).toBe(10);
    const coverage = computeDispatchScore({ etaScore: 0, entranceAccessibility: 0, unitReadiness: 0, locationConfidence: 0, coverageProtection: 100 });
    expect(coverage.score).toBe(15);
  });

  it('differs from Access Score specifically in locationConfidence (0.10 not 0.15) and swaps dataFreshness for coverageProtection (0.15)', () => {
    // Pin the two documented deltas from access-score.ts's weights directly,
    // so a future accidental copy-paste of Access Score's weights fails loudly.
    const confidence = computeDispatchScore({ etaScore: 0, entranceAccessibility: 0, unitReadiness: 0, locationConfidence: 100, coverageProtection: 0 });
    expect(confidence.score).not.toBe(15); // would be 15 under Access Score's weights
    expect(confidence.score).toBe(10);
  });

  it('clamps out-of-range components instead of propagating garbage', () => {
    const result = computeDispatchScore({
      etaScore: 150,
      entranceAccessibility: -50,
      unitReadiness: 100,
      locationConfidence: 100,
      coverageProtection: 100,
    });
    expect(result.breakdown.etaScore).toBe(40);
    expect(result.breakdown.entranceAccessibility).toBe(0);
  });

  it('treats NaN/non-finite components as 0 rather than throwing', () => {
    const result = computeDispatchScore({
      etaScore: NaN,
      entranceAccessibility: 100,
      unitReadiness: 100,
      locationConfidence: 100,
      coverageProtection: 100,
    });
    expect(result.breakdown.etaScore).toBe(0);
    expect(Number.isFinite(result.score)).toBe(true);
  });

  it('returns a full breakdown keyed by every component', () => {
    const result = computeDispatchScore({
      etaScore: 80,
      entranceAccessibility: 60,
      unitReadiness: 70,
      locationConfidence: 90,
      coverageProtection: 50,
    });
    expect(Object.keys(result.breakdown).sort()).toEqual(
      ['coverageProtection', 'entranceAccessibility', 'etaScore', 'locationConfidence', 'unitReadiness'].sort()
    );
  });

  it('is a pure function: does not mutate its input', () => {
    const input = { etaScore: 80, entranceAccessibility: 60, unitReadiness: 70, locationConfidence: 90, coverageProtection: 50 };
    const snapshot = { ...input };
    computeDispatchScore(input);
    expect(input).toEqual(snapshot);
  });
});
