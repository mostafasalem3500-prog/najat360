import { describe, expect, it } from 'vitest';
import { CONFIDENCE_VERSION, computeLocationConfidence } from '@/lib/confidence';

describe('confidence — Location Confidence Index', () => {
  it('an all-100 input scores 100 and bands HIGH', () => {
    const result = computeLocationConfidence({
      gpsAccuracy: 100,
      roadPlausibility: 100,
      entranceProximity: 100,
      callerConfirmation: 100,
      landmarkEvidence: 100,
      dataFreshness: 100,
    });
    expect(result.score).toBe(100);
    expect(result.band).toBe('HIGH');
    expect(result.version).toBe(CONFIDENCE_VERSION);
  });

  it('an all-0 input scores 0 and bands LOW', () => {
    const result = computeLocationConfidence({
      gpsAccuracy: 0,
      roadPlausibility: 0,
      entranceProximity: 0,
      callerConfirmation: 0,
      landmarkEvidence: 0,
      dataFreshness: 0,
    });
    expect(result.score).toBe(0);
    expect(result.band).toBe('LOW');
  });

  it('clamps out-of-range component inputs instead of producing an out-of-bounds score', () => {
    const result = computeLocationConfidence({
      gpsAccuracy: 500,
      roadPlausibility: -50,
      entranceProximity: 100,
      callerConfirmation: 100,
      landmarkEvidence: 100,
      dataFreshness: 100,
    });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('treats a non-finite component as 0 rather than propagating NaN', () => {
    const result = computeLocationConfidence({
      gpsAccuracy: Number.NaN,
      roadPlausibility: 80,
      entranceProximity: 80,
      callerConfirmation: 80,
      dataFreshness: 80,
    });
    expect(Number.isFinite(result.score)).toBe(true);
  });

  it('applies the spec-mandated weights when landmark evidence is present', () => {
    // GPS dominant test: only gpsAccuracy is non-zero at 100 -> contributes exactly its weight * 100.
    const result = computeLocationConfidence({
      gpsAccuracy: 100,
      roadPlausibility: 0,
      entranceProximity: 0,
      callerConfirmation: 0,
      landmarkEvidence: 0,
      dataFreshness: 0,
    });
    expect(result.score).toBe(35); // 0.35 * 100
    expect(result.breakdown.gpsAccuracy).toBeCloseTo(35, 5);
  });

  it('redistributes the landmark weight proportionally when landmarkEvidence is omitted', () => {
    const withoutLandmark = computeLocationConfidence({
      gpsAccuracy: 100,
      roadPlausibility: 100,
      entranceProximity: 100,
      callerConfirmation: 100,
      dataFreshness: 100,
    });
    // No component is below 100 and landmark's weight is redistributed among
    // the rest, whose weights still sum to 1 -> total is still 100, not 95.
    expect(withoutLandmark.score).toBe(100);
    expect(withoutLandmark.breakdown.landmarkEvidence).toBe(0);
  });

  it('bands: 80-100 HIGH, 60-79 MEDIUM, below 60 LOW (boundary values)', () => {
    const makeUniform = (v: number) =>
      computeLocationConfidence({
        gpsAccuracy: v,
        roadPlausibility: v,
        entranceProximity: v,
        callerConfirmation: v,
        landmarkEvidence: v,
        dataFreshness: v,
      });

    expect(makeUniform(80).band).toBe('HIGH');
    expect(makeUniform(79).band).toBe('MEDIUM');
    expect(makeUniform(60).band).toBe('MEDIUM');
    expect(makeUniform(59).band).toBe('LOW');
  });

  it('the breakdown components sum to (approximately) the final score', () => {
    const result = computeLocationConfidence({
      gpsAccuracy: 90,
      roadPlausibility: 70,
      entranceProximity: 65,
      callerConfirmation: 50,
      landmarkEvidence: 40,
      dataFreshness: 100,
    });
    const sum = Object.values(result.breakdown).reduce((a, b) => a + b, 0);
    expect(Math.round(sum)).toBe(result.score);
  });
});
