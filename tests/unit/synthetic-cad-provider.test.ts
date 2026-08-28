import { describe, expect, it } from 'vitest';
import { SyntheticCadProvider } from '@/lib/integrations/cad/synthetic-cad-provider';
import type { AmbulanceUnit, Incident } from '@/lib/domain/types';

function incident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: 'inc-1',
    rescueCode: 'NJT-7K4-92',
    callerTokenHash: 'hash-of-token',
    callerTokenExpiresAt: new Date('2026-08-24T12:30:00Z'),
    status: 'DISPATCHED',
    latitude: 24.7,
    longitude: 46.7,
    language: 'ar',
    unableToSpeak: false,
    synthetic: true,
    createdAt: new Date('2026-08-24T12:00:00Z'),
    updatedAt: new Date('2026-08-24T12:00:00Z'),
    ...overrides,
  };
}

function unit(overrides: Partial<AmbulanceUnit> = {}): AmbulanceUnit {
  return {
    id: 'unit-1',
    code: 'A-1',
    label: 'Ambulance 1',
    crewType: 'AMBULANCE',
    status: 'AVAILABLE',
    readinessScore: 80,
    homeZone: 'zone-1',
    synthetic: true,
    createdAt: new Date('2026-08-24T12:00:00Z'),
    updatedAt: new Date('2026-08-24T12:00:00Z'),
    ...overrides,
  };
}

describe('SyntheticCadProvider', () => {
  it('performs no I/O and requires no network — constructible from plain arrays', () => {
    const provider = new SyntheticCadProvider({ incidents: [incident()], units: [unit()] });
    expect(provider.name).toBe('synthetic');
  });

  it('drops any row that is not marked synthetic=true, never serving it', async () => {
    const real = incident({ id: 'real-1', synthetic: false });
    const provider = new SyntheticCadProvider({ incidents: [incident(), real], units: [] });
    expect(await provider.getIncident('real-1')).toBeNull();
    const active = await provider.listActiveIncidents();
    expect(active.every((i) => i.synthetic)).toBe(true);
    expect(active.find((i) => i.id === 'real-1')).toBeUndefined();
  });

  it('getIncident returns null for an unknown id rather than throwing', async () => {
    const provider = new SyntheticCadProvider({ incidents: [], units: [] });
    expect(await provider.getIncident('does-not-exist')).toBeNull();
  });

  it('listActiveIncidents excludes terminal statuses', async () => {
    const provider = new SyntheticCadProvider({
      incidents: [
        incident({ id: 'a', status: 'CLOSED' }),
        incident({ id: 'b', status: 'CANCELLED_BY_OPERATOR' }),
        incident({ id: 'c', status: 'EN_ROUTE' }),
      ],
      units: [],
    });
    const active = await provider.listActiveIncidents();
    expect(active.map((i) => i.id)).toEqual(['c']);
  });

  it('health() always resolves to a SIMULATED status and never throws', async () => {
    const provider = new SyntheticCadProvider({ incidents: [], units: [] });
    await expect(provider.health()).resolves.toEqual({ status: 'SIMULATED', provider: 'synthetic' });
  });

  it('listUnits filters synthetic and returns a defensive copy', async () => {
    const provider = new SyntheticCadProvider({ incidents: [], units: [unit()] });
    const first = await provider.listUnits();
    first.push(unit({ id: 'unit-2' }));
    const second = await provider.listUnits();
    expect(second).toHaveLength(1);
  });
});
