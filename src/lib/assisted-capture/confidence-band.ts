/**
 * Bands a 0-1 AI-suggestion confidence score into HIGH/MEDIUM/LOW for
 * spec 30.4's call-taker review UI. Thresholds are this project's own
 * choice — spec 30.4 requires the three bands but does not enumerate
 * cutoffs — chosen to mirror the same 80/60 split `lib/confidence.ts`
 * uses for the (unrelated) 0-100 Location Confidence Index, purely so the
 * product has one consistent mental model of "what HIGH means" across
 * screens. This does NOT make the two metrics the same thing; see
 * `assisted-capture/provider.ts`'s `SuggestionConfidenceBand` doc comment.
 */
export const SUGGESTION_CONFIDENCE_BAND_VERSION = 'suggestion-confidence-band-v1';

const HIGH_THRESHOLD = 0.8;
const MEDIUM_THRESHOLD = 0.6;

import type { SuggestionConfidenceBand } from './provider';
export type { SuggestionConfidenceBand } from './provider';

export function computeSuggestionConfidenceBand(confidence: number): SuggestionConfidenceBand {
  if (!Number.isFinite(confidence)) {
    throw new RangeError(`confidence must be a finite number, got ${confidence}`);
  }
  if (confidence < 0 || confidence > 1) {
    throw new RangeError(`confidence must be within [0, 1], got ${confidence}`);
  }
  if (confidence >= HIGH_THRESHOLD) return 'HIGH';
  if (confidence >= MEDIUM_THRESHOLD) return 'MEDIUM';
  return 'LOW';
}
