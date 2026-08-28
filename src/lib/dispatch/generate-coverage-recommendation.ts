/**
 * generateCoverageAwareRecommendation() — spec 29.4's coverage-aware unit
 * ranking, C6. Same shape and reuse discipline as C4's
 * `generateRecommendation()` (reuses `computeUnitEntranceRoute()` and
 * `computeEntranceAccessibilityScore()` from it rather than duplicating
 * route/entrance logic), but ranks candidates by `computeDispatchScore()`
 * instead of `computeAccessScore()`, and additionally reports coverage
 * before/after the top pick (spec 29.4: "احسب واعرض قبل/بعد: mean ETA،
 * P90 ETA، worst-covered H3 cell، count of cells over threshold").
 *
 * Deliberately a SEPARATE function from `generateRecommendation()`, not a
 * flag added to it — see `dispatch-score.ts`'s header for why C4's
 * already-shipped/tested recommendation path is left untouched.
 *
 * Satisfies spec 29.9 acceptance test 6 ("the fastest unit that harms
 * coverage may lose to the alternative, with an explained breakdown"): the
 * per-candidate `breakdown` always includes the `coverageProtection`
 * component, so a supervisor (or a test) can see exactly why a
 * slower-but-safer unit outranked a faster-but-coverage-costly one — see
 * `generate-coverage-recommendation.test.ts` for a constructed scenario
 * that exercises this flip end-to-end.
 */
import { computeDispatchScore, DISPATCH_SCORE_VERSION } from './dispatch-score';
import { computeEntranceAccessibilityScore } from './entrance-accessibility';
import { etaSecondsToScore } from './access-score';
import {
  computeUnitEntranceRoute,
  NoAvailableUnitsError,
  NoCandidateEntrancesError,
  type UnitCandidateInput,
  type EntranceCandidateInput,
  type UnitEntranceRoute,
} from './generate-recommendation';
import { computeCoverageMetrics, computeCoverageProtection, type CoverageCellInput, type CoverageMetrics } from '@/lib/gis/coverage';
import type { RoutingProvider } from '@/lib/routing/provider';

export interface GenerateCoverageRecommendationInput {
  incidentId: string;
  locationConfidenceIndex: number;
  resolvedFloorLevel?: string | null;
  availableUnits: UnitCandidateInput[];
  candidateEntrances: EntranceCandidateInput[];
  /** The H3 cell grid to evaluate coverage impact against — see `lib/gis/h3.ts`'s `h3GridDisk()` for building one around the demo area. */
  coverageCells: CoverageCellInput[];
  coverageGapThresholdSeconds?: number;
  routingProvider: RoutingProvider;
}

export interface RankedCoverageCandidate {
  unitId: string;
  entranceId: string;
  score: number;
  breakdown: Record<string, number>;
  route: UnitEntranceRoute;
}

export interface GenerateCoverageRecommendationResult {
  algorithmVersion: typeof DISPATCH_SCORE_VERSION;
  recommendedUnitId: string;
  alternativeUnitId: string | null;
  recommendedEntranceId: string;
  alternativeEntranceId: string | null;
  dispatchScore: number;
  confidenceScore: number;
  reasoning: string[];
  routeSnapshots: UnitEntranceRoute[];
  candidates: RankedCoverageCandidate[];
  coverageBefore: CoverageMetrics;
  /** Coverage of the grid with the recommended unit removed from the available pool — i.e. "if we dispatch it, what does coverage look like". Falls back to `coverageBefore` itself, with a `SINGLE_UNIT_NO_COMPARISON` reasoning tag, when only one unit is available (there is no meaningful "without this unit" state to compute — `lib/gis/coverage.ts` requires at least one unit to evaluate coverage at all). */
  coverageAfter: CoverageMetrics;
}

function formatCoverageTag(label: string, metrics: CoverageMetrics): string {
  return `${label}:mean=${metrics.meanEtaSeconds}s,p90=${metrics.p90EtaSeconds}s,worstCell=${metrics.worstCell.h3Index}(${metrics.worstCell.etaSeconds}s),gaps=${metrics.gapCellCount}/${metrics.totalCells},mode=${metrics.mode}`;
}

export async function generateCoverageAwareRecommendation(
  input: GenerateCoverageRecommendationInput
): Promise<GenerateCoverageRecommendationResult> {
  const { incidentId, locationConfidenceIndex, resolvedFloorLevel, routingProvider } = input;

  if (input.availableUnits.length === 0) {
    throw new NoAvailableUnitsError(incidentId);
  }
  const activeEntrances = input.candidateEntrances.filter((e) => e.active);
  if (activeEntrances.length === 0) {
    throw new NoCandidateEntrancesError(incidentId);
  }

  const coverageUnits = input.availableUnits.map((u) => ({ id: u.id, location: u.location }));
  const coverageInput = {
    cells: input.coverageCells,
    units: coverageUnits,
    routingProvider,
    gapThresholdSeconds: input.coverageGapThresholdSeconds,
  };

  // Coverage PROTECTION (the per-unit "what if this unit gets dispatched"
  // comparison) needs at least 2 units to mean anything — see
  // `computeCoverageProtection()`'s own guard. With exactly one available
  // unit there is no ranking decision to protect anyway (no alternative
  // exists), so every candidate for that unit gets a neutral protection
  // score instead of computing an undefined "coverage with zero units".
  const coverageBefore = await computeCoverageMetrics(coverageInput);
  const protectionScoreByUnitId = new Map<string, number>();
  const withoutUnitMetricsByUnitId = new Map<string, CoverageMetrics>();
  if (input.availableUnits.length >= 2) {
    const protection = await computeCoverageProtection(coverageInput);
    for (const [unitId, result] of Object.entries(protection.perUnit)) {
      protectionScoreByUnitId.set(unitId, result.protectionScore);
      withoutUnitMetricsByUnitId.set(unitId, result.withoutUnit);
    }
  } else {
    protectionScoreByUnitId.set(input.availableUnits[0]!.id, 100);
  }

  const candidates: RankedCoverageCandidate[] = [];
  for (const entrance of activeEntrances) {
    const entranceAccessibility = computeEntranceAccessibilityScore({ entrance, resolvedFloorLevel });
    for (const unit of input.availableUnits) {
      const route = await computeUnitEntranceRoute(unit, entrance, routingProvider);
      const result = computeDispatchScore({
        etaScore: etaSecondsToScore(route.totalDurationSeconds),
        entranceAccessibility,
        unitReadiness: unit.readinessScore,
        locationConfidence: locationConfidenceIndex,
        coverageProtection: protectionScoreByUnitId.get(unit.id) ?? 100,
      });
      candidates.push({ unitId: unit.id, entranceId: entrance.id, score: result.score, breakdown: result.breakdown, route });
    }
  }

  // Same tie-break rule as C4's Access Score (score, then ETA, then
  // readiness) — spec 29.4 does not define its own tie-break, so this
  // extends the established C4 convention rather than inventing a new one.
  const readinessByUnitId = new Map(input.availableUnits.map((u) => [u.id, u.readinessScore]));
  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.route.totalDurationSeconds !== b.route.totalDurationSeconds) {
      return a.route.totalDurationSeconds - b.route.totalDurationSeconds;
    }
    return (readinessByUnitId.get(b.unitId) ?? 0) - (readinessByUnitId.get(a.unitId) ?? 0);
  });

  const top = candidates[0]!;
  const alternativeUnitCandidate = candidates.find((c) => c.entranceId === top.entranceId && c.unitId !== top.unitId);
  const alternativeEntranceCandidate = candidates.find((c) => c.unitId === top.unitId && c.entranceId !== top.entranceId);

  const singleUnitFallback = input.availableUnits.length < 2;
  const coverageAfter = singleUnitFallback
    ? coverageBefore
    : (withoutUnitMetricsByUnitId.get(top.unitId) ?? coverageBefore);

  const reasoning: string[] = [
    `CANDIDATES_CONSIDERED:${candidates.length}`,
    `TOP_CANDIDATE:unit=${top.unitId},entrance=${top.entranceId},score=${top.score}`,
    formatCoverageTag('COVERAGE_BEFORE', coverageBefore),
    formatCoverageTag('COVERAGE_AFTER', coverageAfter),
  ];
  if (singleUnitFallback) reasoning.push('SINGLE_UNIT_NO_COMPARISON');
  if (alternativeUnitCandidate) {
    reasoning.push(
      `ALTERNATIVE_UNIT:${alternativeUnitCandidate.unitId},score=${alternativeUnitCandidate.score},coverageProtection=${alternativeUnitCandidate.breakdown.coverageProtection}`
    );
  }
  if (alternativeEntranceCandidate) reasoning.push(`ALTERNATIVE_ENTRANCE:${alternativeEntranceCandidate.entranceId}`);

  return {
    algorithmVersion: DISPATCH_SCORE_VERSION,
    recommendedUnitId: top.unitId,
    alternativeUnitId: alternativeUnitCandidate?.unitId ?? null,
    recommendedEntranceId: top.entranceId,
    alternativeEntranceId: alternativeEntranceCandidate?.entranceId ?? null,
    dispatchScore: top.score,
    confidenceScore: locationConfidenceIndex,
    reasoning,
    routeSnapshots: candidates.map((c) => c.route),
    candidates,
    coverageBefore,
    coverageAfter,
  };
}
