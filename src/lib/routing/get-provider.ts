/**
 * getRoutingProvider() — the ONE place this project decides which
 * RoutingProvider a request uses, per spec 16 rule #3 ("UI never binds
 * directly to an external provider"). Every call site that used to write
 * `new MockRoutingProvider(...)` directly should call this instead.
 *
 * Default (ROUTING_PROVIDER unset or 'mock', or ArcGIS not configured):
 * plain MockRoutingProvider — zero behavior change from before this
 * module existed. Only when ROUTING_PROVIDER=arcgis AND the user has set
 * their own ARCGIS_ROUTE_URL/ARCGIS_API_KEY (never this code's job to
 * obtain those — see .env.example) does this return a
 * ResilientRoutingProvider(ArcGisRoutingProvider, MockRoutingProvider) —
 * real ETAs when ArcGIS answers, an automatic, clearly-tagged fallback to
 * the mock the instant it doesn't.
 */
import { MockRoutingProvider } from './mock-provider';
import { ArcGisRoutingProvider } from './arcgis-provider';
import { ResilientRoutingProvider } from './resilient-provider';
import type { RoutingProvider } from './provider';

export function getRoutingProvider(clock: () => Date = () => new Date()): RoutingProvider {
  if (process.env.ROUTING_PROVIDER === 'arcgis') {
    const arcgis = new ArcGisRoutingProvider();
    if (arcgis.isConfigured()) {
      return new ResilientRoutingProvider(arcgis, new MockRoutingProvider(clock));
    }
  }
  return new MockRoutingProvider(clock);
}
