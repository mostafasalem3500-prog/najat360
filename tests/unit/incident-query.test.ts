import { describe, expect, it } from 'vitest';
import { enrichIncidentsWithZone, incidentAgeMinutes, queryIncidents, type EnrichedIncident } from '@/lib/incidents/query';
import type { AmbulanceUnit, Entrance, Incident } from '@/lib/domain/types';

function incident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: 'inc-1',
    rescueCode: 'NJT-7K4-92',
    callerTokenHash: 'hash',
    callerTokenExpiresAt: new Date('2026-08-24T13:00:00Z'),
    status: 'DISPATCHED',
    latitude: 24.7,
    longitude: 46.7,
    language: 'ar',
    unableToSpeak: false,
    synthetic: true,
    createdAt: new Date('2026-08-20T10:00:00Z'),
    updatedAt: new Date('2026-08-20T10:00:00Z'),
    ...overrides,
  };
}

function entrance(overrides: Partial<Entrance> = {}): Entrance {
  return {
    id: 'ent-1',
    code: 'ENT-01',
    nameAr: 'مدخل',
    nameEn: 'Entrance',
    latitude: 24.7,
    longitude: 46.7,
    zone: 'zone-north',
    accessType: 'ROAD',
    vehicleAccessible: true,
    pedestrianAccessible: true,
    active: true,
    validationStatus: 'UNVERIFIED',
    synthetic: true,
    hasStairs: false,
    hasElevator: false,
    isServiceGate: false,
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
    homeZone: 'zone-south',
    synthetic: true,
    createdAt: new Date('2026-08-20T09:00:00Z'),
    updatedAt: new Date('2026-08-20T09:00:00Z'),
    ...overrides,
  };
}

describe('enrichIncidentsWithZone', () => {
  it('resolves entrance zone and unit home zone / crewType from the assigned ids', () => {
    const [enriched] = enrichIncidentsWithZone(
      [incident({ assignedEntranceId: 'ent-1', assignedUnitId: 'unit-1' })],
      [entrance()],
      [unit()]
    );
    expect(enriched!.entranceZone).toBe('zone-north');
    expect(enriched!.unitHomeZone).toBe('zone-south');
    expect(enriched!.unitCrewType).toBe('AMBULANCE');
  });

  it('leaves zone fields null when nothing is assigned', () => {
    const [enriched] = enrichIncidentsWithZone([incident({ assignedEntranceId: null, assignedUnitId: null })], [], []);
    expect(enriched).toMatchObject({ entranceZone: null, unitHomeZone: null, unitCrewType: null });
  });
});

describe('queryIncidents — date range / duration', () => {
  const rows: EnrichedIncident[] = enrichIncidentsWithZone(
    [
      incident({ id: 'a', createdAt: new Date('2026-08-01T00:00:00Z') }),
      incident({ id: 'b', createdAt: new Date('2026-08-15T00:00:00Z') }),
      incident({ id: 'c', createdAt: new Date('2026-08-30T00:00:00Z') }),
    ],
    [],
    []
  );

  it('filters by createdFrom/createdTo inclusive bounds', () => {
    const result = queryIncidents(rows, {
      createdFrom: new Date('2026-08-10T00:00:00Z'),
      createdTo: new Date('2026-08-20T00:00:00Z'),
    });
    expect(result.map((r) => r.id)).toEqual(['b']);
  });

  it('with no filters, returns everything', () => {
    expect(queryIncidents(rows, {})).toHaveLength(3);
    expect(queryIncidents(rows)).toHaveLength(3);
  });
});

describe('queryIncidents — crew/team and zone/region', () => {
  const rows = enrichIncidentsWithZone(
    [
      incident({ id: 'a', assignedUnitId: 'unit-amb', assignedEntranceId: 'ent-n' }),
      incident({ id: 'b', assignedUnitId: 'unit-foot', assignedEntranceId: 'ent-s' }),
    ],
    [entrance({ id: 'ent-n', zone: 'zone-north' }), entrance({ id: 'ent-s', zone: 'zone-south' })],
    [
      unit({ id: 'unit-amb', crewType: 'AMBULANCE', homeZone: 'zone-north' }),
      unit({ id: 'unit-foot', crewType: 'FOOT_TEAM', homeZone: 'zone-south' }),
    ]
  );

  it('filters by crewType (team)', () => {
    expect(queryIncidents(rows, { crewType: 'FOOT_TEAM' }).map((r) => r.id)).toEqual(['b']);
  });

  it('filters by a specific unitId', () => {
    expect(queryIncidents(rows, { unitId: 'unit-amb' }).map((r) => r.id)).toEqual(['a']);
  });

  it('filters by zone, matching either entrance zone or unit home zone', () => {
    expect(queryIncidents(rows, { zone: 'zone-north' }).map((r) => r.id)).toEqual(['a']);
    expect(queryIncidents(rows, { zone: 'zone-south' }).map((r) => r.id)).toEqual(['b']);
  });
});

describe('queryIncidents — status, priority, and free-text search', () => {
  const rows = enrichIncidentsWithZone(
    [
      incident({ id: 'a', status: 'ON_SCENE', priority: 'HIGH', rescueCode: 'NJT-AAA-11', description: 'near the mosque' }),
      incident({ id: 'b', status: 'NEW', priority: 'LOW', rescueCode: 'NJT-BBB-22', callerName: 'Synthetic Caller 9' }),
    ],
    [],
    []
  );

  it('filters by status list', () => {
    expect(queryIncidents(rows, { status: ['NEW'] }).map((r) => r.id)).toEqual(['b']);
  });

  it('filters by priority list', () => {
    expect(queryIncidents(rows, { priority: ['HIGH'] }).map((r) => r.id)).toEqual(['a']);
  });

  it('searches rescueCode case-insensitively', () => {
    expect(queryIncidents(rows, { searchText: 'bbb' }).map((r) => r.id)).toEqual(['b']);
  });

  it('searches description', () => {
    expect(queryIncidents(rows, { searchText: 'mosque' }).map((r) => r.id)).toEqual(['a']);
  });

  it('searches callerName', () => {
    expect(queryIncidents(rows, { searchText: 'Caller 9' }).map((r) => r.id)).toEqual(['b']);
  });

  it('combines multiple filters with AND semantics', () => {
    expect(queryIncidents(rows, { status: ['NEW'], priority: ['HIGH'] })).toHaveLength(0);
  });
});

describe('incidentAgeMinutes', () => {
  it('measures against `now` for an open incident', () => {
    const inc = incident({ createdAt: new Date('2026-08-24T10:00:00Z'), closedAt: null });
    expect(incidentAgeMinutes(inc, new Date('2026-08-24T10:30:00Z'))).toBe(30);
  });

  it('measures against closedAt for a closed incident, ignoring `now`', () => {
    const inc = incident({ createdAt: new Date('2026-08-24T10:00:00Z'), closedAt: new Date('2026-08-24T10:45:00Z') });
    expect(incidentAgeMinutes(inc, new Date('2026-08-25T00:00:00Z'))).toBe(45);
  });
});
