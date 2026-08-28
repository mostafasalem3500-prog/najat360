/**
 * RoutingProvider — spec section 16 "Routing Provider قابل للاستبدال".
 * Same abstraction pattern as every other external capability in this
 * codebase (CadReadProvider, AssistedCaptureProvider, TranslationProvider):
 * the app depends on this interface only; `MockRoutingProvider` is the
 * mandatory, deterministic, no-API-key implementation; a real provider
 * (e.g. ArcGIS) stays behind an environment flag and is not built this
 * phase (rules #2-#6 below — fallback, caching, timeout handling — only
 * matter once a real provider exists to fail; not implemented for a
 * provider that cannot fail).
 *
 * Spec rules this interface's shape exists to satisfy:
 *   1. `MockRoutingProvider` works with no API key. ✅ (mock-provider.ts)
 *   2. A real provider stays behind an env flag — not built this phase.
 *   3. UI never binds directly to an external provider — routes go through
 *      this interface, never import a concrete provider.
 *   4. Automatic fallback to mock with a clear badge if a real provider
 *      fails — `providerMode` below is that badge; deferred until a real
 *      provider exists to fall back FROM.
 *   5. Short cache for matrix results — deferred (same reason as #4).
 *   6. Timeout/error handling that never disables the operations
 *      dashboard — deferred (same reason as #4); `MockRoutingProvider`
 *      cannot itself time out or error since it does no I/O.
 */
import type { LatLng } from '@/lib/geo';
import type { ProviderHealth } from '@/lib/providers/health';

export type RoutingMode = 'VEHICLE' | 'PEDESTRIAN';

/**
 * Where a `RouteResult`/`MatrixResult` actually came from — written onto
 * every persisted `RouteSnapshot` row so nothing downstream can mistake a
 * simulated ETA for a live one. 'MOCK' = `MockRoutingProvider`; 'LIVE' = a
 * real provider responded; 'FALLBACK' = a real provider was configured but
 * failed, and this result came from `MockRoutingProvider` instead. Only
 * 'MOCK' is reachable until a real provider is built.
 */
export type RoutingProviderMode = 'MOCK' | 'LIVE' | 'FALLBACK';

export interface RouteInput {
  origin: LatLng;
  destination: LatLng;
  mode: RoutingMode;
}

export interface RouteResult {
  distanceMeters: number;
  durationSeconds: number;
  /** Opaque route geometry — a GeoJSON LineString string in this phase's providers. Never parsed by this project's own code; stored and rendered only. */
  geometry: string;
  provider: string;
  providerMode: RoutingProviderMode;
  dataFreshnessAt: Date;
}

export interface MatrixInput {
  origins: LatLng[];
  destinations: LatLng[];
  mode: RoutingMode;
}

export interface MatrixResult {
  /** `durationsSeconds[i][j]` = duration from `origins[i]` to `destinations[j]`. */
  durationsSeconds: number[][];
  distancesMeters: number[][];
  provider: string;
  providerMode: RoutingProviderMode;
  dataFreshnessAt: Date;
}

export interface SnapInput {
  point: LatLng;
}

export interface SnapResult extends LatLng {
  distanceMovedMeters: number;
}

export interface RoutingProvider {
  readonly name: string;
  route(input: RouteInput): Promise<RouteResult>;
  matrix(input: MatrixInput): Promise<MatrixResult>;
  /** Optional per spec — no implementation ships this phase (see file header). */
  snapToRoad?(input: SnapInput): Promise<SnapResult>;
  health(): Promise<ProviderHealth>;
}
