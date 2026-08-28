import { describe, expect, it } from 'vitest';
import { MockRoutingProvider } from '@/lib/routing/mock-provider';
import type { RoutingProvider } from '@/lib/routing/provider';

// Riyadh-ish coordinates, ~ a few km apart, used across several tests.
const ORIGIN = { latitude: 24.7136, longitude: 46.6753 };
const DESTINATION = { latitude: 24.7236, longitude: 46.6853 };

describe('MockRoutingProvider', () => {
  it('reports name and providerMode MOCK on every route()', async () => {
    const provider = new MockRoutingProvider();
    const result = await provider.route({ origin: ORIGIN, destination: DESTINATION, mode: 'VEHICLE' });
    expect(result.provider).toBe('mock-routing-provider');
    expect(result.providerMode).toBe('MOCK');
  });

  it('route() distance/duration are strictly positive for two distinct points', async () => {
    const provider = new MockRoutingProvider();
    const result = await provider.route({ origin: ORIGIN, destination: DESTINATION, mode: 'VEHICLE' });
    expect(result.distanceMeters).toBeGreaterThan(0);
    expect(result.durationSeconds).toBeGreaterThan(0);
  });

  it('route() returns zero distance/duration when origin equals destination', async () => {
    const provider = new MockRoutingProvider();
    const result = await provider.route({ origin: ORIGIN, destination: ORIGIN, mode: 'VEHICLE' });
    expect(result.distanceMeters).toBe(0);
    expect(result.durationSeconds).toBe(0);
  });

  it('VEHICLE and PEDESTRIAN produce different distances for the same two points (different inefficiency factors)', async () => {
    const provider = new MockRoutingProvider();
    const vehicle = await provider.route({ origin: ORIGIN, destination: DESTINATION, mode: 'VEHICLE' });
    const pedestrian = await provider.route({ origin: ORIGIN, destination: DESTINATION, mode: 'PEDESTRIAN' });
    expect(vehicle.distanceMeters).not.toBe(pedestrian.distanceMeters);
  });

  it('PEDESTRIAN takes longer in duration than VEHICLE for the same distance (slower assumed speed)', async () => {
    const provider = new MockRoutingProvider();
    const vehicle = await provider.route({ origin: ORIGIN, destination: DESTINATION, mode: 'VEHICLE' });
    const pedestrian = await provider.route({ origin: ORIGIN, destination: DESTINATION, mode: 'PEDESTRIAN' });
    expect(pedestrian.durationSeconds).toBeGreaterThan(vehicle.durationSeconds);
  });

  it('route() geometry is a valid GeoJSON LineString string with origin/destination coordinates in [lng, lat] order', async () => {
    const provider = new MockRoutingProvider();
    const result = await provider.route({ origin: ORIGIN, destination: DESTINATION, mode: 'VEHICLE' });
    const parsed = JSON.parse(result.geometry);
    expect(parsed.type).toBe('LineString');
    expect(parsed.coordinates).toEqual([
      [ORIGIN.longitude, ORIGIN.latitude],
      [DESTINATION.longitude, DESTINATION.latitude],
    ]);
  });

  it('dataFreshnessAt uses the injected clock, not the real system clock', async () => {
    const fixedNow = new Date('2026-01-01T00:00:00.000Z');
    const provider = new MockRoutingProvider(() => fixedNow);
    const result = await provider.route({ origin: ORIGIN, destination: DESTINATION, mode: 'VEHICLE' });
    expect(result.dataFreshnessAt).toEqual(fixedNow);
  });

  it('matrix() shape: durationsSeconds[i][j] matches an equivalent individual route() call', async () => {
    const provider = new MockRoutingProvider();
    const origins = [ORIGIN];
    const destinations = [DESTINATION, ORIGIN];
    const matrix = await provider.matrix({ origins, destinations, mode: 'VEHICLE' });
    const individualToDestination = await provider.route({ origin: ORIGIN, destination: DESTINATION, mode: 'VEHICLE' });
    expect(matrix.durationsSeconds[0]![0]).toBe(individualToDestination.durationSeconds);
    expect(matrix.distancesMeters[0]![0]).toBe(individualToDestination.distanceMeters);
    expect(matrix.durationsSeconds[0]![1]).toBe(0);
  });

  it('matrix() dimensions match origins x destinations', async () => {
    const provider = new MockRoutingProvider();
    const origins = [ORIGIN, DESTINATION];
    const destinations = [ORIGIN, DESTINATION, { latitude: 24.7, longitude: 46.7 }];
    const matrix = await provider.matrix({ origins, destinations, mode: 'VEHICLE' });
    expect(matrix.durationsSeconds).toHaveLength(2);
    expect(matrix.durationsSeconds[0]).toHaveLength(3);
    expect(matrix.distancesMeters).toHaveLength(2);
    expect(matrix.distancesMeters[0]).toHaveLength(3);
  });

  it('matrix() reports providerMode MOCK', async () => {
    const provider = new MockRoutingProvider();
    const matrix = await provider.matrix({ origins: [ORIGIN], destinations: [DESTINATION], mode: 'VEHICLE' });
    expect(matrix.providerMode).toBe('MOCK');
  });

  it('health() reports SIMULATED status (no live I/O provider this phase)', async () => {
    const provider = new MockRoutingProvider();
    const health = await provider.health();
    expect(health.status).toBe('SIMULATED');
    expect(health.provider).toBe('mock-routing-provider');
  });

  it('does not implement snapToRoad (optional, unimplemented this phase)', () => {
    const provider: RoutingProvider = new MockRoutingProvider();
    expect(provider.snapToRoad).toBeUndefined();
  });

  it('route() is deterministic for the same inputs and clock', async () => {
    const fixedNow = new Date('2026-01-01T00:00:00.000Z');
    const provider = new MockRoutingProvider(() => fixedNow);
    const first = await provider.route({ origin: ORIGIN, destination: DESTINATION, mode: 'VEHICLE' });
    const second = await provider.route({ origin: ORIGIN, destination: DESTINATION, mode: 'VEHICLE' });
    expect(first).toEqual(second);
  });
});
