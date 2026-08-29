import { describe, expect, it } from 'vitest';
import { ResilientRoutingProvider } from '@/lib/routing/resilient-provider';
import type { MatrixInput, MatrixResult, RouteInput, RouteResult, RoutingProvider } from '@/lib/routing/provider';

const ORIGIN = { latitude: 24.7, longitude: 46.6 };
const DEST = { latitude: 24.71, longitude: 46.61 };

function fakeProvider(name: string, mode: RouteResult['providerMode'], shouldThrow = false): RoutingProvider {
  return {
    name,
    async route(_input: RouteInput): Promise<RouteResult> {
      if (shouldThrow) throw new Error(`${name} failed`);
      return { distanceMeters: 1000, durationSeconds: 100, geometry: '{}', provider: name, providerMode: mode, dataFreshnessAt: new Date() };
    },
    async matrix(input: MatrixInput): Promise<MatrixResult> {
      if (shouldThrow) throw new Error(`${name} failed`);
      return {
        durationsSeconds: input.origins.map(() => input.destinations.map(() => 100)),
        distancesMeters: input.origins.map(() => input.destinations.map(() => 1000)),
        provider: name,
        providerMode: mode,
        dataFreshnessAt: new Date(),
      };
    },
    async health() {
      return { status: shouldThrow ? ('UNREACHABLE' as const) : ('HEALTHY' as const), provider: name };
    },
  };
}

describe('ResilientRoutingProvider', () => {
  it('returns the primary provider result untouched when it succeeds', async () => {
    const provider = new ResilientRoutingProvider(fakeProvider('primary', 'LIVE'), fakeProvider('mock', 'MOCK'));
    const result = await provider.route({ origin: ORIGIN, destination: DEST, mode: 'VEHICLE' });
    expect(result.provider).toBe('primary');
    expect(result.providerMode).toBe('LIVE');
  });

  it('falls back to the secondary provider and tags providerMode FALLBACK when the primary throws', async () => {
    const provider = new ResilientRoutingProvider(fakeProvider('primary', 'LIVE', true), fakeProvider('mock', 'MOCK'));
    const result = await provider.route({ origin: ORIGIN, destination: DEST, mode: 'VEHICLE' });
    expect(result.provider).toBe('mock');
    expect(result.providerMode).toBe('FALLBACK');
  });

  it('does the same fallback tagging for matrix()', async () => {
    const provider = new ResilientRoutingProvider(fakeProvider('primary', 'LIVE', true), fakeProvider('mock', 'MOCK'));
    const result = await provider.matrix({ origins: [ORIGIN], destinations: [DEST], mode: 'VEHICLE' });
    expect(result.provider).toBe('mock');
    expect(result.providerMode).toBe('FALLBACK');
  });

  it('never throws even when the primary fails — the caller always gets a result', async () => {
    const provider = new ResilientRoutingProvider(fakeProvider('primary', 'LIVE', true), fakeProvider('mock', 'MOCK'));
    await expect(provider.route({ origin: ORIGIN, destination: DEST, mode: 'VEHICLE' })).resolves.toBeDefined();
  });

  it('health() reports the primary status directly when healthy', async () => {
    const provider = new ResilientRoutingProvider(fakeProvider('primary', 'LIVE'), fakeProvider('mock', 'MOCK'));
    const health = await provider.health();
    expect(health.status).toBe('HEALTHY');
  });

  it('health() never throws even if the primary health check itself throws', async () => {
    const throwingHealth: RoutingProvider = { ...fakeProvider('primary', 'LIVE'), health: async () => { throw new Error('down'); } };
    const provider = new ResilientRoutingProvider(throwingHealth, fakeProvider('mock', 'MOCK'));
    const health = await provider.health();
    expect(health.status).toBe('DEGRADED');
  });
});
