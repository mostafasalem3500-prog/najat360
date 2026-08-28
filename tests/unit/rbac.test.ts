import { describe, expect, it } from 'vitest';
import {
  assertCanPerformAction,
  canPerformAction,
  canViewIncidentRow,
  ForbiddenActionError,
  serializeIncidentForRole,
  serializeUnitForRole,
  type Viewer,
} from '@/lib/auth/rbac';
import type { AmbulanceUnit, Incident } from '@/lib/domain/types';

function buildIncident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: 'inc-1',
    rescueCode: 'NJT-7K4-92',
    callerTokenHash: 'hash-of-token',
    callerTokenExpiresAt: new Date('2026-08-24T12:30:00Z'),
    status: 'DISPATCHED',
    priority: 'HIGH',
    proposedPriority: 'HIGH',
    latitude: 24.7136,
    longitude: 46.6753,
    gpsAccuracyMeters: 12,
    uncertaintyRadiusMeters: 30,
    confidenceScore: 82,
    placeType: 'RESIDENTIAL',
    floorLevel: '3',
    language: 'ar',
    unableToSpeak: false,
    callerName: 'Synthetic Caller',
    callerPhone: '+9665xxxxxxx',
    suggestedEntranceId: 'ent-1',
    assignedEntranceId: 'ent-1',
    assignedUnitId: 'unit-1',
    synthetic: true,
    createdAt: new Date('2026-08-24T12:00:00Z'),
    updatedAt: new Date('2026-08-24T12:00:00Z'),
    ...overrides,
  };
}

function buildUnit(overrides: Partial<AmbulanceUnit> = {}): AmbulanceUnit {
  return {
    id: 'unit-1',
    code: 'A-12',
    label: 'Ambulance 12',
    crewType: 'AMBULANCE',
    status: 'AVAILABLE',
    readinessScore: 90,
    homeZone: 'zone-1',
    synthetic: true,
    createdAt: new Date('2026-08-24T12:00:00Z'),
    updatedAt: new Date('2026-08-24T12:00:00Z'),
    ...overrides,
  };
}

describe('rbac — field-level view models', () => {
  it('HOSPITAL_LIAISON never receives caller identifying fields (spec 30.14 #8)', () => {
    const incident = buildIncident();
    const viewer: Viewer = { role: 'HOSPITAL_LIAISON', userId: 'u-1' };
    const projected = serializeIncidentForRole(incident, viewer);
    expect(projected).not.toBeNull();
    expect(projected).not.toHaveProperty('callerName');
    expect(projected).not.toHaveProperty('callerPhone');
  });

  it('ADMIN receives no medical/caller content by default', () => {
    const incident = buildIncident();
    const viewer: Viewer = { role: 'ADMIN', userId: 'u-admin' };
    const projected = serializeIncidentForRole(incident, viewer);
    expect(projected).toEqual({ id: 'inc-1', rescueCode: 'NJT-7K4-92', status: 'DISPATCHED', synthetic: true });
  });

  it('ANALYST never receives raw coordinates or caller fields', () => {
    const incident = buildIncident();
    const viewer: Viewer = { role: 'ANALYST', userId: 'u-analyst' };
    const projected = serializeIncidentForRole(incident, viewer);
    expect(projected).not.toHaveProperty('latitude');
    expect(projected).not.toHaveProperty('longitude');
    expect(projected).not.toHaveProperty('callerName');
    expect(projected).not.toHaveProperty('callerPhone');
  });

  it('SUPERVISOR has full field visibility', () => {
    const incident = buildIncident();
    const viewer: Viewer = { role: 'SUPERVISOR', userId: 'u-sup' };
    const projected = serializeIncidentForRole(incident, viewer);
    expect(projected).toMatchObject({
      callerName: incident.callerName,
      callerPhone: incident.callerPhone,
      assignedUnitId: incident.assignedUnitId,
    });
  });

  it('never projects a field absent from the source object, even if role allowlist names it', () => {
    const incident = buildIncident({ priority: null });
    const viewer: Viewer = { role: 'CALL_TAKER', userId: 'u-ct' };
    const projected = serializeIncidentForRole(incident, viewer);
    // priority is explicitly null on the incident and IS in the allowlist,
    // so it must still come through as null (present), not be silently dropped.
    expect(projected).toHaveProperty('priority', null);
  });

  it('unit projection differs by role', () => {
    const unit = buildUnit();
    const supervisorView = serializeUnitForRole(unit, { role: 'SUPERVISOR', userId: 'u-sup' });
    const callerView = serializeUnitForRole(unit, { role: 'CALLER', userId: 'u-caller' });
    expect(supervisorView).toHaveProperty('readinessScore');
    expect(callerView).toEqual({});
  });
});

describe('rbac — row-level access (FieldLink)', () => {
  it('MEDIC can view only the incident assigned to their own unit (spec 30.14 #5)', () => {
    const incident = buildIncident({ assignedUnitId: 'unit-1' });
    const ownUnitViewer: Viewer = { role: 'MEDIC', userId: 'medic-1', unitId: 'unit-1' };
    const otherUnitViewer: Viewer = { role: 'MEDIC', userId: 'medic-2', unitId: 'unit-2' };

    expect(canViewIncidentRow(ownUnitViewer, incident)).toBe(true);
    expect(canViewIncidentRow(otherUnitViewer, incident)).toBe(false);
    expect(serializeIncidentForRole(incident, otherUnitViewer)).toBeNull();
  });

  it('MEDIC with no unit assignment at all can view nothing', () => {
    const incident = buildIncident({ assignedUnitId: 'unit-1' });
    const unassignedMedic: Viewer = { role: 'MEDIC', userId: 'medic-3', unitId: null };
    expect(canViewIncidentRow(unassignedMedic, incident)).toBe(false);
  });

  it('a MEDIC-shaped serialization excludes callerName/callerPhone even for their own incident', () => {
    const incident = buildIncident({ assignedUnitId: 'unit-1' });
    const viewer: Viewer = { role: 'MEDIC', userId: 'medic-1', unitId: 'unit-1' };
    const projected = serializeIncidentForRole(incident, viewer);
    expect(projected).not.toHaveProperty('callerName');
    expect(projected).not.toHaveProperty('callerPhone');
  });

  it('non-MEDIC roles are not row-scoped by unit assignment', () => {
    const incident = buildIncident({ assignedUnitId: 'unit-1' });
    const viewer: Viewer = { role: 'SUPERVISOR', userId: 'u-sup' };
    expect(canViewIncidentRow(viewer, incident)).toBe(true);
  });
});

describe('rbac — action-level permissions', () => {
  it('only SUPERVISOR may decide dispatch', () => {
    expect(canPerformAction('SUPERVISOR', 'DECIDE_DISPATCH')).toBe(true);
    expect(canPerformAction('CALL_TAKER', 'DECIDE_DISPATCH')).toBe(false);
    expect(canPerformAction('MEDIC', 'DECIDE_DISPATCH')).toBe(false);
  });

  it('CALL_TAKER may confirm location but not decide dispatch (spec: يراجع AI draft ويثبت location، ولا يعتمد dispatch)', () => {
    expect(canPerformAction('CALL_TAKER', 'CONFIRM_LOCATION')).toBe(true);
    expect(canPerformAction('CALL_TAKER', 'DECIDE_DISPATCH')).toBe(false);
  });

  it('only HOSPITAL_LIAISON updates hospital status', () => {
    expect(canPerformAction('HOSPITAL_LIAISON', 'UPDATE_OWN_HOSPITAL_STATUS')).toBe(true);
    expect(canPerformAction('SUPERVISOR', 'UPDATE_OWN_HOSPITAL_STATUS')).toBe(false);
  });

  it('only MEDIC submits FieldLink actions (C5)', () => {
    expect(canPerformAction('MEDIC', 'SUBMIT_FIELD_ACTION')).toBe(true);
    expect(canPerformAction('CALL_TAKER', 'SUBMIT_FIELD_ACTION')).toBe(false);
    expect(canPerformAction('SUPERVISOR', 'SUBMIT_FIELD_ACTION')).toBe(false);
  });

  it('only ADMIN configures providers', () => {
    expect(canPerformAction('ADMIN', 'CONFIGURE_PROVIDERS')).toBe(true);
    expect(canPerformAction('ANALYST', 'CONFIGURE_PROVIDERS')).toBe(false);
  });

  it('assertCanPerformAction throws ForbiddenActionError for a disallowed pair', () => {
    expect(() => assertCanPerformAction('MEDIC', 'CONFIGURE_PROVIDERS')).toThrow(ForbiddenActionError);
  });

  it('assertCanPerformAction does not throw for an allowed pair', () => {
    expect(() => assertCanPerformAction('SUPERVISOR', 'DECIDE_DISPATCH')).not.toThrow();
  });
});
