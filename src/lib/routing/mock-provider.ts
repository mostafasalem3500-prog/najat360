/**
 * MockRoutingProvider — spec 16 rule #1: mandatory, works with no API key.
 * Estimates distance/duration from straight-line (haversine) distance with
 * a fixed "road inefficiency factor" and a fixed assumed travel speed —
 * this is explicitly NOT a real routing engine and makes no claim to be
 * one. Every `RouteResult`/`MatrixResult` this provider returns carries
 * `providerMode: 'MOCK'` so nothing downstream can mistake it for a live
 * ETA (see provider.ts's header comment on why the badge is on the DATA,
 * not just in a code comment).
 *
 * Choices below (inefficiency factor, assumed speeds) are this project's
 * own, undocumented by spec — spec only requires that a mock exist and
 * work offline, not that it estimate any particular way. Documented here
 * so a future real-provider integration has an honest baseline to compare
 * against, not just "however ChatGPT/Claude happened to guess".
 */
import { haversineDistanceMeters } from '@/lib/geo';
import type { ProviderHealth } from '@/lib/providers/health';
import type {
  MatrixInput,
  MatrixResult,
  RouteInput,
  RouteResult,
  RoutingMode,
  RoutingProvider,
} from './provider';

/** Real road distance is typically longer than a straight line; VEHICLE routes follow a road network more indirectly than PEDESTRIAN paths often can (shortcuts, footbridges), hence the lower pedestrian factor. */
const ROAD_INEFFICIENCY_FACTOR: Record<RoutingMode, number> = {
  VEHICLE: 1.3,
  PEDESTRIAN: 1.15,
};

/** Assumed average speed in m/s — VEHICLE: ~40 km/h (urban ambulance under lights, mixed traffic). PEDESTRIAN: ~4.7 km/h (brisk walk while carrying gear). */
const ASSUMED_SPEED_MPS: Record<RoutingMode, number> = {
  VEHICLE: 11.11,
  PEDESTRIAN: 1.3,
};

export class MockRoutingProvider implements RoutingProvider {
  readonly name = 'mock-routing-provider';
  private readonly clock: () => Date;

  constructor(clock: () => Date = () => new Date()) {
    this.clock = clock;
  }

  async route(input: RouteInput): Promise<RouteResult> {
    return this.computeRoute(input);
  }

  async matrix(input: MatrixInput): Promise<MatrixResult> {
    const durationsSeconds: number[][] = [];
    const distancesMeters: number[][] = [];
    for (const origin of input.origins) {
      const durationsRow: number[] = [];
      const distancesRow: number[] = [];
      for (const destination of input.destinations) {
        const leg = this.computeRoute({ origin, destination, mode: input.mode });
        durationsRow.push(leg.durationSeconds);
        distancesRow.push(leg.distanceMeters);
      }
      durationsSeconds.push(durationsRow);
      distancesMeters.push(distancesRow);
    }
    return {
      durationsSeconds,
      distancesMeters,
      provider: this.name,
      providerMode: 'MOCK',
      dataFreshnessAt: this.clock(),
    };
  }

  async health(): Promise<ProviderHealth> {
    return { status: 'SIMULATED', provider: this.name };
  }

  private computeRoute(input: RouteInput): RouteResult {
    const straightLineMeters = haversineDistanceMeters(input.origin, input.destination);
    const distanceMeters = straightLineMeters * ROAD_INEFFICIENCY_FACTOR[input.mode];
    const durationSeconds = distanceMeters / ASSUMED_SPEED_MPS[input.mode];
    return {
      distanceMeters: Math.round(distanceMeters),
      durationSeconds: Math.round(durationSeconds),
      geometry: JSON.stringify({
        type: 'LineString',
        coordinates: [
          [input.origin.longitude, input.origin.latitude],
          [input.destination.longitude, input.destination.latitude],
        ],
      }),
      provider: this.name,
      providerMode: 'MOCK',
      dataFreshnessAt: this.clock(),
    };
  }
}
