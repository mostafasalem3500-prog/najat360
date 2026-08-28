/**
 * generateRecommendation() — spec section 4/15's "unit/entrance ranking" +
 * "recommendation card" for C4's supervisor-decision phase. Combines every
 * available unit against every candidate entrance (a small cross-product —
 * a handful of AVAILABLE units × a handful of nearby entrances, not a
 * citywide search), computes each pair's Access Score via a
 * `RoutingProvider` call, and returns the top pick plus two independent
 * "alternative" axes:
 *
 *   - `alternativeUnitId`: the next-best UNIT for the SAME recommended
 *     entrance — "if the top unit turns out unavailable, who's next for
 *     this same door".
 *   - `alternativeEntranceId`: the next-best ENTRANCE for the SAME
 *     recommended unit — "if this door turns out blocked, where else
 *     could this same unit go".
 *
 * Two independent fallback axes rather than one "second-best pair" is this
 * project's own interpretation of the spec ERD's
 * `alternativeUnitId`/`alternativeEntranceId` fields (spec gives the
 * fields but not a rule for exactly what "alternative" means when both a
 * unit AND an entrance can vary) — chosen because it is what a supervisor
 * actually needs operationally: two different kinds of "what if" answered
 * at once, not just a single runner-up pair.
 *
 * Does NOT touch a database or persist anything — like every other
 * decision-adjacent module in this codebase (`resolver.ts`, `state-machine.ts`),
 * this returns a plain result for the caller's repository layer to persist
 * inside a transaction alongside the `Recommendation` + `RouteSnapshot`
 * rows the spec's ERD calls for.
 */
import { computeAccessScore, dataAgeToFreshnessScore, etaSecondsToScore, ACCESS_SCORE_VERSION } from './access-score';
import { computeEntranceAccessibilityScore } from './entrance-accessibility';
import type { RoutingProvider, RoutingProviderMode } from '@/lib/routing/provider';
import type { LatLng } from '@/lib/geo';
import type { ValidationStatus } from '@/lib/domain/types';

export class NoAvailableUnitsError extends Error {
  constructor(public readonly incidentId: string) {
    super(`generateRecommendation: no available units supplied for incident "${incidentId}"`);
    this.name = 'NoAvailableUnitsError';
  }
}

export class NoCandidateEntrancesError extends Error {
  constructor(public readonly incidentId: string) {
    super(`generateRecommendation: no candidate entrances supplied for incident "${incidentId}"`);
    this.name = 'NoCandidateEntrancesError';
  }
}

export interface UnitCandidateInput {
  id: string;
  /** Caller MUST have already filtered this list to AVAILABLE units only — this function does not re-check status (that re-validation belongs at decision time; see `dispatch/decision.ts`). */
  readinessScore: number;
  location: LatLng;
}

export interface EntranceCandidateInput extends LatLng {
  id: string;
  vehicleStopLatitude?: number | null;
  vehicleStopLongitude?: number | null;
  active: boolean;
  validationStatus: ValidationStatus;
  vehicleAccessible: boolean;
  pedestrianAccessible: boolean;
  isServiceGate: boolean;
  temporaryRestriction?: string | null;
  floorLevel?: string | null;
  hasElevator: boolean;
}

export interface GenerateRecommendationInput {
  incidentId: string;
  locationConfidenceIndex: number;
  resolvedFloorLevel?: string | null;
  resolutionCreatedAt: Date;
  availableUnits: UnitCandidateInput[];
  candidateEntrances: EntranceCandidateInput[];
  routingProvider: RoutingProvider;
  now: Date;
}

export interface UnitEntranceRoute {
  unitId: string;
  entranceId: string;
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  vehicleGeometry: string;
  /** Non-null only when the entrance's `vehicleStop*` differs materially from the entrance's own coordinates — the pedestrian "last 100 meters" leg (spec 29.3). */
  pedestrianGeometry: string | null;
  provider: string;
  providerMode: RoutingProviderMode;
  dataFreshnessAt: Date;
}

export interface RankedCandidate {
  unitId: string;
  entranceId: string;
  score: number;
  breakdown: Record<string, number>;
  route: UnitEntranceRoute;
}

export interface GenerateRecommendationResult {
  algorithmVersion: string;
  recommendedUnitId: string;
  alternativeUnitId: string | null;
  recommendedEntranceId: string;
  alternativeEntranceId: string | null;
  accessScore: number;
  confidenceScore: number;
  reasoning: string[];
  routeSnapshots: UnitEntranceRoute[];
  candidates: RankedCandidate[];
}

/** Distance beyond which a vehicle-stop point is treated as a genuinely separate pedestrian leg rather than "close enough to be the same spot". */
const SAME_POINT_THRESHOLD_METERS = 10;

/**
 * Exported (not just module-private) so `generate-coverage-recommendation.ts`
 * (C6) can reuse the exact same route-computation logic — including the
 * pedestrian "last 100 meters" leg handling — instead of duplicating it.
 * Purely additive: this function's behavior is unchanged, only its
 * visibility.
 */
export async function computeUnitEntranceRoute(
  unit: UnitCandidateInput,
  entrance: EntranceCandidateInput,
  routingProvider: RoutingProvider
): Promise<UnitEntranceRoute> {
  const vehicleDestination: LatLng =
    entrance.vehicleStopLatitude != null && entrance.vehicleStopLongitude != null
      ? { latitude: entrance.vehicleStopLatitude, longitude: entrance.vehicleStopLongitude }
      : { latitude: entrance.latitude, longitude: entrance.longitude };

  const vehicleLeg = await routingProvider.route({ origin: unit.location, destination: vehicleDestination, mode: 'VEHICLE' });

  const needsPedestrianLeg =
    (entrance.vehicleStopLatitude != null || entrance.vehicleStopLongitude != null) &&
    (Math.abs(vehicleDestination.latitude - entrance.latitude) > 1e-9 ||
      Math.abs(vehicleDestination.longitude - entrance.longitude) > 1e-9);

  let pedestrianLeg: Awaited<ReturnType<RoutingProvider['route']>> | null = null;
  if (needsPedestrianLeg) {
    const leg = await routingProvider.route({
      origin: vehicleDestination,
      destination: { latitude: entrance.latitude, longitude: entrance.longitude },
      mode: 'PEDESTRIAN',
    });
    if (leg.distanceMeters > SAME_POINT_THRESHOLD_METERS) {
      pedestrianLeg = leg;
    }
  }

  return {
    unitId: unit.id,
    entranceId: entrance.id,
    totalDistanceMeters: vehicleLeg.distanceMeters + (pedestrianLeg?.distanceMeters ?? 0),
    totalDurationSeconds: vehicleLeg.durationSeconds + (pedestrianLeg?.durationSeconds ?? 0),
    vehicleGeometry: vehicleLeg.geometry,
    pedestrianGeometry: pedestrianLeg?.geometry ?? null,
    provider: vehicleLeg.provider,
    providerMode: vehicleLeg.providerMode,
    dataFreshnessAt: vehicleLeg.dataFreshnessAt,
  };
}

export async function generateRecommendation(input: GenerateRecommendationInput): Promise<GenerateRecommendationResult> {
  const { incidentId, locationConfidenceIndex, resolvedFloorLevel, resolutionCreatedAt, routingProvider, now } = input;

  if (input.availableUnits.length === 0) {
    throw new NoAvailableUnitsError(incidentId);
  }
  const activeEntrances = input.candidateEntrances.filter((e) => e.active);
  if (activeEntrances.length === 0) {
    throw new NoCandidateEntrancesError(incidentId);
  }

  const candidates: RankedCandidate[] = [];
  for (const entrance of activeEntrances) {
    const entranceAccessibility = computeEntranceAccessibilityScore({ entrance, resolvedFloorLevel });
    for (const unit of input.availableUnits) {
      const route = await computeUnitEntranceRoute(unit, entrance, routingProvider);
      const dataFreshness = dataAgeToFreshnessScore(
        Math.max(now.getTime() - route.dataFreshnessAt.getTime(), now.getTime() - resolutionCreatedAt.getTime())
      );
      const result = computeAccessScore({
        etaScore: etaSecondsToScore(route.totalDurationSeconds),
        entranceAccessibility,
        locationConfidence: locationConfidenceIndex,
        unitReadiness: unit.readinessScore,
        dataFreshness,
      });
      candidates.push({ unitId: unit.id, entranceId: entrance.id, score: result.score, breakdown: result.breakdown, route });
    }
  }

  // Spec 15: on a tie, ETA then readiness. readinessScore is looked up per
  // candidate's own unit for the tie-break (not carried on RankedCandidate
  // itself, since only the route/score need to survive as public shape).
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

  const reasoning: string[] = [
    `CANDIDATES_CONSIDERED:${candidates.length}`,
    `TOP_CANDIDATE:unit=${top.unitId},entrance=${top.entranceId},score=${top.score}`,
  ];
  if (alternativeUnitCandidate) reasoning.push(`ALTERNATIVE_UNIT:${alternativeUnitCandidate.unitId}`);
  if (alternativeEntranceCandidate) reasoning.push(`ALTERNATIVE_ENTRANCE:${alternativeEntranceCandidate.entranceId}`);

  return {
    algorithmVersion: ACCESS_SCORE_VERSION,
    recommendedUnitId: top.unitId,
    alternativeUnitId: alternativeUnitCandidate?.unitId ?? null,
    recommendedEntranceId: top.entranceId,
    alternativeEntranceId: alternativeEntranceCandidate?.entranceId ?? null,
    accessScore: top.score,
    confidenceScore: locationConfidenceIndex,
    reasoning,
    routeSnapshots: candidates.map((c) => c.route),
    candidates,
  };
}
