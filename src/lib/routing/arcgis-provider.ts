/**
 * ArcGisRoutingProvider — the real provider `provider.ts`'s own header
 * said was "deferred until a real provider exists" (spec 16 rule #2: "a
 * real provider stays behind an environment flag"). Never used directly —
 * only `getRoutingProvider()` in this same directory constructs it, and
 * only when `ROUTING_PROVIDER=arcgis` AND both env vars below are set;
 * every other case keeps using `MockRoutingProvider`, unchanged.
 *
 * Calls Esri's "World Route Service" (the paid/authenticated ArcGIS
 * routing REST API — a DIFFERENT product from the free World Imagery
 * TILE service `app/_components/IncidentMap.tsx` uses for the optional
 * satellite basemap; this one needs a real ArcGIS Developer account and
 * `ARCGIS_API_KEY`/`ARCGIS_ROUTE_URL`, which the standing rule in this
 * project means the USER sets in their own Vercel env vars — this code
 * never creates an account or obtains a key itself). Until the user does
 * that, `ROUTING_PROVIDER` stays `mock` (the .env.example default) and
 * this class is never even constructed.
 *
 * `matrix()` is naive — one `route()` call per (origin, destination) pair,
 * run in parallel — because the World Route Service's real matrix/OD-cost
 * endpoint needs a different request shape this phase doesn't build; for
 * this project's small coverage grids (≤19 cells × a handful of units,
 * see repo.ts's LIVE_COVERAGE_GRID_RING_SIZE) that is a bounded number of
 * HTTP calls, not a performance concern.
 */
import type {
  MatrixInput,
  MatrixResult,
  RouteInput,
  RouteResult,
  RoutingProvider,
} from './provider';
import type { ProviderHealth } from '@/lib/providers/health';

interface ArcGisRouteFeature {
  attributes?: { Total_Kilometers?: number; Total_TravelTime?: number };
  geometry?: { paths?: number[][][] };
}
interface ArcGisRouteResponse {
  routes?: { features?: ArcGisRouteFeature[] };
  error?: { message?: string };
}

export class ArcGisNotConfiguredError extends Error {
  constructor() {
    super('ArcGisRoutingProvider: ARCGIS_ROUTE_URL and ARCGIS_API_KEY must both be set');
    this.name = 'ArcGisNotConfiguredError';
  }
}

export class ArcGisRoutingProvider implements RoutingProvider {
  readonly name = 'arcgis-route-service';

  constructor(
    private readonly endpoint: string | undefined = process.env.ARCGIS_ROUTE_URL,
    private readonly apiKey: string | undefined = process.env.ARCGIS_API_KEY
  ) {}

  isConfigured(): boolean {
    return Boolean(this.endpoint && this.apiKey);
  }

  async route(input: RouteInput): Promise<RouteResult> {
    if (!this.endpoint || !this.apiKey) throw new ArcGisNotConfiguredError();

    const body = new URLSearchParams({
      f: 'json',
      token: this.apiKey,
      stops: `${input.origin.longitude},${input.origin.latitude};${input.destination.longitude},${input.destination.latitude}`,
      returnRoutes: 'true',
      returnDirections: 'false',
      returnStops: 'false',
      returnBarriers: 'false',
    });

    const response = await fetch(this.endpoint, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(4500),
    });
    if (!response.ok) throw new Error(`ArcGisRoutingProvider: HTTP ${response.status}`);

    const json = (await response.json()) as ArcGisRouteResponse;
    if (json.error) throw new Error(`ArcGisRoutingProvider: ${json.error.message ?? 'unknown API error'}`);
    const feature = json.routes?.features?.[0];
    const path = feature?.geometry?.paths?.[0];
    if (!feature?.attributes || !path) throw new Error('ArcGisRoutingProvider: unexpected response shape');

    return {
      distanceMeters: Math.round((feature.attributes.Total_Kilometers ?? 0) * 1000),
      durationSeconds: Math.round((feature.attributes.Total_TravelTime ?? 0) * 60),
      geometry: JSON.stringify({ type: 'LineString', coordinates: path.map(([x, y]) => [x, y]) }),
      provider: this.name,
      providerMode: 'LIVE',
      dataFreshnessAt: new Date(),
    };
  }

  /**
   * origins × destinations `route()` calls in parallel — see module header
   * for why this is acceptable at this project's grid sizes rather than
   * using Esri's dedicated OD-cost-matrix endpoint.
   */
  async matrix(input: MatrixInput): Promise<MatrixResult> {
    const durationsSeconds: number[][] = [];
    const distancesMeters: number[][] = [];
    for (const origin of input.origins) {
      const durationsRow: number[] = [];
      const distancesRow: number[] = [];
      for (const destination of input.destinations) {
        const leg = await this.route({ origin, destination, mode: input.mode });
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
      providerMode: 'LIVE',
      dataFreshnessAt: new Date(),
    };
  }

  async health(): Promise<ProviderHealth> {
    if (!this.isConfigured()) {
      return { status: 'UNREACHABLE', provider: this.name, detail: 'ARCGIS_ROUTE_URL/ARCGIS_API_KEY not set' };
    }
    return { status: 'HEALTHY', provider: this.name, lastCheckedAt: new Date().toISOString() };
  }
}
