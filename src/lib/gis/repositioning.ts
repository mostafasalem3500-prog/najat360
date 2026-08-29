/**
 * Proactive repositioning hotspots — reads the SAME two already-computed
 * signals `generate-coverage-recommendation.ts` uses per-incident
 * (coverage.ts's per-cell ETA/gap classification, and demand-baseline.ts's
 * H3Prediction rows) but asks a different, incident-INDEPENDENT question:
 * "right now, with the fleet parked where it is, which cells are both a
 * coverage gap AND predicted to need units soon?" — spec's "التمركز
 * والتوزيع" (positioning & distribution) concern, not the "which unit do I
 * send to THIS incident" concern C6 already covers.
 *
 * Pure computation over data the caller supplies — no I/O, same shape as
 * coverage.ts and access-score.ts. Deliberately does NOT pick which idle
 * unit should move and does NOT write anything: same "explain, don't
 * silently decide" posture as lib/dispatch/explain.ts and
 * lib/location/explain.ts. It surfaces `nearestUnitId` only as the
 * reference point a supervisor would start from (the unit already
 * fastest to that cell, even though "fastest" here still means slower
 * than the gap threshold) — moving THAT specific unit has tradeoffs
 * (it may itself be protecting coverage elsewhere) this module has no way
 * to judge, so it is presented as a hotspot to consider, not an order.
 */
import { computeCoverageMetrics, type CellCoverageResult, type CoverageCellInput } from './coverage';
import { haversineDistanceMeters, type LatLng } from '@/lib/geo';
import type { RoutingProvider } from '@/lib/routing/provider';

export interface AreaDemand {
  predictedDemand: number;
  recommendedUnits: number;
}

export interface RepositioningHotspot {
  h3Index: string;
  etaSeconds: number;
  predictedDemand: number;
  recommendedUnits: number;
  /** The unit currently fastest to this cell — a reference point, not a directive; see module header. */
  nearestUnitId: string;
  reasoning: string[];
}

export interface ComputeRepositioningHotspotsInput {
  /** From CoverageMetrics.cells (coverage.ts) — already computed for the live fleet/grid. */
  cells: CellCoverageResult[];
  /** Keyed by h3Index — from H3Prediction, same source generate-coverage-recommendation.ts's areaDemand uses. Cells with no row (no prediction yet) are excluded, not assumed zero-demand. */
  demandByCell: Record<string, AreaDemand>;
  /** Cap on how many hotspots to surface — a long list stops being "look at these first" and starts being noise. */
  maxResults?: number;
}

const DEFAULT_MAX_RESULTS = 5;

/**
 * Returns coverage-gap cells that ALSO have a predicted-demand row calling
 * for at least 1 recommended unit, ranked worst-first by
 * (recommendedUnits desc, then etaSeconds desc) — a cell the demand model
 * says needs 3 units and is currently an 11-minute gap outranks a cell
 * that needs 1 unit and is a 9-minute gap. Cells with no demand
 * prediction, or that are not gaps at all, are excluded entirely: this is
 * a "these specific spots need attention" list, not a full grid dump.
 */
export function computeRepositioningHotspots(input: ComputeRepositioningHotspotsInput): RepositioningHotspot[] {
  const { cells, demandByCell } = input;
  const maxResults = input.maxResults ?? DEFAULT_MAX_RESULTS;

  const hotspots: RepositioningHotspot[] = cells
    .filter((cell) => cell.isGap)
    .map((cell) => ({ cell, demand: demandByCell[cell.h3Index] }))
    .filter((x): x is { cell: CellCoverageResult; demand: AreaDemand } => Boolean(x.demand) && x.demand!.recommendedUnits >= 1)
    .sort((a, b) => b.demand.recommendedUnits - a.demand.recommendedUnits || b.cell.minEtaSeconds - a.cell.minEtaSeconds)
    .slice(0, maxResults)
    .map(({ cell, demand }) => {
      const etaMinutes = Math.round(cell.minEtaSeconds / 60);
      const reasoning = [
        `فجوة تغطية حالية: أقرب وحدة (${cell.nearestUnitId}) على بُعد ~${etaMinutes} دقيقة.`,
        `الطلب المتوقع لهذه الخلية يوصي بـ ${demand.recommendedUnits} وحدة (معدل متوقع ${demand.predictedDemand.toFixed(1)}).`,
        'هذه إشارة للنظر في إعادة تمركز وحدة جاهزة نحو هذه المنطقة — القرار النهائي بيد المشرف.',
      ];
      return {
        h3Index: cell.h3Index,
        etaSeconds: cell.minEtaSeconds,
        predictedDemand: demand.predictedDemand,
        recommendedUnits: demand.recommendedUnits,
        nearestUnitId: cell.nearestUnitId,
        reasoning,
      };
    });

  return hotspots;
}

// ---------------------------------------------------------------------------
// optimizeRepositioning — a specific "move THIS unit to THIS cell" candidate,
// one step further than computeRepositioningHotspots() above (which only
// names the problem cells, not what to do about them).
// ---------------------------------------------------------------------------

export const REPOSITIONING_OPTIMIZER_VERSION = 'najat360.repositioning-optimizer.v1';

export interface OptimizeRepositioningUnit {
  id: string;
  location: LatLng;
}

export interface RepositionCandidate {
  unitId: string;
  fromLocation: LatLng;
  targetH3Index: string;
  targetLocation: LatLng;
  relocationDistanceMeters: number;
  /** How much the weighted coverage objective improves, net of a relocation-distance penalty — see coverageObjective()'s own comment for the weights. Always >= the configured minGainSeconds for a RECOMMENDED plan. */
  expectedGainSeconds: number;
  before: { meanEtaSeconds: number; gapCellCount: number };
  after: { meanEtaSeconds: number; gapCellCount: number };
  reasoning: string[];
  /** Always true — this is a candidate for a supervisor to approve or dismiss, never an instruction this codebase carries out itself. Same posture as computeRepositioningHotspots() above and every *-explain.ts module. */
  requiresHumanApproval: true;
}

export interface RepositionPlan {
  status: 'RECOMMENDED' | 'ABSTAINED';
  recommendation: RepositionCandidate | null;
  baselineGapCellCount: number;
  evaluatedCandidates: number;
  abstentionReasons: string[];
  algorithmVersion: typeof REPOSITIONING_OPTIMIZER_VERSION;
}

export interface OptimizeRepositioningOptions {
  gapThresholdSeconds?: number;
  /** Minimum net gain (post relocation-penalty) for a candidate to be worth proposing — a 3-second improvement isn't worth asking a crew to move. */
  minGainSeconds?: number;
  /** Below this, the unit is already essentially at the target cell — not a real repositioning. */
  minRelocationMeters?: number;
  maxRelocationMeters?: number;
  /** A candidate that improves the average but makes the single worst cell meaningfully slower is rejected even if its net score looks good — same "don't trade a systemic win for a new single point of failure" instinct as coverage.ts's own protection scoring. */
  maxWorstEtaIncreaseSeconds?: number;
  /** Caps how many (unit, targetCell) combinations get a full computeCoverageMetrics() simulation — each one is a real routing-matrix call, so this bounds cost/latency regardless of fleet size or which RoutingProvider is active (mock or a real, possibly-HTTP one behind ROUTING_PROVIDER=arcgis). */
  maxUnitsEvaluated?: number;
  maxTargetCells?: number;
}

const DEFAULT_MIN_GAIN_SECONDS = 8;
const DEFAULT_MIN_RELOCATION_METERS = 150;
const DEFAULT_MAX_RELOCATION_METERS = 6000;
const DEFAULT_MAX_WORST_ETA_INCREASE_SECONDS = 45;
const DEFAULT_MAX_UNITS_EVALUATED = 6;
const DEFAULT_MAX_TARGET_CELLS = 4;
/** Same assumed vehicle speed as mock-provider.ts's own ASSUMED_SPEED_MPS.VEHICLE — used only to convert a relocation DISTANCE into a time PENALTY for the objective function below, not as an ETA estimate in its own right. */
const RELOCATION_ASSUMED_SPEED_MPS = 11.11;
/** How harshly a relocation's own travel time counts against its coverage gain — 0.02 means "treat 1 second of driving to get there as costing 0.02 objective-seconds", low enough that a real, large coverage improvement still wins, high enough that two near-tied candidates prefer the shorter move. This project's own tuning choice, not derived from any spec value. */
const RELOCATION_PENALTY_WEIGHT = 0.02;

/**
 * Same three coverage.ts metrics computeRepositioningHotspots() already
 * uses individually, combined into one scalar so candidate moves can be
 * ranked — mean ETA (overall responsiveness), P90 (the routine-bad-case
 * tail), and gap-cell count weighted heavily (120 "seconds" per gap cell:
 * a cell crossing the gap threshold matters more than a few seconds of
 * mean ETA drift). Weights are this project's own choice; nothing here is
 * spec-mandated beyond "show before/after", same disclaimer as
 * coverage.ts's own header.
 */
function coverageObjective(m: { meanEtaSeconds: number; p90EtaSeconds: number; worstCell: { etaSeconds: number }; gapCellCount: number }): number {
  return m.meanEtaSeconds * 0.45 + m.p90EtaSeconds * 0.35 + m.worstCell.etaSeconds * 0.2 + m.gapCellCount * 120;
}

/**
 * Simulates moving ONE available unit to ONE demand hotspot at a time (never
 * more than one — a plan a supervisor can sanity-check in a glance, not a
 * whole-fleet reshuffle) and proposes the single best candidate, if any
 * clears every safety bar below. Every candidate is evaluated with a REAL
 * computeCoverageMetrics() call — this is simulation, not a guess: "would
 * coverage actually be better" is measured, not assumed.
 *
 * A candidate is only proposed if, compared to the current baseline:
 *   - it does not increase the number of coverage-gap cells;
 *   - it does not push the single worst cell's ETA up by more than
 *     `maxWorstEtaIncreaseSeconds`;
 *   - its net gain (objective improvement minus a relocation-distance
 *     penalty) clears `minGainSeconds`.
 * Otherwise the plan is ABSTAINED with a reason — same "silence is a valid
 * answer" discipline as decideDispatch()'s NoAvailableUnitsForRecommendationError
 * and computeRepositioningHotspots()'s empty-array default. Every returned
 * candidate carries `requiresHumanApproval: true`: this function proposes,
 * it never moves anything itself and this codebase has no "confirm this
 * repositioning" write path — that is a deliberate scope boundary, not an
 * oversight.
 */
export async function optimizeRepositioning(input: {
  cells: CoverageCellInput[];
  units: OptimizeRepositioningUnit[];
  demandByCell: Record<string, AreaDemand>;
  routingProvider: RoutingProvider;
  options?: OptimizeRepositioningOptions;
}): Promise<RepositionPlan> {
  const { cells, demandByCell, routingProvider } = input;
  const options = input.options ?? {};
  const gapThresholdSeconds = options.gapThresholdSeconds;
  const minGainSeconds = options.minGainSeconds ?? DEFAULT_MIN_GAIN_SECONDS;
  const minRelocationMeters = options.minRelocationMeters ?? DEFAULT_MIN_RELOCATION_METERS;
  const maxRelocationMeters = options.maxRelocationMeters ?? DEFAULT_MAX_RELOCATION_METERS;
  const maxWorstEtaIncreaseSeconds = options.maxWorstEtaIncreaseSeconds ?? DEFAULT_MAX_WORST_ETA_INCREASE_SECONDS;
  const units = input.units.slice(0, options.maxUnitsEvaluated ?? DEFAULT_MAX_UNITS_EVALUATED);

  if (units.length < 2 || cells.length === 0) {
    return {
      status: 'ABSTAINED',
      recommendation: null,
      baselineGapCellCount: 0,
      evaluatedCandidates: 0,
      abstentionReasons: [cells.length === 0 ? 'NO_COVERAGE_CELLS' : 'INSUFFICIENT_AVAILABLE_UNITS'],
      algorithmVersion: REPOSITIONING_OPTIMIZER_VERSION,
    };
  }

  const baseline = await computeCoverageMetrics({ cells, units, routingProvider, gapThresholdSeconds });

  const targetCells = cells
    .map((cell) => ({ cell, demand: demandByCell[cell.h3Index] }))
    .filter((x): x is { cell: CoverageCellInput; demand: AreaDemand } => Boolean(x.demand) && x.demand!.recommendedUnits >= 1)
    .sort((a, b) => b.demand.recommendedUnits - a.demand.recommendedUnits || b.demand.predictedDemand - a.demand.predictedDemand)
    .slice(0, options.maxTargetCells ?? DEFAULT_MAX_TARGET_CELLS);

  if (targetCells.length === 0) {
    return {
      status: 'ABSTAINED',
      recommendation: null,
      baselineGapCellCount: baseline.gapCellCount,
      evaluatedCandidates: 0,
      abstentionReasons: ['NO_DEMAND_HOTSPOTS'],
      algorithmVersion: REPOSITIONING_OPTIMIZER_VERSION,
    };
  }

  const baselineObjective = coverageObjective(baseline);
  let evaluatedCandidates = 0;
  let best: RepositionCandidate | null = null;

  for (const unit of units) {
    for (const { cell: target, demand } of targetCells) {
      const relocationDistanceMeters = Math.round(haversineDistanceMeters(unit.location, target.center));
      if (relocationDistanceMeters < minRelocationMeters || relocationDistanceMeters > maxRelocationMeters) continue;

      const movedUnits = units.map((u) => (u.id === unit.id ? { ...u, location: target.center } : u));
      const after = await computeCoverageMetrics({ cells, units: movedUnits, routingProvider, gapThresholdSeconds });
      evaluatedCandidates += 1;

      if (after.gapCellCount > baseline.gapCellCount) continue;
      if (after.worstCell.etaSeconds > baseline.worstCell.etaSeconds + maxWorstEtaIncreaseSeconds) continue;

      const relocationPenaltySeconds = (relocationDistanceMeters / RELOCATION_ASSUMED_SPEED_MPS) * RELOCATION_PENALTY_WEIGHT;
      const expectedGainSeconds = Math.round(baselineObjective - coverageObjective(after) - relocationPenaltySeconds);
      if (expectedGainSeconds < minGainSeconds) continue;

      if (!best || expectedGainSeconds > best.expectedGainSeconds) {
        best = {
          unitId: unit.id,
          fromLocation: unit.location,
          targetH3Index: target.h3Index,
          targetLocation: target.center,
          relocationDistanceMeters,
          expectedGainSeconds,
          before: { meanEtaSeconds: baseline.meanEtaSeconds, gapCellCount: baseline.gapCellCount },
          after: { meanEtaSeconds: after.meanEtaSeconds, gapCellCount: after.gapCellCount },
          reasoning: [
            `نقل هذه الوحدة يحسّن مؤشر التغطية الموزون بنحو ${expectedGainSeconds} ثانية بعد خصم زمن الانتقال.`,
            `الطلب المتوقع في الخلية الهدف ${demand.predictedDemand.toFixed(1)} (موصى بـ ${demand.recommendedUnits} وحدة).`,
            `لا يزيد عدد خلايا فجوة التغطية (${baseline.gapCellCount} → ${after.gapCellCount}) ولا وقت أسوأ خلية بأكثر من ${Math.round(maxWorstEtaIncreaseSeconds / 60 * 10) / 10} دقيقة.`,
            'هذا اقتراح للنظر فيه فقط — لا يُنفَّذ أي نقل تلقائيًا؛ القرار والتنفيذ بيد المشرف.',
          ],
          requiresHumanApproval: true,
        };
      }
    }
  }

  if (!best) {
    return {
      status: 'ABSTAINED',
      recommendation: null,
      baselineGapCellCount: baseline.gapCellCount,
      evaluatedCandidates,
      abstentionReasons: ['NO_SAFE_MATERIAL_GAIN'],
      algorithmVersion: REPOSITIONING_OPTIMIZER_VERSION,
    };
  }

  return {
    status: 'RECOMMENDED',
    recommendation: best,
    baselineGapCellCount: baseline.gapCellCount,
    evaluatedCandidates,
    abstentionReasons: [],
    algorithmVersion: REPOSITIONING_OPTIMIZER_VERSION,
  };
}
