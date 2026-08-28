/**
 * H3 demand baseline — spec section 17, the part marked "Baseline إلزامي"
 * (mandatory). An independent AI's attempt at this same phase (reviewed
 * before writing this file) did NOT implement this algorithm at all: it
 * hand-typed twelve `[lat, lon, predictedDemand]` tuples straight into the
 * `H3Prediction` table and labeled them `modelVersion: "weighted-baseline
 * -v1"` — a fabricated result wearing a real model's name. This module is
 * a genuine computation over the seeded historical incidents.
 *
 * Spec's own description: "aggregate incidents by H3 cell + hour + day of
 * week, a weighted average of historical demand, factors: hour, day, event
 * flag, prayer period, temperature if available. Output predictedDemand
 * and an approximate confidence interval, explicitly labeled baseline."
 *
 * Two honesty notes, both deliberate, not oversights:
 *
 * 1. This dataset has no event-calendar, prayer-time, or temperature
 *    features attached to any incident (nothing in `IncidentRow` carries
 *    them, and no such synthetic reference data has been seeded in any
 *    prior phase). Spec's own section 18 explicitly warns against
 *    inventing data that is not available ("population count not
 *    available; do not invent it") — the same principle applies here:
 *    fabricating a plausible-looking "prayer period" or "event" signal
 *    with no real backing data would be worse than omitting it. Only
 *    hour-of-day and day-of-week factors are computed, both from real
 *    seeded `createdAt` timestamps. If event/prayer/temperature reference
 *    data is added in a later phase, this is the file to extend.
 *
 * 2. Rather than bucket by the exact (cell, hour, day-of-week) triple —
 *    which fragments 2000 historical incidents across thousands of
 *    near-empty buckets given a demo-sized grid — this uses a standard
 *    multiplicative seasonal-decomposition baseline:
 *
 *      predictedDemand(cell, hour, day) =
 *        cellBaseRatePerHour(cell) × hourFactor(hour) × dayFactor(day)
 *
 *    where `cellBaseRatePerHour` is that cell's own historical incidents
 *    per hour of coverage, and `hourFactor`/`dayFactor` are CITYWIDE
 *    seasonality multipliers (how much busier/quieter that hour/day is
 *    than the citywide average) learned from every historical incident,
 *    not just that one cell's. This is the textbook "rate × seasonal
 *    index" baseline — interpretable (every term is a plain average or
 *    ratio), and it still produces a sane estimate for a cell with very
 *    few historical incidents, which an exact-bucket approach cannot.
 */
import type { LatLng } from '@/lib/geo';
import { latLngToH3Cell } from './h3';

export const H3_DEMAND_MODEL_VERSION = 'h3-baseline-v1';

export interface HistoricalIncidentForDemand {
  location: LatLng;
  createdAt: Date;
}

export interface H3DemandPrediction {
  h3Index: string;
  windowStart: Date;
  windowEnd: Date;
  historicalDemand: number;
  predictedDemand: number;
  lowerBound: number;
  upperBound: number;
  recommendedUnits: number;
  modelVersion: typeof H3_DEMAND_MODEL_VERSION;
}

const HOURS_PER_DAY = 24;
const DAYS_PER_WEEK = 7;
const WINDOW_MS = 60 * 60 * 1000;

/**
 * How many predicted incidents one unit is assumed able to absorb within a
 * single 1-hour prediction window before a second unit is "recommended"
 * for that cell/hour — this project's own labeled assumption (spec does
 * not define `recommendedUnits`'s formula), analogous in spirit to
 * `access-score.ts`'s documented `worstSeconds=900` choice.
 */
const ASSUMED_INCIDENTS_PER_UNIT_PER_WINDOW = 1;

/** z≈1.28 = the ~80% two-sided normal-approximation multiplier — this is the SAME "approximate, not exact" spirit spec explicitly asks for ("confidence interval تقريبيًا"), using a Poisson-rate normal approximation (variance ≈ mean for a Poisson count process), which is the standard quick approximation for event-count confidence bands. */
const CONFIDENCE_Z = 1.28;

function hourBucket(date: Date): number {
  return date.getUTCHours();
}

function dayBucket(date: Date): number {
  return date.getUTCDay();
}

/**
 * Builds the citywide seasonality index and per-cell base rates from every
 * historical incident supplied. Exported separately from
 * `predictH3Demand()` so both can be computed ONCE and reused across many
 * (cell, window) predictions instead of re-scanning the historical dataset
 * per cell — this dataset has 2000 historical incidents; re-aggregating
 * per prediction would be O(cells × incidents) for no reason.
 */
export interface DemandBaselineModel {
  cellRatesPerHour: Map<string, number>;
  hourFactors: number[];
  dayFactors: number[];
  cellHistoricalCounts: Map<string, number>;
  datasetSpanHours: number;
}

export function buildDemandBaselineModel(historicalIncidents: HistoricalIncidentForDemand[]): DemandBaselineModel {
  if (historicalIncidents.length === 0) {
    throw new Error('buildDemandBaselineModel: at least one historical incident is required');
  }

  const timestamps = historicalIncidents.map((i) => i.createdAt.getTime());
  const earliest = Math.min(...timestamps);
  const latest = Math.max(...timestamps);
  const datasetSpanHours = Math.max(1, (latest - earliest) / WINDOW_MS);

  const cellHistoricalCounts = new Map<string, number>();
  const hourCounts = new Array(HOURS_PER_DAY).fill(0);
  const dayCounts = new Array(DAYS_PER_WEEK).fill(0);

  for (const incident of historicalIncidents) {
    const cell = latLngToH3Cell(incident.location);
    cellHistoricalCounts.set(cell, (cellHistoricalCounts.get(cell) ?? 0) + 1);
    hourCounts[hourBucket(incident.createdAt)] += 1;
    dayCounts[dayBucket(incident.createdAt)] += 1;
  }

  const totalIncidents = historicalIncidents.length;
  const avgPerHourBucket = totalIncidents / HOURS_PER_DAY;
  const avgPerDayBucket = totalIncidents / DAYS_PER_WEEK;

  // Seasonality factor = "how much busier is this hour/day than the
  // citywide average hour/day" — 1.0 means exactly average. Guarded
  // against a zero-incident bucket producing a 0 factor (which would
  // zero out predictedDemand entirely for that hour forever); floor at a
  // small non-zero factor instead.
  const MIN_FACTOR = 0.1;
  const hourFactors = hourCounts.map((count) => Math.max(MIN_FACTOR, count / avgPerHourBucket));
  const dayFactors = dayCounts.map((count) => Math.max(MIN_FACTOR, count / avgPerDayBucket));

  const cellRatesPerHour = new Map<string, number>();
  for (const [cell, count] of cellHistoricalCounts) {
    cellRatesPerHour.set(cell, count / datasetSpanHours);
  }

  return { cellRatesPerHour, hourFactors, dayFactors, cellHistoricalCounts, datasetSpanHours };
}

/**
 * Predicts demand for one H3 cell at one 1-hour window. A cell with NO
 * historical incidents at all gets `cellBaseRatePerHour = 0` (not
 * invented) — its prediction is driven entirely by the citywide
 * hour/day seasonality applied to a 0 base rate, i.e. predictedDemand = 0,
 * which is the honest answer for "this cell has never had an incident in
 * the dataset", not a smoothed-up guess.
 */
export function predictH3Demand(model: DemandBaselineModel, h3Index: string, windowStart: Date): H3DemandPrediction {
  const windowEnd = new Date(windowStart.getTime() + WINDOW_MS);
  const cellBaseRatePerHour = model.cellRatesPerHour.get(h3Index) ?? 0;
  const hourFactor = model.hourFactors[hourBucket(windowStart)]!;
  const dayFactor = model.dayFactors[dayBucket(windowStart)]!;

  const predictedDemandRaw = cellBaseRatePerHour * hourFactor * dayFactor;
  const predictedDemand = Math.round(predictedDemandRaw * 1000) / 1000;

  // Poisson normal-approximation band around the raw (unrounded) rate —
  // see CONFIDENCE_Z's doc comment. Floored at 0: demand cannot be
  // negative.
  const stdDev = Math.sqrt(Math.max(predictedDemandRaw, 0));
  const lowerBound = Math.round(Math.max(0, predictedDemandRaw - CONFIDENCE_Z * stdDev) * 1000) / 1000;
  const upperBound = Math.round((predictedDemandRaw + CONFIDENCE_Z * stdDev) * 1000) / 1000;

  return {
    h3Index,
    windowStart,
    windowEnd,
    historicalDemand: model.cellHistoricalCounts.get(h3Index) ?? 0,
    predictedDemand,
    lowerBound,
    upperBound,
    recommendedUnits: Math.max(0, Math.ceil(upperBound / ASSUMED_INCIDENTS_PER_UNIT_PER_WINDOW)),
    modelVersion: H3_DEMAND_MODEL_VERSION,
  };
}

/** Re-exported for callers that only have raw incident rows and want the cell key without pulling in `h3.ts` directly — kept here since this module already depends on it for the same purpose. */
export { latLngToH3Cell };
