import { describe, expect, it } from 'vitest';
import { computeAccessScore, etaSecondsToScore, dataAgeToFreshnessScore, ACCESS_SCORE_VERSION } from '@/lib/dispatch/access-score';

describe('computeAccessScore', () => {
  it('all components at 100 yields a score of 100', () => {
    const result = computeAccessScore({
      etaScore: 100,
      entranceAccessibility: 100,
      locationConfidence: 100,
      unitReadiness: 100,
      dataFreshness: 100,
    });
    expect(result.score).toBe(100);
    expect(result.version).toBe(ACCESS_SCORE_VERSION);
  });

  it('all components at 0 yields a score of 0', () => {
    const result = computeAccessScore({
      etaScore: 0,
      entranceAccessibility: 0,
      locationConfidence: 0,
      unitReadiness: 0,
      dataFreshness: 0,
    });
    expect(result.score).toBe(0);
  });

  it('applies the spec-exact weights: 0.40/0.20/0.15/0.15/0.10', () => {
    // Isolate each weight by setting only that component to 100, rest to 0.
    const eta = computeAccessScore({ etaScore: 100, entranceAccessibility: 0, locationConfidence: 0, unitReadiness: 0, dataFreshness: 0 });
    expect(eta.score).toBe(40);
    const entrance = computeAccessScore({ etaScore: 0, entranceAccessibility: 100, locationConfidence: 0, unitReadiness: 0, dataFreshness: 0 });
    expect(entrance.score).toBe(20);
    const confidence = computeAccessScore({ etaScore: 0, entranceAccessibility: 0, locationConfidence: 100, unitReadiness: 0, dataFreshness: 0 });
    expect(confidence.score).toBe(15);
    const readiness = computeAccessScore({ etaScore: 0, entranceAccessibility: 0, locationConfidence: 0, unitReadiness: 100, dataFreshness: 0 });
    expect(readiness.score).toBe(15);
    const freshness = computeAccessScore({ etaScore: 0, entranceAccessibility: 0, locationConfidence: 0, unitReadiness: 0, dataFreshness: 100 });
    expect(freshness.score).toBe(10);
  });

  it('clamps out-of-range components instead of propagating garbage', () => {
    const result = computeAccessScore({
      etaScore: 150,
      entranceAccessibility: -50,
      locationConfidence: 100,
      unitReadiness: 100,
      dataFreshness: 100,
    });
    expect(result.breakdown.etaScore).toBe(40); // clamped to 100 * 0.4
    expect(result.breakdown.entranceAccessibility).toBe(0); // clamped to 0
  });

  it('treats NaN/non-finite components as 0 rather than throwing', () => {
    const result = computeAccessScore({
      etaScore: NaN,
      entranceAccessibility: 100,
      locationConfidence: 100,
      unitReadiness: 100,
      dataFreshness: 100,
    });
    expect(result.breakdown.etaScore).toBe(0);
    expect(Number.isFinite(result.score)).toBe(true);
  });

  it('returns a full breakdown keyed by every component', () => {
    const result = computeAccessScore({
      etaScore: 80,
      entranceAccessibility: 60,
      locationConfidence: 90,
      unitReadiness: 70,
      dataFreshness: 50,
    });
    expect(Object.keys(result.breakdown).sort()).toEqual(
      ['dataFreshness', 'entranceAccessibility', 'etaScore', 'locationConfidence', 'unitReadiness'].sort()
    );
  });

  it('is a pure function: does not mutate its input', () => {
    const input = { etaScore: 80, entranceAccessibility: 60, locationConfidence: 90, unitReadiness: 70, dataFreshness: 50 };
    const snapshot = { ...input };
    computeAccessScore(input);
    expect(input).toEqual(snapshot);
  });
});

describe('etaSecondsToScore', () => {
  it('0 seconds scores 100', () => {
    expect(etaSecondsToScore(0)).toBe(100);
  });

  it('scores 0 at the worst-seconds threshold and beyond', () => {
    expect(etaSecondsToScore(900)).toBe(0);
    expect(etaSecondsToScore(2000)).toBe(0);
  });

  it('is linear at the midpoint', () => {
    expect(etaSecondsToScore(450, 900)).toBe(50);
  });

  it('clamps negative durations to the 0s case', () => {
    expect(etaSecondsToScore(-100)).toBe(100);
  });

  it('respects a custom worstSeconds', () => {
    expect(etaSecondsToScore(300, 600)).toBe(50);
  });
});

describe('dataAgeToFreshnessScore', () => {
  it('scores 100 at or under 1 minute old', () => {
    expect(dataAgeToFreshnessScore(0)).toBe(100);
    expect(dataAgeToFreshnessScore(60_000)).toBe(100);
  });

  it('scores 0 at or beyond 10 minutes old', () => {
    expect(dataAgeToFreshnessScore(10 * 60_000)).toBe(0);
    expect(dataAgeToFreshnessScore(60 * 60_000)).toBe(0);
  });

  it('is linear at the midpoint (5.5 minutes)', () => {
    expect(dataAgeToFreshnessScore(5.5 * 60_000)).toBe(50);
  });

  it('is a strictly tighter window than the location resolver freshness window', () => {
    // access-score treats a 5-minute-old value as already meaningfully decayed...
    const accessScoreAt5Min = dataAgeToFreshnessScore(5 * 60_000);
    // ...whereas resolver.ts's own freshness window (2-30min) would barely have moved yet.
    // This test just pins the documented asymmetry: access-score decays much faster.
    expect(accessScoreAt5Min).toBeLessThan(60);
  });
});
