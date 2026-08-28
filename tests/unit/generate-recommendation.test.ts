import { describe, expect, it } from 'vitest';
import {
  generateRecommendation,
  NoAvailableUnitsError,
  NoCandidateEntrancesError,
  type EntranceCandidateInput,
  type GenerateRecommendationInput,
  type UnitCandidateInput,
} from '@/lib/dispatch/generate-recommendation';
import type { LatLng } from '@/lib/geo';
import type { MatrixResult, RouteInput, RouteResult, RoutingProvider } from '@/lib/routing/provider';
import type { ProviderHealth } from '@/lib/providers/health';

const NOW = new Date('2026-08-24T12:00:00.000Z');

interface FakeRouteSpec {
  durationSeconds: number;
  distanceMeters: number;
}

/** Fully-controlled fake RoutingProvider: every (origin, destination, mode) triple used by a test must be pre-registered, so a test can pin exact durations/distances rather than depending on real haversine geometry. */
class FakeRoutingProvider implements RoutingProvider {
  readonly name = 'fake-routing-provider';
  private readonly routes = new Map<string, FakeRouteSpec>();

  constructor(specs: Array<{ origin: LatLng; destination: LatLng; mode: 'VEHICLE' | 'PEDESTRIAN'; spec: FakeRouteSpec }>) {
    for (const { origin, destination, mode, spec } of specs) {
      this.routes.set(this.key(origin, destination, mode), spec);
    }
  }

  private key(origin: LatLng, destination: LatLng, mode: string): string {
    return `${origin.latitude},${origin.longitude}->${destination.latitude},${destination.longitude}:${mode}`;
  }

  async route(input: RouteInput): Promise<RouteResult> {
    const spec = this.routes.get(this.key(input.origin, input.destination, input.mode));
    if (!spec) {
      throw new Error(`FakeRoutingProvider: no route configured for ${JSON.stringify(input)}`);
    }
    return {
      distanceMeters: spec.distanceMeters,
      durationSeconds: spec.durationSeconds,
      geometry: '{}',
      provider: this.name,
      providerMode: 'MOCK',
      dataFreshnessAt: NOW,
    };
  }

  async matrix(): Promise<MatrixResult> {
    throw new Error('FakeRoutingProvider.matrix: not needed by generateRecommendation, not implemented');
  }

  async health(): Promise<ProviderHealth> {
    return { status: 'SIMULATED', provider: this.name };
  }
}

function entrance(overrides: Partial<EntranceCandidateInput> & { id: string; latitude: number; longitude: number }): EntranceCandidateInput {
  return {
    active: true,
    validationStatus: 'FIELD_CONFIRMED',
    vehicleAccessible: true,
    pedestrianAccessible: true,
    isServiceGate: false,
    temporaryRestriction: undefined,
    floorLevel: undefined,
    hasElevator: false,
    vehicleStopLatitude: undefined,
    vehicleStopLongitude: undefined,
    ...overrides,
  };
}

function unit(overrides: Partial<UnitCandidateInput> & { id: string; location: LatLng }): UnitCandidateInput {
  return { readinessScore: 80, ...overrides };
}

function baseInput(overrides: Partial<GenerateRecommendationInput>): GenerateRecommendationInput {
  return {
    incidentId: 'inc-1',
    locationConfidenceIndex: 100,
    resolvedFloorLevel: undefined,
    resolutionCreatedAt: NOW,
    availableUnits: [],
    candidateEntrances: [],
    routingProvider: new FakeRoutingProvider([]),
    now: NOW,
    ...overrides,
  };
}

describe('generateRecommendation', () => {
  it('throws NoAvailableUnitsError when no units are supplied', async () => {
    const input = baseInput({
      candidateEntrances: [entrance({ id: 'ent-1', latitude: 10, longitude: 10 })],
    });
    await expect(generateRecommendation(input)).rejects.toThrow(NoAvailableUnitsError);
  });

  it('throws NoCandidateEntrancesError when no entrances are supplied', async () => {
    const input = baseInput({
      availableUnits: [unit({ id: 'unit-1', location: { latitude: 1, longitude: 1 } })],
    });
    await expect(generateRecommendation(input)).rejects.toThrow(NoCandidateEntrancesError);
  });

  it('throws NoCandidateEntrancesError when every entrance is inactive (filtered out before the empty check)', async () => {
    const input = baseInput({
      availableUnits: [unit({ id: 'unit-1', location: { latitude: 1, longitude: 1 } })],
      candidateEntrances: [entrance({ id: 'ent-1', latitude: 10, longitude: 10, active: false })],
    });
    await expect(generateRecommendation(input)).rejects.toThrow(NoCandidateEntrancesError);
  });

  it('recommends the unit/entrance pair with the best overall Access Score, with correct alternative axes', async () => {
    const unitA = { latitude: 1, longitude: 1 };
    const unitB = { latitude: 2, longitude: 2 };
    const entX = { latitude: 10, longitude: 10 };
    const entY = { latitude: 20, longitude: 20 };

    const routingProvider = new FakeRoutingProvider([
      { origin: unitA, destination: entX, mode: 'VEHICLE', spec: { durationSeconds: 100, distanceMeters: 1000 } },
      { origin: unitB, destination: entX, mode: 'VEHICLE', spec: { durationSeconds: 200, distanceMeters: 2000 } },
      { origin: unitA, destination: entY, mode: 'VEHICLE', spec: { durationSeconds: 150, distanceMeters: 1500 } },
      { origin: unitB, destination: entY, mode: 'VEHICLE', spec: { durationSeconds: 300, distanceMeters: 3000 } },
    ]);

    const input = baseInput({
      availableUnits: [
        unit({ id: 'unit-A', location: unitA, readinessScore: 80 }),
        unit({ id: 'unit-B', location: unitB, readinessScore: 80 }),
      ],
      candidateEntrances: [
        entrance({ id: 'ent-X', latitude: entX.latitude, longitude: entX.longitude }),
        entrance({ id: 'ent-Y', latitude: entY.latitude, longitude: entY.longitude }),
      ],
      routingProvider,
    });

    const result = await generateRecommendation(input);

    expect(result.recommendedUnitId).toBe('unit-A');
    expect(result.recommendedEntranceId).toBe('ent-X');
    expect(result.alternativeUnitId).toBe('unit-B'); // next-best unit for the SAME recommended entrance (ent-X)
    expect(result.alternativeEntranceId).toBe('ent-Y'); // next-best entrance for the SAME recommended unit (unit-A)
    expect(result.candidates).toHaveLength(4);
    expect(result.routeSnapshots).toHaveLength(4);
  });

  it('excludes inactive entrances from the cross-product entirely', async () => {
    const unitLoc = { latitude: 1, longitude: 1 };
    const activeEnt = { latitude: 10, longitude: 10 };
    const routingProvider = new FakeRoutingProvider([
      { origin: unitLoc, destination: activeEnt, mode: 'VEHICLE', spec: { durationSeconds: 100, distanceMeters: 1000 } },
    ]);
    const input = baseInput({
      availableUnits: [unit({ id: 'unit-1', location: unitLoc })],
      candidateEntrances: [
        entrance({ id: 'ent-active', latitude: activeEnt.latitude, longitude: activeEnt.longitude }),
        entrance({ id: 'ent-inactive', latitude: 99, longitude: 99, active: false }),
      ],
      routingProvider,
    });
    const result = await generateRecommendation(input);
    expect(result.candidates).toHaveLength(1);
    expect(result.recommendedEntranceId).toBe('ent-active');
  });

  it('tie-break rule 1: on equal Access Score, the shorter total duration wins', async () => {
    const unitLoc = { latitude: 5, longitude: 5 };
    const entA = { latitude: 6, longitude: 6 };
    const entB = { latitude: 7, longitude: 7 };
    // Both durations round to the same etaScore (100), so total score ties;
    // entB's shorter duration (0s vs 4s) must break the tie.
    const routingProvider = new FakeRoutingProvider([
      { origin: unitLoc, destination: entA, mode: 'VEHICLE', spec: { durationSeconds: 4, distanceMeters: 40 } },
      { origin: unitLoc, destination: entB, mode: 'VEHICLE', spec: { durationSeconds: 0, distanceMeters: 0 } },
    ]);
    const input = baseInput({
      availableUnits: [unit({ id: 'unit-1', location: unitLoc, readinessScore: 80 })],
      candidateEntrances: [
        entrance({ id: 'ent-a', latitude: entA.latitude, longitude: entA.longitude }),
        entrance({ id: 'ent-b', latitude: entB.latitude, longitude: entB.longitude }),
      ],
      routingProvider,
    });
    const result = await generateRecommendation(input);
    const scoreA = result.candidates.find((c) => c.entranceId === 'ent-a')!.score;
    const scoreB = result.candidates.find((c) => c.entranceId === 'ent-b')!.score;
    expect(scoreA).toBe(scoreB); // confirms this is genuinely a tie, not just a lucky pick
    expect(result.recommendedEntranceId).toBe('ent-b');
    expect(result.alternativeEntranceId).toBe('ent-a');
  });

  it('tie-break rule 2: on equal Access Score AND equal duration, higher unit readiness wins', async () => {
    const sharedLoc = { latitude: 3, longitude: 3 };
    const entZ = { latitude: 4, longitude: 4 };
    const routingProvider = new FakeRoutingProvider([
      { origin: sharedLoc, destination: entZ, mode: 'VEHICLE', spec: { durationSeconds: 100, distanceMeters: 1000 } },
    ]);
    const input = baseInput({
      availableUnits: [
        unit({ id: 'unit-p', location: sharedLoc, readinessScore: 80 }),
        unit({ id: 'unit-q', location: sharedLoc, readinessScore: 81 }),
      ],
      candidateEntrances: [entrance({ id: 'ent-z', latitude: entZ.latitude, longitude: entZ.longitude })],
      routingProvider,
    });
    const result = await generateRecommendation(input);
    const scoreP = result.candidates.find((c) => c.unitId === 'unit-p')!.score;
    const scoreQ = result.candidates.find((c) => c.unitId === 'unit-q')!.score;
    expect(scoreP).toBe(scoreQ); // confirms the tie
    expect(result.recommendedUnitId).toBe('unit-q');
    expect(result.alternativeUnitId).toBe('unit-p');
  });

  it('computes an additional pedestrian leg when the entrance vehicleStop point differs from the entrance itself', async () => {
    const unitLoc = { latitude: 0, longitude: 0 };
    const vehicleStop = { latitude: 0.5, longitude: 0.5 };
    const entranceCoords = { latitude: 1, longitude: 1 };
    const routingProvider = new FakeRoutingProvider([
      { origin: unitLoc, destination: vehicleStop, mode: 'VEHICLE', spec: { durationSeconds: 50, distanceMeters: 500 } },
      { origin: vehicleStop, destination: entranceCoords, mode: 'PEDESTRIAN', spec: { durationSeconds: 30, distanceMeters: 50 } },
    ]);
    const input = baseInput({
      availableUnits: [unit({ id: 'unit-1', location: unitLoc })],
      candidateEntrances: [
        entrance({
          id: 'ent-ped',
          latitude: entranceCoords.latitude,
          longitude: entranceCoords.longitude,
          vehicleStopLatitude: vehicleStop.latitude,
          vehicleStopLongitude: vehicleStop.longitude,
        }),
      ],
      routingProvider,
    });
    const result = await generateRecommendation(input);
    const route = result.routeSnapshots[0]!;
    expect(route.pedestrianGeometry).not.toBeNull();
    expect(route.totalDistanceMeters).toBe(550);
    expect(route.totalDurationSeconds).toBe(80);
  });

  it('discards a computed pedestrian leg shorter than the same-point threshold (treats it as effectively the same spot)', async () => {
    const unitLoc = { latitude: 0, longitude: 0 };
    const vehicleStop = { latitude: 0.001, longitude: 0.001 };
    const entranceCoords = { latitude: 1, longitude: 1 };
    const routingProvider = new FakeRoutingProvider([
      { origin: unitLoc, destination: vehicleStop, mode: 'VEHICLE', spec: { durationSeconds: 50, distanceMeters: 500 } },
      { origin: vehicleStop, destination: entranceCoords, mode: 'PEDESTRIAN', spec: { durationSeconds: 5, distanceMeters: 5 } },
    ]);
    const input = baseInput({
      availableUnits: [unit({ id: 'unit-1', location: unitLoc })],
      candidateEntrances: [
        entrance({
          id: 'ent-samepoint',
          latitude: entranceCoords.latitude,
          longitude: entranceCoords.longitude,
          vehicleStopLatitude: vehicleStop.latitude,
          vehicleStopLongitude: vehicleStop.longitude,
        }),
      ],
      routingProvider,
    });
    const result = await generateRecommendation(input);
    const route = result.routeSnapshots[0]!;
    expect(route.pedestrianGeometry).toBeNull();
    expect(route.totalDistanceMeters).toBe(500);
    expect(route.totalDurationSeconds).toBe(50);
  });

  it('never computes a pedestrian leg when the entrance has no vehicleStop point at all', async () => {
    const unitLoc = { latitude: 0, longitude: 0 };
    const entranceCoords = { latitude: 1, longitude: 1 };
    const routingProvider = new FakeRoutingProvider([
      { origin: unitLoc, destination: entranceCoords, mode: 'VEHICLE', spec: { durationSeconds: 50, distanceMeters: 500 } },
    ]);
    const input = baseInput({
      availableUnits: [unit({ id: 'unit-1', location: unitLoc })],
      candidateEntrances: [entrance({ id: 'ent-novehiclestop', latitude: entranceCoords.latitude, longitude: entranceCoords.longitude })],
      routingProvider,
    });
    const result = await generateRecommendation(input);
    const route = result.routeSnapshots[0]!;
    expect(route.pedestrianGeometry).toBeNull();
    expect(route.totalDistanceMeters).toBe(500);
  });

  it('reasoning includes candidate count, top pick, and both alternative axes when present', async () => {
    const unitA = { latitude: 1, longitude: 1 };
    const unitB = { latitude: 2, longitude: 2 };
    const entX = { latitude: 10, longitude: 10 };
    const entY = { latitude: 20, longitude: 20 };
    const routingProvider = new FakeRoutingProvider([
      { origin: unitA, destination: entX, mode: 'VEHICLE', spec: { durationSeconds: 100, distanceMeters: 1000 } },
      { origin: unitB, destination: entX, mode: 'VEHICLE', spec: { durationSeconds: 200, distanceMeters: 2000 } },
      { origin: unitA, destination: entY, mode: 'VEHICLE', spec: { durationSeconds: 150, distanceMeters: 1500 } },
      { origin: unitB, destination: entY, mode: 'VEHICLE', spec: { durationSeconds: 300, distanceMeters: 3000 } },
    ]);
    const input = baseInput({
      availableUnits: [unit({ id: 'unit-A', location: unitA }), unit({ id: 'unit-B', location: unitB })],
      candidateEntrances: [
        entrance({ id: 'ent-X', latitude: entX.latitude, longitude: entX.longitude }),
        entrance({ id: 'ent-Y', latitude: entY.latitude, longitude: entY.longitude }),
      ],
      routingProvider,
    });
    const result = await generateRecommendation(input);
    expect(result.reasoning).toEqual(
      expect.arrayContaining([
        'CANDIDATES_CONSIDERED:4',
        expect.stringContaining('TOP_CANDIDATE:unit=unit-A,entrance=ent-X'),
        'ALTERNATIVE_UNIT:unit-B',
        'ALTERNATIVE_ENTRANCE:ent-Y',
      ])
    );
  });

  it('is not affected by unit/entrance array ordering (same result regardless of input order)', async () => {
    const unitA = { latitude: 1, longitude: 1 };
    const unitB = { latitude: 2, longitude: 2 };
    const entX = { latitude: 10, longitude: 10 };
    const routingProvider = new FakeRoutingProvider([
      { origin: unitA, destination: entX, mode: 'VEHICLE', spec: { durationSeconds: 100, distanceMeters: 1000 } },
      { origin: unitB, destination: entX, mode: 'VEHICLE', spec: { durationSeconds: 200, distanceMeters: 2000 } },
    ]);
    const entranceX = entrance({ id: 'ent-X', latitude: entX.latitude, longitude: entX.longitude });
    const unitAObj = unit({ id: 'unit-A', location: unitA });
    const unitBObj = unit({ id: 'unit-B', location: unitB });

    const forward = await generateRecommendation(
      baseInput({ availableUnits: [unitAObj, unitBObj], candidateEntrances: [entranceX], routingProvider })
    );
    const reversed = await generateRecommendation(
      baseInput({ availableUnits: [unitBObj, unitAObj], candidateEntrances: [entranceX], routingProvider })
    );
    expect(forward.recommendedUnitId).toBe(reversed.recommendedUnitId);
    expect(forward.accessScore).toBe(reversed.accessScore);
  });
});
