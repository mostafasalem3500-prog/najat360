/**
 * resolveLocation() — spec 29.2's "دمج مصادر الموقع" (merge location
 * sources). Pure, synchronous, no I/O: takes every `LocationObservation`
 * gathered for an incident so far plus the candidate `Entrance` rows to
 * consider, and returns a single best-estimate `LocationResolution`
 * snapshot. Never mutates its inputs and never touches a database —
 * callers persist the returned value as a NEW row (see this module's
 * header note on append-only history, and prisma's LocationResolution
 * doc comment).
 *
 * Two hard rules from spec 29.2 this function's OUTPUT shape exists to
 * satisfy, even though enforcing them is really the caller's job:
 *   1. A QR-vs-GPS (or any source-vs-source) conflict must be SHOWN to the
 *      call-taker, never silently resolved. This function never drops a
 *      conflicting observation — `conflictingObservationIds` and
 *      `hasConflict` are always populated so a caller cannot accidentally
 *      persist a resolution that hides disagreement. The uncertainty
 *      radius is deliberately WIDENED to cover a conflicting point rather
 *      than left artificially tight.
 *   2. `confidenceIndex` is spec line 659's "Location Confidence Index" —
 *      an operational indicator, not a probability — computed by the same
 *      `computeLocationConfidence()` engine C1 built for spec section 14,
 *      not a second, competing confidence concept.
 *
 * Design choices NOT mandated by spec (documented here since spec 29.2
 * does not specify an algorithm, only the data model and rules above):
 *   - Source priority ranking, used to pick the "primary" observation
 *     among several: ANCHOR_QR > MANUAL_PIN > CALL_TAKER > NATIONAL_ADDRESS
 *     > LANDMARK > BROWSER_GPS > WHAT3WORDS_OPTIONAL. ANCHOR_QR ranks
 *     highest because it is a server-verified physical point (see
 *     anchor-resolution.ts), not a raw device reading that could be
 *     spoofed or simply inaccurate.
 *   - A 60m "conflict distance" threshold: another observation within 60m
 *     of the primary counts as supporting; beyond that, conflicting.
 *   - A 150m entrance-selection radius.
 *   - `roadPlausibility` is a fixed demo heuristic (70, lowered to 40 on
 *     conflict), explicitly self-labeled `ROAD_PLAUSIBILITY:DEMO_HEURISTIC_NOT_LIVE_ROUTING`
 *     in the `reasoning` output — there is no live routing/road-network
 *     provider in this phase, and pretending otherwise would be a false
 *     precision claim. A future RoutingProvider integration is a visible
 *     diff against this exact reasoning tag.
 */
import { computeLocationConfidence, type ConfidenceBand } from '@/lib/confidence';
import { haversineDistanceMeters, type LatLng } from '@/lib/geo';
import type { LocationObservationSource } from '@/lib/domain/types';

export const LOCATION_RESOLVER_VERSION = 'location-resolver-v1';

const CONFLICT_DISTANCE_METERS = 60;
const ENTRANCE_SELECTION_RADIUS_METERS = 150;
/**
 * A resolution whose PRIMARY observation is older than this is flagged
 * `isStale` so the operations UI can prompt a re-capture on a long-running
 * incident, independent of `dataFreshness`'s smooth 2-30 minute scoring
 * curve (see `freshnessToScore` below) — a slow-decaying score never
 * crosses a hard line an operator can act on, so this is a second, blunt
 * signal specifically for "should I ask the caller to re-share location".
 */
export const STALE_THRESHOLD_MINUTES = 15;

const SOURCE_PRIORITY: Record<LocationObservationSource, number> = {
  ANCHOR_QR: 7,
  MANUAL_PIN: 6,
  CALL_TAKER: 5,
  NATIONAL_ADDRESS: 4,
  LANDMARK: 3,
  BROWSER_GPS: 2,
  WHAT3WORDS_OPTIONAL: 1,
};

/** Used only when an observation did not record its own `horizontalAccuracyMeters` — a source-typical fallback, not a claim about any specific reading. */
const DEFAULT_ACCURACY_METERS_BY_SOURCE: Record<LocationObservationSource, number> = {
  ANCHOR_QR: 3,
  MANUAL_PIN: 15,
  CALL_TAKER: 25,
  NATIONAL_ADDRESS: 50,
  LANDMARK: 80,
  BROWSER_GPS: 30,
  WHAT3WORDS_OPTIONAL: 3,
};

const CALLER_CONFIRMATION_SCORE: Record<LocationObservationSource, number> = {
  ANCHOR_QR: 95,
  MANUAL_PIN: 90,
  CALL_TAKER: 80,
  NATIONAL_ADDRESS: 55,
  LANDMARK: 55,
  BROWSER_GPS: 50,
  WHAT3WORDS_OPTIONAL: 50,
};

export interface ObservationForResolution extends LatLng {
  id: string;
  source: LocationObservationSource;
  horizontalAccuracyMeters?: number | null;
  floorLevel?: string | null;
  capturedAt: Date;
}

export interface EntranceCandidate extends LatLng {
  id: string;
}

export interface ResolveLocationInput {
  /** At least one required — throws otherwise. */
  observations: ObservationForResolution[];
  entrances?: EntranceCandidate[];
  /** Passed in explicitly, never read from `Date.now()` internally, so this function stays deterministic/testable like every other pure function in this codebase (state-machine.ts, confidence.ts). */
  now: Date;
}

export interface ResolveLocationResult {
  latitude: number;
  longitude: number;
  uncertaintyRadiusMeters: number;
  confidenceIndex: number;
  confidenceBand: ConfidenceBand;
  primaryObservationId: string;
  supportingObservationIds: string[];
  conflictingObservationIds: string[];
  /** Distance in meters from the primary observation, keyed by observation id — covers BOTH supporting and conflicting ids, so a UI can show "٤٥ م" next to a supporting source too, not just flag conflicts as a bare boolean. */
  distanceFromPrimaryMeters: Record<string, number>;
  hasConflict: boolean;
  /** True when the PRIMARY observation is older than STALE_THRESHOLD_MINUTES — see that constant's doc comment. */
  isStale: boolean;
  ageMinutes: number;
  selectedEntranceId?: string;
  floorLevel?: string;
  algorithmVersion: string;
  /** Machine-readable tags recording why this resolution came out the way it did — e.g. `PRIMARY_SOURCE:ANCHOR_QR`, `SOURCE_CONFLICT:1`, `ENTRANCE_SELECTED:ent-04`. Meant for an audit/debug view, not end-user display text. */
  reasoning: string[];
}

function effectiveAccuracyMeters(obs: ObservationForResolution): number {
  if (obs.horizontalAccuracyMeters != null && obs.horizontalAccuracyMeters > 0) {
    return obs.horizontalAccuracyMeters;
  }
  return DEFAULT_ACCURACY_METERS_BY_SOURCE[obs.source];
}

function accuracyToScore(meters: number): number {
  const clamped = Math.min(50, Math.max(0, meters));
  return Math.round(100 - (clamped / 50) * 100);
}

function proximityToScore(meters: number, maxMeters: number): number {
  const clamped = Math.min(maxMeters, Math.max(0, meters));
  return Math.round(100 - (clamped / maxMeters) * 100);
}

function freshnessToScore(ageMs: number): number {
  const ageMinutes = Math.max(0, ageMs) / 60_000;
  const clamped = Math.min(30, Math.max(2, ageMinutes));
  return Math.round(100 - ((clamped - 2) / 28) * 100);
}

export function resolveLocation(input: ResolveLocationInput): ResolveLocationResult {
  const { observations, entrances = [], now } = input;
  if (observations.length === 0) {
    throw new Error('resolveLocation: at least one observation is required');
  }

  const reasoning: string[] = [];

  const sorted = [...observations].sort((a, b) => {
    const priorityDiff = SOURCE_PRIORITY[b.source] - SOURCE_PRIORITY[a.source];
    if (priorityDiff !== 0) return priorityDiff;
    return b.capturedAt.getTime() - a.capturedAt.getTime();
  });
  const primary = sorted[0]!;
  reasoning.push(`PRIMARY_SOURCE:${primary.source}`);

  const others = observations.filter((o) => o.id !== primary.id);
  const distanceById = new Map(others.map((o) => [o.id, haversineDistanceMeters(primary, o)]));

  const supporting: string[] = [];
  const conflicting: string[] = [];
  for (const obs of others) {
    const distance = distanceById.get(obs.id)!;
    if (distance <= CONFLICT_DISTANCE_METERS) {
      supporting.push(obs.id);
    } else {
      conflicting.push(obs.id);
    }
  }
  const hasConflict = conflicting.length > 0;
  if (hasConflict) {
    reasoning.push(`SOURCE_CONFLICT:${conflicting.length}`);
  }
  const distanceFromPrimaryMeters: Record<string, number> = {};
  for (const [id, distance] of distanceById) {
    distanceFromPrimaryMeters[id] = Math.round(distance);
  }

  const ageMinutes = Math.max(0, now.getTime() - primary.capturedAt.getTime()) / 60_000;
  const isStale = ageMinutes > STALE_THRESHOLD_MINUTES;
  if (isStale) {
    reasoning.push(`STALE:${Math.round(ageMinutes)}min`);
  }

  let uncertaintyRadiusMeters = effectiveAccuracyMeters(primary);
  if (hasConflict) {
    const farthestConflict = Math.max(...conflicting.map((id) => distanceById.get(id)!));
    uncertaintyRadiusMeters = Math.max(uncertaintyRadiusMeters, farthestConflict);
  }

  let selectedEntranceId: string | undefined;
  let nearestEntranceDistance = Infinity;
  for (const entrance of entrances) {
    const distance = haversineDistanceMeters(primary, entrance);
    if (distance <= ENTRANCE_SELECTION_RADIUS_METERS && distance < nearestEntranceDistance) {
      nearestEntranceDistance = distance;
      selectedEntranceId = entrance.id;
    }
  }
  reasoning.push(selectedEntranceId ? `ENTRANCE_SELECTED:${selectedEntranceId}` : 'NO_ENTRANCE_WITHIN_RANGE');

  let floorLevel = primary.floorLevel ?? undefined;
  if (!floorLevel) {
    const supportingWithFloor = others.find((o) => supporting.includes(o.id) && o.floorLevel);
    floorLevel = supportingWithFloor?.floorLevel ?? undefined;
  }
  if (floorLevel) {
    reasoning.push(`FLOOR:${floorLevel}`);
  }

  reasoning.push('ROAD_PLAUSIBILITY:DEMO_HEURISTIC_NOT_LIVE_ROUTING');
  const confidence = computeLocationConfidence({
    gpsAccuracy: accuracyToScore(effectiveAccuracyMeters(primary)),
    roadPlausibility: hasConflict ? 40 : 70,
    entranceProximity: selectedEntranceId
      ? proximityToScore(nearestEntranceDistance, ENTRANCE_SELECTION_RADIUS_METERS)
      : 0,
    callerConfirmation: CALLER_CONFIRMATION_SCORE[primary.source],
    landmarkEvidence: observations.some((o) => o.source === 'LANDMARK') ? 70 : undefined,
    dataFreshness: freshnessToScore(now.getTime() - primary.capturedAt.getTime()),
  });

  return {
    latitude: primary.latitude,
    longitude: primary.longitude,
    uncertaintyRadiusMeters: Math.round(uncertaintyRadiusMeters),
    confidenceIndex: confidence.score,
    confidenceBand: confidence.band,
    primaryObservationId: primary.id,
    supportingObservationIds: supporting,
    conflictingObservationIds: conflicting,
    distanceFromPrimaryMeters,
    hasConflict,
    isStale,
    ageMinutes: Math.round(ageMinutes),
    selectedEntranceId,
    floorLevel,
    algorithmVersion: LOCATION_RESOLVER_VERSION,
    reasoning,
  };
}
