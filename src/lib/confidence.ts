/**
 * Location Confidence Index — section 14 of NAJAT360_CLAUDE_MASTER_BUILD_PROMPT.md.
 *
 * Naming note (spec line 659): "لا تسمِّ الناتج probability. الاسم: Location
 * Confidence Index" — this is an operational index for a call-taker to act
 * on, not a statistical probability, and the API surface here is named
 * accordingly (no `probability` anywhere).
 *
 * Pure function, no I/O: takes six 0–100 component scores the caller has
 * already computed elsewhere (GPS accuracy from `gpsAccuracyMeters`, road
 * plausibility from a routing/snap check, entrance proximity from nearby
 * `Entrance` rows, caller confirmation from the intake flow, landmark
 * evidence when the caller mentioned one, and data freshness from how long
 * ago the fix was captured) and combines them with the spec's fixed
 * weights.
 */

export interface ConfidenceComponents {
  /** 0–100: higher means a tighter GPS fix (smaller gpsAccuracyMeters). */
  gpsAccuracy: number;
  /** 0–100: how plausible the point is given roads/area context (not stranded mid-lake, etc). */
  roadPlausibility: number;
  /** 0–100: how close a known Entrance is to the reported point. */
  entranceProximity: number;
  /** 0–100: how strongly the caller confirmed the location during intake. */
  callerConfirmation: number;
  /** 0–100, optional — spec: "landmark score إذا توفر". Omitted entirely (not zeroed) when the caller gave no landmark, so its weight is redistributed rather than punishing a call that simply had nothing to reference. */
  landmarkEvidence?: number;
  /** 0–100: freshness of the underlying location fix — recent capture scores higher. */
  dataFreshness: number;
}

export type ConfidenceBand = 'HIGH' | 'MEDIUM' | 'LOW';

/** Bumped whenever the weights or components below change, so a stored score can always be interpreted against the formula that produced it (spec: "احفظ confidenceVersion ومكونات الدرجة حتى يمكن تفسيرها"). */
export const CONFIDENCE_VERSION = 'confidence-v1';

const WEIGHTS = {
  gpsAccuracy: 0.35,
  roadPlausibility: 0.2,
  entranceProximity: 0.2,
  callerConfirmation: 0.15,
  landmarkEvidence: 0.05,
  dataFreshness: 0.05,
} as const;

// Defensive: if this ever drifts from 1 after an edit, every score computed
// from it would be silently wrong. Checked once at module load.
const WEIGHT_SUM = Object.values(WEIGHTS).reduce((sum, w) => sum + w, 0);
if (Math.abs(WEIGHT_SUM - 1) > 1e-9) {
  throw new Error(`Confidence engine weights must sum to 1, got ${WEIGHT_SUM}`);
}

export interface ConfidenceResult {
  /** Bounded integer 0–100. Never NaN, never outside this range regardless of input. */
  score: number;
  band: ConfidenceBand;
  version: typeof CONFIDENCE_VERSION;
  /** Weighted contribution of each component, for the "احفظ ... ومكونات الدرجة" audit trail. Sums to `score` (± rounding). */
  breakdown: Record<keyof ConfidenceComponents, number>;
}

function clampComponent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function bandFor(score: number): ConfidenceBand {
  if (score >= 80) return 'HIGH';
  if (score >= 60) return 'MEDIUM';
  return 'LOW';
}

/**
 * When `landmarkEvidence` is omitted, its 0.05 weight is redistributed
 * proportionally across the remaining components rather than treated as a
 * zero score — a call with no landmark mentioned should not be penalized
 * for a signal the caller was never asked to provide.
 */
export function computeLocationConfidence(components: ConfidenceComponents): ConfidenceResult {
  const hasLandmark = components.landmarkEvidence !== undefined;
  const activeWeights: Record<keyof typeof WEIGHTS, number> = { ...WEIGHTS };
  if (!hasLandmark) {
    const redistribute = WEIGHTS.landmarkEvidence;
    const others = Object.keys(WEIGHTS).filter((k) => k !== 'landmarkEvidence') as Array<
      keyof typeof WEIGHTS
    >;
    const otherWeightSum = others.reduce((sum, k) => sum + WEIGHTS[k], 0);
    for (const key of others) {
      activeWeights[key] = WEIGHTS[key] + (WEIGHTS[key] / otherWeightSum) * redistribute;
    }
    activeWeights.landmarkEvidence = 0;
  }

  const clamped: ConfidenceComponents = {
    gpsAccuracy: clampComponent(components.gpsAccuracy),
    roadPlausibility: clampComponent(components.roadPlausibility),
    entranceProximity: clampComponent(components.entranceProximity),
    callerConfirmation: clampComponent(components.callerConfirmation),
    landmarkEvidence: hasLandmark ? clampComponent(components.landmarkEvidence!) : undefined,
    dataFreshness: clampComponent(components.dataFreshness),
  };

  const breakdown: Record<keyof ConfidenceComponents, number> = {
    gpsAccuracy: clamped.gpsAccuracy * activeWeights.gpsAccuracy,
    roadPlausibility: clamped.roadPlausibility * activeWeights.roadPlausibility,
    entranceProximity: clamped.entranceProximity * activeWeights.entranceProximity,
    callerConfirmation: clamped.callerConfirmation * activeWeights.callerConfirmation,
    landmarkEvidence: (clamped.landmarkEvidence ?? 0) * activeWeights.landmarkEvidence,
    dataFreshness: clamped.dataFreshness * activeWeights.dataFreshness,
  };

  const rawScore = Object.values(breakdown).reduce((sum, v) => sum + v, 0);
  const score = Math.min(100, Math.max(0, Math.round(rawScore)));

  return {
    score,
    band: bandFor(score),
    version: CONFIDENCE_VERSION,
    breakdown,
  };
}
