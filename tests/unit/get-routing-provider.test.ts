import { afterEach, describe, expect, it } from 'vitest';
import { getRoutingProvider } from '@/lib/routing/get-provider';

const ENV_KEYS = ['ROUTING_PROVIDER', 'ARCGIS_ROUTE_URL', 'ARCGIS_API_KEY'] as const;
const originalEnv: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) originalEnv[key] = process.env[key];

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe('getRoutingProvider', () => {
  it('returns a MockRoutingProvider by default (ROUTING_PROVIDER unset)', () => {
    delete process.env.ROUTING_PROVIDER;
    const provider = getRoutingProvider();
    expect(provider.name).toBe('mock-routing-provider');
  });

  it('returns a MockRoutingProvider when ROUTING_PROVIDER=mock explicitly', () => {
    process.env.ROUTING_PROVIDER = 'mock';
    const provider = getRoutingProvider();
    expect(provider.name).toBe('mock-routing-provider');
  });

  it('falls back to MockRoutingProvider when ROUTING_PROVIDER=arcgis but no key/endpoint is set', () => {
    process.env.ROUTING_PROVIDER = 'arcgis';
    delete process.env.ARCGIS_ROUTE_URL;
    delete process.env.ARCGIS_API_KEY;
    const provider = getRoutingProvider();
    expect(provider.name).toBe('mock-routing-provider');
  });

  it('returns a resilient ArcGIS-backed provider when ROUTING_PROVIDER=arcgis and both env vars are set', () => {
    process.env.ROUTING_PROVIDER = 'arcgis';
    process.env.ARCGIS_ROUTE_URL = 'https://route.arcgis.example/solve';
    process.env.ARCGIS_API_KEY = 'test-key';
    const provider = getRoutingProvider();
    expect(provider.name).toContain('arcgis-route-service');
    expect(provider.name).toContain('fallback');
  });
});
