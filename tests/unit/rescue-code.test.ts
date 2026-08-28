import { describe, expect, it } from 'vitest';
import {
  generateDeterministicRescueCode,
  generateRescueCode,
  RescueCodeCollisionError,
  validateRescueCode,
} from '@/lib/rescue-code';
import { createSeededRandom } from '@/lib/deterministic-random';

describe('rescue-code — generation', () => {
  it('produces a UUID id and an NJT-XXX-YY shaped code', () => {
    const { id, rescueCode } = generateRescueCode();
    expect(id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(rescueCode).toMatch(/^NJT-[2-9A-HJ-NP-Z]{3}-[2-9A-HJ-NP-Z]{2}$/);
  });

  it('never includes the visually ambiguous characters 0, O, 1, I', () => {
    for (let i = 0; i < 200; i++) {
      const { rescueCode } = generateRescueCode();
      expect(rescueCode).not.toMatch(/[01OI]/);
    }
  });

  it('every generated code passes its own checksum validation', () => {
    for (let i = 0; i < 200; i++) {
      const { rescueCode } = generateRescueCode();
      expect(validateRescueCode(rescueCode)).toBe(true);
    }
  });

  it('retries on collision via the injected isTaken predicate and eventually succeeds', () => {
    let calls = 0;
    const { rescueCode } = generateRescueCode({
      isTaken: () => {
        calls += 1;
        return calls < 3; // first two candidates are "taken", third is accepted
      },
    });
    expect(validateRescueCode(rescueCode)).toBe(true);
    expect(calls).toBe(3);
  });

  it('throws RescueCodeCollisionError when every attempt collides', () => {
    expect(() => generateRescueCode({ isTaken: () => true, maxAttempts: 5 })).toThrow(
      RescueCodeCollisionError
    );
  });
});

describe('rescue-code — validation', () => {
  it('rejects a code with a tampered payload character (checksum mismatch)', () => {
    const { rescueCode } = generateRescueCode();
    const [prefix, payload, checksum] = rescueCode.split('-');
    const tamperedChar = payload![0] === 'A' ? 'B' : 'A';
    const tampered = `${prefix}-${tamperedChar}${payload!.slice(1)}-${checksum}`;
    expect(validateRescueCode(tampered)).toBe(false);
  });

  it('rejects malformed shapes outright', () => {
    expect(validateRescueCode('not-a-code')).toBe(false);
    expect(validateRescueCode('NJT-AB-99')).toBe(false); // payload too short
    expect(validateRescueCode('')).toBe(false);
  });

  it('is case-insensitive and trims whitespace on input', () => {
    const { rescueCode } = generateRescueCode();
    expect(validateRescueCode(`  ${rescueCode.toLowerCase()}  `)).toBe(true);
  });
});

describe('rescue-code — deterministic seed variant', () => {
  it('the same seed produces the exact same rescue code every time', () => {
    const codeA = generateDeterministicRescueCode(createSeededRandom(42));
    const codeB = generateDeterministicRescueCode(createSeededRandom(42));
    expect(codeA).toBe(codeB);
  });

  it('produces a code that passes the real checksum validator', () => {
    const rng = createSeededRandom(7);
    for (let i = 0; i < 50; i++) {
      expect(validateRescueCode(generateDeterministicRescueCode(rng))).toBe(true);
    }
  });
});
