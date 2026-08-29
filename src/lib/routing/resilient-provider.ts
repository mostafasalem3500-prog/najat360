/**
 * ResilientRoutingProvider — spec 16 rule #4: "automatic fallback to mock
 * with a clear badge if a real provider fails". `provider.ts`'s header
 * left this deferred until a real provider existed to fall back FROM;
 * `ArcGisRoutingProvider` (this directory) is that provider, so this
 * wrapper is what makes it safe to actually use: any `route()`/`matrix()`
 * failure (timeout, HTTP error, malformed response, `ArcGisNotConfiguredError`)
 * is caught and retried against `MockRoutingProvider`, with the result's
 * `providerMode` forced to `'FALLBACK'` — never silently presented as
 * `'LIVE'` — so a `RouteSnapshot` row downstream and anything rendering
 * it (dashboard "mode: simulation" badges) can tell the difference. Never
 * throws itself: the operations dashboard must keep working even if
 * ArcGIS is misconfigured or down (spec rule #6).
 */
import type {
  MatrixInput,
  MatrixResult,
  RouteInput,
  RouteResult,
  RoutingProvider,
  SnapInput,
  SnapResult,
} from './provider';
import type { ProviderHealth } from '@/lib/providers/health';

export class ResilientRoutingProvider implements RoutingProvider {
  readonly name: string;

  constructor(
    private readonly primary: RoutingProvider,
    private readonly fallback: RoutingProvider
  ) {
    this.name = `${primary.name}+fallback(${fallback.name})`;
  }

  async route(input: RouteInput): Promise<RouteResult> {
    try {
      return await this.primary.route(input);
    } catch {
      const result = await this.fallback.route(input);
      return { ...result, providerMode: 'FALLBACK' };
    }
  }

  async matrix(input: MatrixInput): Promise<MatrixResult> {
    try {
      return await this.primary.matrix(input);
    } catch {
      const result = await this.fallback.matrix(input);
      return { ...result, providerMode: 'FALLBACK' };
    }
  }

  async snapToRoad(input: SnapInput): Promise<SnapResult> {
    if (this.primary.snapToRoad) {
      try {
        return await this.primary.snapToRoad(input);
      } catch {
        // fall through to fallback below
      }
    }
    if (this.fallback.snapToRoad) return this.fallback.snapToRoad(input);
    throw new Error('ResilientRoutingProvider: neither provider implements snapToRoad');
  }

  async health(): Promise<ProviderHealth> {
    try {
      const primaryHealth = await this.primary.health();
      if (primaryHealth.status === 'HEALTHY') return primaryHealth;
      return { ...primaryHealth, detail: `${primaryHealth.detail ?? ''} (falling back to ${this.fallback.name})`.trim() };
    } catch {
      return { status: 'DEGRADED', provider: this.primary.name, detail: `health check failed — falling back to ${this.fallback.name}` };
    }
  }
}
