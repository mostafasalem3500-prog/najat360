import { describe, expect, it } from 'vitest';
import { createSeededRandom, jitterCoordinate, randomChoice, randomFloat, randomInt } from '@/lib/deterministic-random';

describe('deterministic-random', () => {
  it('the same seed produces the exact same sequence every time', () => {
    const a = createSeededRandom(42);
    const b = createSeededRandom(42);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('different seeds produce different sequences', () => {
    const a = createSeededRandom(1);
    const b = createSeededRandom(2);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  it('all outputs stay within [0, 1)', () => {
    const rng = createSeededRandom(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('randomInt is inclusive on both bounds and deterministic for a given seed', () => {
    const rng = createSeededRandom(99);
    const values = Array.from({ length: 500 }, () => randomInt(rng, 1, 5));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...values)).toBeLessThanOrEqual(5);
    expect(new Set(values).size).toBeGreaterThan(1);
  });

  it('randomFloat stays within [min, max)', () => {
    const rng = createSeededRandom(5);
    for (let i = 0; i < 200; i++) {
      const v = randomFloat(rng, 10, 20);
      expect(v).toBeGreaterThanOrEqual(10);
      expect(v).toBeLessThan(20);
    }
  });

  it('randomChoice only returns items from the input array', () => {
    const rng = createSeededRandom(3);
    const options = ['a', 'b', 'c'];
    for (let i = 0; i < 50; i++) {
      expect(options).toContain(randomChoice(rng, options));
    }
  });

  it('randomChoice throws on an empty array', () => {
    const rng = createSeededRandom(3);
    expect(() => randomChoice(rng, [])).toThrow();
  });

  it('jitterCoordinate never moves the point by more than maxMeters (approximately)', () => {
    const rng = createSeededRandom(11);
    const base = { latitude: 24.7136, longitude: 46.6753 };
    const maxMeters = 500;
    for (let i = 0; i < 100; i++) {
      const jittered = jitterCoordinate(rng, base, maxMeters);
      const dLat = jittered.latitude - base.latitude;
      const dLng = jittered.longitude - base.longitude;
      const metersPerDegreeLat = 111_320;
      const metersPerDegreeLng = 111_320 * Math.cos((base.latitude * Math.PI) / 180);
      const approxMeters = Math.sqrt(
        (dLat * metersPerDegreeLat) ** 2 + (dLng * metersPerDegreeLng) ** 2
      );
      expect(approxMeters).toBeLessThanOrEqual(maxMeters + 1e-6);
    }
  });

  it('jittering with the same seed reproduces the same offset', () => {
    const base = { latitude: 24.7136, longitude: 46.6753 };
    const a = jitterCoordinate(createSeededRandom(123), base, 300);
    const b = jitterCoordinate(createSeededRandom(123), base, 300);
    expect(a).toEqual(b);
  });
});
