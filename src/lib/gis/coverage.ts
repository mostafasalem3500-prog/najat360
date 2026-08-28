/**
 * Coverage engine — spec section 18 (Coverage Gap) + section 29.4's
 * before/after coverage metrics for a dispatch decision. Pure computation
 * over data the caller supplies (an H3 cell grid, a unit list, a
 * `RoutingProvider`) — no I/O, no persistence, same shape as every other
 * decision-adjacent module in this codebase.
 *
 * For each H3 cell in the supplied grid, this computes the shortest ETA
 * from ANY of the supplied units (spec 18: "لكل خلية H3 احسب أقل ETA من
 * الوحدات المتاحة" — for each H3 cell, compute the minimum ETA from
 * available units), classifies cells beyond a configurable threshold as
 * coverage gaps, and reports mean/P90/worst-cell metrics (spec 29.4).
 *
 * Deliberately does NOT weight these metrics by predicted demand (spec
 * 18's own words: "عدد السكان غير متوفر؛ لا تخترعه" — population count is
 * not available; do not invent it). An independent AI's earlier attempt at
 * this exact phase weighted its mean/P90 by `H3Prediction.predictedDemand`
 * — defensible in spirit, but it means the headline coverage numbers a
 * supervisor sees inherit whatever uncertainty is baked into a *separate*
 * baseline demand model (spec 17), coupling two things spec keeps
 * separate. This module reports a plain statistical mean/percentile over
 * the cell ETA distribution — every cell counted once, nothing invented.
 */
import type { LatLng } from '@/lib/geo';
import type { RoutingProvider } from '@/lib/routing/provider';

export class NoUnitsForCoverageError extends Error {
  constructor() {
    super('computeCoverageMetrics: at least one unit is required to evaluate coverage');
    this.name = 'NoUnitsForCoverageError';
  }
}

export class NoCellsForCoverageError extends Error {
  constructor() {
    super('computeCoverageMetrics: at least one H3 cell is required to evaluate coverage');
    this.name = 'NoCellsForCoverageError';
  }
}

export interface CoverageCellInput {
  h3Index: string;
  center: LatLng;
}

export interface CoverageUnitInput {
  id: string;
  location: LatLng;
}

export interface CellCoverageResult {
  h3Index: string;
  minEtaSeconds: number;
  nearestUnitId: string;
  isGap: boolean;
}

export interface CoverageMetrics {
  totalCells: number;
  meanEtaSeconds: number;
  p90EtaSeconds: number;
  worstCell: { h3Index: string; etaSeconds: number };
  gapCellCount: number;
  gapThresholdSeconds: number;
  /** 'simulation' whenever the underlying routing data is MOCK/FALLBACK rather than a live provider — spec 29.4: "إذا تعذر حساب المصفوفة الحية استخدم seed deterministic وسم النتيجة simulation". */
  mode: 'simulation' | 'live';
  cells: CellCoverageResult[];
}

/**
 * 480 seconds (8 minutes) — this project's own default "acceptable
 * response ETA" threshold, not a spec-mandated value (spec: "العتبة
 * القابلة للضبط" — the configurable threshold). Callers can override it
 * per spec's own "configurable" requirement.
 */
export const DEFAULT_COVERAGE_GAP_THRESHOLD_SECONDS = 480;

/**
 * Linear-interpolation percentile (the same method most stats libraries
 * default to) over an ASCENDING-sorted array. `p` is 0-1 (0.9 for P90).
 */
export function percentile(sortedAscending: number[], p: number): number {
  if (sortedAscending.length === 0) return 0;
  if (sortedAscending.length === 1) return sortedAscending[0]!;
  const rank = p * (sortedAscending.length - 1);
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  if (lowerIndex === upperIndex) return sortedAscending[lowerIndex]!;
  const weight = rank - lowerIndex;
  return sortedAscending[lowerIndex]! * (1 - weight) + sortedAscending[upperIndex]! * weight;
}

export interface ComputeCoverageMetricsInput {
  cells: CoverageCellInput[];
  units: CoverageUnitInput[];
  routingProvider: RoutingProvider;
  gapThresholdSeconds?: number;
}

export async function computeCoverageMetrics(input: ComputeCoverageMetricsInput): Promise<CoverageMetrics> {
  const { cells, units, routingProvider } = input;
  const gapThresholdSeconds = input.gapThresholdSeconds ?? DEFAULT_COVERAGE_GAP_THRESHOLD_SECONDS;

  if (units.length === 0) throw new NoUnitsForCoverageError();
  if (cells.length === 0) throw new NoCellsForCoverageError();

  const matrixResult = await routingProvider.matrix({
    origins: units.map((u) => u.location),
    destinations: cells.map((c) => c.center),
    mode: 'VEHICLE',
  });

  const cellResults: CellCoverageResult[] = cells.map((cell, cellIndex) => {
    let minEtaSeconds = Number.POSITIVE_INFINITY;
    let nearestUnitId = units[0]!.id;
    units.forEach((unit, unitIndex) => {
      const eta = matrixResult.durationsSeconds[unitIndex]![cellIndex]!;
      if (eta < minEtaSeconds) {
        minEtaSeconds = eta;
        nearestUnitId = unit.id;
      }
    });
    return {
      h3Index: cell.h3Index,
      minEtaSeconds,
      nearestUnitId,
      isGap: minEtaSeconds > gapThresholdSeconds,
    };
  });

  const etaValuesAscending = cellResults.map((c) => c.minEtaSeconds).sort((a, b) => a - b);
  const meanEtaSeconds = etaValuesAscending.reduce((sum, v) => sum + v, 0) / etaValuesAscending.length;
  const p90EtaSeconds = percentile(etaValuesAscending, 0.9);
  const worst = cellResults.reduce((max, c) => (c.minEtaSeconds > max.minEtaSeconds ? c : max), cellResults[0]!);
  const gapCellCount = cellResults.filter((c) => c.isGap).length;

  return {
    totalCells: cellResults.length,
    meanEtaSeconds: Math.round(meanEtaSeconds),
    p90EtaSeconds: Math.round(p90EtaSeconds),
    worstCell: { h3Index: worst.h3Index, etaSeconds: worst.minEtaSeconds },
    gapCellCount,
    gapThresholdSeconds,
    mode: matrixResult.providerMode === 'LIVE' ? 'live' : 'simulation',
    cells: cellResults,
  };
}

export interface CoverageProtectionResult {
  baseline: CoverageMetrics;
  /** Keyed by unit id: what coverage looks like if THIS unit is no longer available (i.e. it gets dispatched away), and a 0-100 score where 100 = removing this unit costs nothing, 0 = removing it costs `PROTECTION_DEGRADATION_CAP_SECONDS` or more of extra mean ETA. */
  perUnit: Record<string, { withoutUnit: CoverageMetrics; meanEtaDeltaSeconds: number; protectionScore: number }>;
}

/**
 * 300 seconds (5 minutes) of mean-ETA degradation maps to a protection
 * score of 0 — this project's own normalization cap, not spec-mandated
 * (spec only requires the before/after numbers be shown, not a specific
 * 0-100 scale). Chosen to be comfortably inside the same order of
 * magnitude as `access-score.ts`'s own `worstSeconds=900` ETA-scoring cap,
 * since losing a unit should degrade the SCORE faster than a single slow
 * route does — coverage protection is meant to matter, not be a rounding
 * error next to the ETA term.
 */
const PROTECTION_DEGRADATION_CAP_SECONDS = 300;

function degradationToProtectionScore(meanEtaDeltaSeconds: number): number {
  const clampedDelta = Math.min(PROTECTION_DEGRADATION_CAP_SECONDS, Math.max(0, meanEtaDeltaSeconds));
  return Math.round(100 - (clampedDelta / PROTECTION_DEGRADATION_CAP_SECONDS) * 100);
}

/**
 * Computes, for every candidate unit, what happens to coverage of the
 * supplied grid if that unit becomes unavailable (i.e. gets dispatched) —
 * the "post-dispatch coverage protection" term spec 29.4's Dispatch Score
 * needs. A unit whose removal barely changes coverage (other units nearby
 * cover the same ground) protects coverage well; a unit that is the ONLY
 * fast responder for some cell protects coverage poorly, even if it is
 * itself the fastest unit to the incident — this is exactly spec 29.9
 * acceptance test 6's "the fastest unit that harms coverage may lose to
 * the alternative".
 */
export async function computeCoverageProtection(input: ComputeCoverageMetricsInput): Promise<CoverageProtectionResult> {
  const { units } = input;
  if (units.length < 2) {
    // With 0 or 1 units, "coverage after removing this unit" is either
    // undefined or means "no units left" — computeCoverageMetrics()
    // itself throws NoUnitsForCoverageError in that case, which is the
    // correct signal here too rather than a silently-meaningless score.
    throw new NoUnitsForCoverageError();
  }

  const baseline = await computeCoverageMetrics(input);

  const perUnit: CoverageProtectionResult['perUnit'] = {};
  for (const unit of units) {
    const remainingUnits = units.filter((u) => u.id !== unit.id);
    const withoutUnit = await computeCoverageMetrics({ ...input, units: remainingUnits });
    const meanEtaDeltaSeconds = withoutUnit.meanEtaSeconds - baseline.meanEtaSeconds;
    perUnit[unit.id] = {
      withoutUnit,
      meanEtaDeltaSeconds,
      protectionScore: degradationToProtectionScore(meanEtaDeltaSeconds),
    };
  }

  return { baseline, perUnit };
}
