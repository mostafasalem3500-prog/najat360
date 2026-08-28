/**
 * Access Score — spec section 15. This is the C4-stage unit/entrance
 * ranking formula, DELIBERATELY NOT the later coverage-aware "Dispatch
 * Score" from spec 29.4 (which adds a 0.15-weighted "post-dispatch
 * coverage protection" term and requires the H3/coverage-snapshot engine
 * to exist). That upgrade is this project's own C6 phase; building it now
 * would mean this recommendation could never run until C6's H3 engine is
 * seeded — exactly the scope-bundling this project's phase gating exists
 * to avoid (confirmed as a real mistake in an independent AI's attempt at
 * this same phase — see docs/product for the comparison notes).
 *
 * ```
 * Access Score =
 *   0.40 × normalized ETA score
 *   + 0.20 × entrance accessibility
 *   + 0.15 × location confidence
 *   + 0.15 × unit readiness
 *   + 0.10 × data freshness
 * ```
 *
 * Pure function, no I/O — same shape as `lib/confidence.ts`'s engine
 * (weights validated to sum to 1 at module load, bounded 0-100 output,
 * full breakdown returned for audit).
 */

export const ACCESS_SCORE_VERSION = 'access-score-v1';

export interface AccessScoreComponents {
  /** 0-100: higher means a shorter/faster route (see `etaSecondsToScore()`). */
  etaScore: number;
  /** 0-100: how accessible/usable the candidate entrance currently is. */
  entranceAccessibility: number;
  /** 0-100: the incident's own Location Confidence Index (spec 14) at decision time — reused directly, not recomputed. */
  locationConfidence: number;
  /** 0-100: the candidate unit's own `readinessScore`. */
  unitReadiness: number;
  /** 0-100: how fresh the ETA/route computation and location resolution are. */
  dataFreshness: number;
}

const WEIGHTS = {
  etaScore: 0.4,
  entranceAccessibility: 0.2,
  locationConfidence: 0.15,
  unitReadiness: 0.15,
  dataFreshness: 0.1,
} as const;

const WEIGHT_SUM = Object.values(WEIGHTS).reduce((sum, w) => sum + w, 0);
if (Math.abs(WEIGHT_SUM - 1) > 1e-9) {
  throw new Error(`Access Score weights must sum to 1, got ${WEIGHT_SUM}`);
}

export interface AccessScoreResult {
  /** Bounded integer 0-100. */
  score: number;
  version: typeof ACCESS_SCORE_VERSION;
  breakdown: Record<keyof AccessScoreComponents, number>;
}

function clampComponent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

export function computeAccessScore(components: AccessScoreComponents): AccessScoreResult {
  const clamped: AccessScoreComponents = {
    etaScore: clampComponent(components.etaScore),
    entranceAccessibility: clampComponent(components.entranceAccessibility),
    locationConfidence: clampComponent(components.locationConfidence),
    unitReadiness: clampComponent(components.unitReadiness),
    dataFreshness: clampComponent(components.dataFreshness),
  };

  const breakdown: Record<keyof AccessScoreComponents, number> = {
    etaScore: clamped.etaScore * WEIGHTS.etaScore,
    entranceAccessibility: clamped.entranceAccessibility * WEIGHTS.entranceAccessibility,
    locationConfidence: clamped.locationConfidence * WEIGHTS.locationConfidence,
    unitReadiness: clamped.unitReadiness * WEIGHTS.unitReadiness,
    dataFreshness: clamped.dataFreshness * WEIGHTS.dataFreshness,
  };

  const rawScore = Object.values(breakdown).reduce((sum, v) => sum + v, 0);
  const score = Math.min(100, Math.max(0, Math.round(rawScore)));

  return { score, version: ACCESS_SCORE_VERSION, breakdown };
}

/**
 * Normalizes a route duration into the 0-100 "ETA score" component: 100 at
 * 0s, 0 at `worstSeconds` or beyond, linear between. `worstSeconds`
 * defaults to 900 (15 minutes) — this project's own choice of "an ETA this
 * long or longer contributes nothing to the score", not a spec-mandated
 * value.
 */
export function etaSecondsToScore(durationSeconds: number, worstSeconds = 900): number {
  const clamped = Math.min(worstSeconds, Math.max(0, durationSeconds));
  return Math.round(100 - (clamped / worstSeconds) * 100);
}

/**
 * Normalizes an age (route/resolution data freshness) into 0-100: 100 at
 * <=1min, 0 at >=10min, linear between. Deliberately a tighter window than
 * `lib/location/resolver.ts`'s own freshness scoring (2-30min) — an ETA
 * that is 10 minutes stale is far more likely to be operationally wrong
 * (unit already moved) than a location observation of the same age.
 */
export function dataAgeToFreshnessScore(ageMs: number): number {
  const ageMinutes = Math.max(0, ageMs) / 60_000;
  const clamped = Math.min(10, Math.max(1, ageMinutes));
  return Math.round(100 - ((clamped - 1) / 9) * 100);
}
