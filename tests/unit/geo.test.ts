import { describe, expect, it } from 'vitest';
import { haversineDistanceMeters } from '@/lib/geo';

describe('haversineDistanceMeters', () => {
  it('is zero for the same point', () => {
    expect(haversineDistanceMeters({ latitude: 24.7, longitude: 46.7 }, { latitude: 24.7, longitude: 46.7 })).toBe(0);
  });

  it('is symmetric', () => {
    const a = { latitude: 24.7136, longitude: 46.6753 };
    const b = { latitude: 24.72, longitude: 46.68 };
    expect(haversineDistanceMeters(a, b)).toBeCloseTo(haversineDistanceMeters(b, a), 6);
  });

  it('approximates 111.32km for one degree of latitude', () => {
    const distance = haversineDistanceMeters({ latitude: 24.0, longitude: 46.0 }, { latitude: 25.0, longitude: 46.0 });
    expect(distance).toBeGreaterThan(110_500);
    expect(distance).toBeLessThan(112_000);
  });

  it('gives a small, sane distance for two nearby points (~100m apart)', () => {
    // ~0.0009 degrees latitude ≈ 100m
    const distance = haversineDistanceMeters({ latitude: 24.7, longitude: 46.7 }, { latitude: 24.7009, longitude: 46.7 });
    expect(distance).toBeGreaterThan(90);
    expect(distance).toBeLessThan(110);
  });
});
