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
import type { CellCoverageResult } from './coverage';

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
