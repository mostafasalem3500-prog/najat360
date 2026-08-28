/**
 * Rescue code generator — section 13 of NAJAT360_CLAUDE_MASTER_BUILD_PROMPT.md.
 *
 * Every Incident gets two identifiers: an internal `id` (a UUID, opaque,
 * never read aloud) and a `rescueCode` — a short human-speakable code
 * (style: `NJT-7K4-92`) that a caller can read over the phone, a paramedic
 * can scan/type on a tablet, and a field crew can cross-check against a
 * physical Rescue Anchor sticker. It has to be short enough to read aloud
 * once and be checksummed, since a single mis-heard character over a radio
 * must not silently resolve to a *different real* incident.
 */
import { randomInt, randomUUID } from 'node:crypto';
import type { SeededRandom } from '@/lib/deterministic-random';

/**
 * Crockford-style restricted alphabet: excludes 0/O and 1/I, the two pairs
 * most commonly confused when read aloud or handwritten on a triage tag.
 */
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

const PAYLOAD_LENGTH = 3;
const CHECKSUM_LENGTH = 2;
const PREFIX = 'NJT';

function randomPayload(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ALPHABET[randomInt(ALPHABET.length)];
  }
  return out;
}

/**
 * Deterministic weighted-sum checksum over the payload characters, encoded
 * back into the same restricted alphabet. Deterministic on purpose: it
 * lets `validateRescueCode()` recompute and compare without any lookup,
 * which is what makes a mis-read single character detectable in the field
 * with no network call.
 */
function computeChecksum(payload: string): string {
  let sum = 0;
  for (let i = 0; i < payload.length; i++) {
    const value = ALPHABET.indexOf(payload[i]!);
    if (value === -1) {
      throw new Error(`Invalid character in rescue code payload: "${payload[i]}"`);
    }
    // Position-weighted so transposing two characters changes the checksum.
    sum += value * (i + 1);
  }
  const base = ALPHABET.length;
  const modulus = base * base;
  const checksumValue = sum % modulus;
  const high = Math.floor(checksumValue / base);
  const low = checksumValue % base;
  return ALPHABET[high]! + ALPHABET[low]!;
}

function formatCode(payload: string, checksum: string): string {
  return `${PREFIX}-${payload}-${checksum}`;
}

export interface RescueCode {
  id: string;
  rescueCode: string;
}

export interface GenerateRescueCodeOptions {
  /** Return true if the candidate code is already in use. Called once per attempt so this stays a pure/injectable dependency instead of this module reaching into a database itself. */
  isTaken?: (code: string) => boolean;
  /** Safety bound on collision retries — a real collision this many times in a row means the seed data is far too small for this alphabet, not bad luck. */
  maxAttempts?: number;
}

export class RescueCodeCollisionError extends Error {
  constructor(attempts: number) {
    super(`Could not generate a unique rescue code after ${attempts} attempts`);
    this.name = 'RescueCodeCollisionError';
  }
}

export function generateRescueCode(options: GenerateRescueCodeOptions = {}): RescueCode {
  const { isTaken, maxAttempts = 10 } = options;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const payload = randomPayload(PAYLOAD_LENGTH);
    const checksum = computeChecksum(payload);
    const rescueCode = formatCode(payload, checksum);

    if (!isTaken || !isTaken(rescueCode)) {
      return { id: randomUUID(), rescueCode };
    }
  }

  throw new RescueCodeCollisionError(maxAttempts);
}

/**
 * Deterministic sibling of `generateRescueCode()`, used ONLY by
 * scripts/seed-demo.ts (and, later, Evidence Replay fixtures) — anywhere
 * that must produce the exact same code string on every run given the same
 * seeded PRNG, which `node:crypto`'s real randomness cannot do by design.
 * Never use this for a real caller-facing incident; that path must go
 * through `generateRescueCode()` so codes stay unpredictable.
 */
export function generateDeterministicRescueCode(rng: SeededRandom): string {
  let payload = '';
  for (let i = 0; i < PAYLOAD_LENGTH; i++) {
    payload += ALPHABET[Math.floor(rng() * ALPHABET.length)];
  }
  const checksum = computeChecksum(payload);
  return formatCode(payload, checksum);
}

const RESCUE_CODE_PATTERN = new RegExp(
  `^${PREFIX}-([${ALPHABET}]{${PAYLOAD_LENGTH}})-([${ALPHABET}]{${CHECKSUM_LENGTH}})$`
);

/**
 * Validates both the shape AND the checksum. A code with the right shape
 * but a mismatched checksum (e.g. one mis-heard character) fails this —
 * that mismatch is the whole point of carrying a checksum at all.
 */
export function validateRescueCode(code: string): boolean {
  const match = RESCUE_CODE_PATTERN.exec(code.trim().toUpperCase());
  if (!match) return false;
  const [, payload, checksum] = match;
  return computeChecksum(payload!) === checksum;
}
