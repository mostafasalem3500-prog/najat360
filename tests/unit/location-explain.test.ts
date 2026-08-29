import { describe, expect, it } from 'vitest';
import { explainLocationResolution } from '@/lib/location/explain';

describe('explainLocationResolution', () => {
  it('always includes a confidence-band + source line', () => {
    const lines = explainLocationResolution({
      confidenceBand: 'HIGH',
      confidenceIndex: 92,
      primarySource: 'ANCHOR_QR',
      hasConflict: false,
      conflictingCount: 0,
      isStale: false,
      ageMinutes: 1,
      hasEntrance: true,
    });
    expect(lines[0]).toContain('92');
    expect(lines[0]).toContain('مرتفعة');
    expect(lines.some((l) => l.includes('لا يوجد تعارض'))).toBe(true);
  });

  it('adds a conflict line with the distance when hasConflict is true', () => {
    const lines = explainLocationResolution({
      confidenceBand: 'MEDIUM',
      confidenceIndex: 65,
      primarySource: 'BROWSER_GPS',
      hasConflict: true,
      conflictingCount: 1,
      maxConflictDistanceMeters: 85,
      isStale: false,
      ageMinutes: 2,
      hasEntrance: true,
    });
    const conflictLine = lines.find((l) => l.includes('تعارض'));
    expect(conflictLine).toBeDefined();
    expect(conflictLine).toContain('85');
  });

  it('adds a staleness line only when isStale is true', () => {
    const stale = explainLocationResolution({
      confidenceBand: 'LOW',
      confidenceIndex: 40,
      primarySource: 'CALL_TAKER',
      hasConflict: false,
      conflictingCount: 0,
      isStale: true,
      ageMinutes: 22,
      hasEntrance: false,
    });
    expect(stale.some((l) => l.includes('22 دقيقة'))).toBe(true);

    const fresh = explainLocationResolution({
      confidenceBand: 'LOW',
      confidenceIndex: 40,
      primarySource: 'CALL_TAKER',
      hasConflict: false,
      conflictingCount: 0,
      isStale: false,
      ageMinutes: 3,
      hasEntrance: false,
    });
    expect(fresh.some((l) => l.includes('دقيقة'))).toBe(false);
  });

  it('adds a no-entrance line only when hasEntrance is false', () => {
    const noEntrance = explainLocationResolution({
      confidenceBand: 'HIGH',
      confidenceIndex: 90,
      primarySource: 'ANCHOR_QR',
      hasConflict: false,
      conflictingCount: 0,
      isStale: false,
      ageMinutes: 1,
      hasEntrance: false,
    });
    expect(noEntrance.some((l) => l.includes('مدخل مبنى'))).toBe(true);

    const withEntrance = explainLocationResolution({
      confidenceBand: 'HIGH',
      confidenceIndex: 90,
      primarySource: 'ANCHOR_QR',
      hasConflict: false,
      conflictingCount: 0,
      isStale: false,
      ageMinutes: 1,
      hasEntrance: true,
    });
    expect(withEntrance.some((l) => l.includes('مدخل مبنى'))).toBe(false);
  });
});
