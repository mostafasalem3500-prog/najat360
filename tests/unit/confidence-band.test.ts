import { describe, expect, it } from 'vitest';
import { computeSuggestionConfidenceBand } from '@/lib/assisted-capture/confidence-band';

describe('computeSuggestionConfidenceBand', () => {
  it.each([
    [1, 'HIGH'],
    [0.8, 'HIGH'],
    [0.79, 'MEDIUM'],
    [0.6, 'MEDIUM'],
    [0.59, 'LOW'],
    [0, 'LOW'],
  ] as const)('bands %s as %s', (confidence, expected) => {
    expect(computeSuggestionConfidenceBand(confidence)).toBe(expected);
  });

  it('rejects a confidence below 0', () => {
    expect(() => computeSuggestionConfidenceBand(-0.1)).toThrow(RangeError);
  });

  it('rejects a confidence above 1', () => {
    expect(() => computeSuggestionConfidenceBand(1.1)).toThrow(RangeError);
  });

  it('rejects a non-finite confidence', () => {
    expect(() => computeSuggestionConfidenceBand(NaN)).toThrow(RangeError);
    expect(() => computeSuggestionConfidenceBand(Infinity)).toThrow(RangeError);
  });
});
