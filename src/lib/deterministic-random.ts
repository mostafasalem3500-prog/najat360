/**
 * Deterministic pseudo-random generator, shared by scripts/seed-demo.ts and,
 * later, Evidence Replay (docs/product/NAJAT360-قرارات-ما-بعد-C0.md): both
 * need "the same scenario, byte-for-byte, every run" rather than fresh
 * randomness each time. `Math.random()` cannot give that; a seeded PRNG
 * can — same seed in, same sequence of values out, forever.
 *
 * This is NOT for anything security-sensitive (tokens, ids) — see spec
 * section 13's explicit "لا تستخدم Math.random() وحده", which is why
 * lib/rescue-code.ts uses node:crypto instead. This module is only for
 * generating realistic-looking, reproducible DEMO data and reproducible
 * REPLAY scenarios.
 */

export type SeededRandom = () => number;

/**
 * mulberry32 — a small, fast, public-domain PRNG. Chosen over
 * `Math.random()` purely for its one relevant property: given the same
 * 32-bit seed, it produces the exact same sequence of floats in [0, 1) on
 * every run, on every machine, forever.
 */
export function createSeededRandom(seed: number): SeededRandom {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer in [min, max], inclusive on both ends. */
export function randomInt(rng: SeededRandom, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

/** Float in [min, max). */
export function randomFloat(rng: SeededRandom, min: number, max: number): number {
  return rng() * (max - min) + min;
}

export function randomChoice<T>(rng: SeededRandom, items: readonly T[]): T {
  if (items.length === 0) {
    throw new Error('randomChoice: items must be non-empty');
  }
  return items[randomInt(rng, 0, items.length - 1)]!;
}

/**
 * Nudges a lat/lng point by up to `maxMeters` in a random direction.
 * Approximation (equirectangular, fine at city scale): 1 degree latitude
 * ~ 111,320 meters; longitude scaled by cos(latitude).
 */
export function jitterCoordinate(
  rng: SeededRandom,
  base: { latitude: number; longitude: number },
  maxMeters: number
): { latitude: number; longitude: number } {
  const distanceMeters = randomFloat(rng, 0, maxMeters);
  const bearingRadians = randomFloat(rng, 0, 2 * Math.PI);
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLng = 111_320 * Math.cos((base.latitude * Math.PI) / 180);

  const deltaLat = (distanceMeters * Math.cos(bearingRadians)) / metersPerDegreeLat;
  const deltaLng = (distanceMeters * Math.sin(bearingRadians)) / metersPerDegreeLng;

  return {
    latitude: base.latitude + deltaLat,
    longitude: base.longitude + deltaLng,
  };
}
