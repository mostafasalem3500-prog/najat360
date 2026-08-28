/**
 * Dispatch Score — spec section 29.4, the coverage-aware upgrade to C4's
 * Access Score (`access-score.ts`). Deliberately a SEPARATE module and
 * function rather than a modification of `computeAccessScore()` itself:
 * C4's Access Score is already fully shipped, tested, and used to persist
 * the real `Recommendation` row for `inc-active-03`'s (now closed)
 * dispatch decision — rewriting it now would put already-verified C4
 * behavior at risk for no benefit. This module is the literal completion
 * of the reservation `access-score.ts`'s own header comment already
 * documented: "That upgrade is this project's own C6 phase."
 *
 * ```
 * Dispatch Score =
 *   0.40 × ETA score
 *   + 0.20 × entrance accessibility
 *   + 0.15 × unit readiness
 *   + 0.10 × location confidence
 *   + 0.15 × post-dispatch coverage protection
 * ```
 *
 * Note the two differences from Access Score, both per spec 29.4's exact
 * wording (not this project's choice): location confidence drops from
 * 0.15 to 0.10, "data freshness" (0.10 in Access Score) is replaced
 * entirely by "post-dispatch coverage protection" (0.15) — see
 * `lib/gis/coverage.ts`'s `computeCoverageProtection()` for how that
 * component is computed. Same pure-function shape as `access-score.ts`:
 * weights validated to sum to 1 at module load, bounded 0-100 output,
 * full breakdown returned for audit.
 */

export const DISPATCH_SCORE_VERSION = 'dispatch-score-v1';

export interface DispatchScoreComponents {
  /** 0-100: higher means a shorter/faster route — same `etaSecondsToScore()` from access-score.ts. */
  etaScore: number;
  /** 0-100: how accessible/usable the candidate entrance currently is. */
  entranceAccessibility: number;
  /** 0-100: the candidate unit's own `readinessScore`. */
  unitReadiness: number;
  /** 0-100: the incident's own Location Confidence Index (spec 14) at decision time. */
  locationConfidence: number;
  /** 0-100: `computeCoverageProtection()`'s `protectionScore` for this candidate unit — 100 = dispatching this unit costs coverage nothing, 0 = it costs the configured degradation cap or more. */
  coverageProtection: number;
}

const WEIGHTS = {
  etaScore: 0.4,
  entranceAccessibility: 0.2,
  unitReadiness: 0.15,
  locationConfidence: 0.1,
  coverageProtection: 0.15,
} as const;

const WEIGHT_SUM = Object.values(WEIGHTS).reduce((sum, w) => sum + w, 0);
if (Math.abs(WEIGHT_SUM - 1) > 1e-9) {
  throw new Error(`Dispatch Score weights must sum to 1, got ${WEIGHT_SUM}`);
}

export interface DispatchScoreResult {
  /** Bounded integer 0-100. */
  score: number;
  version: typeof DISPATCH_SCORE_VERSION;
  breakdown: Record<keyof DispatchScoreComponents, number>;
}

function clampComponent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

export function computeDispatchScore(components: DispatchScoreComponents): DispatchScoreResult {
  const clamped: DispatchScoreComponents = {
    etaScore: clampComponent(components.etaScore),
    entranceAccessibility: clampComponent(components.entranceAccessibility),
    unitReadiness: clampComponent(components.unitReadiness),
    locationConfidence: clampComponent(components.locationConfidence),
    coverageProtection: clampComponent(components.coverageProtection),
  };

  const breakdown: Record<keyof DispatchScoreComponents, number> = {
    etaScore: clamped.etaScore * WEIGHTS.etaScore,
    entranceAccessibility: clamped.entranceAccessibility * WEIGHTS.entranceAccessibility,
    unitReadiness: clamped.unitReadiness * WEIGHTS.unitReadiness,
    locationConfidence: clamped.locationConfidence * WEIGHTS.locationConfidence,
    coverageProtection: clamped.coverageProtection * WEIGHTS.coverageProtection,
  };

  const rawScore = Object.values(breakdown).reduce((sum, v) => sum + v, 0);
  const score = Math.min(100, Math.max(0, Math.round(rawScore)));

  return { score, version: DISPATCH_SCORE_VERSION, breakdown };
}
