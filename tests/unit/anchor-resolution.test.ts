import { describe, expect, it } from 'vitest';
import {
  AnchorNotActiveError,
  AnchorNotFoundError,
  buildObservationFromAnchor,
  buildObservationFromDeviceInput,
  resolveAnchorToObservation,
  type AnchorLookup,
  type LocationAnchorRecord,
} from '@/lib/location/anchor-resolution';

function anchor(overrides: Partial<LocationAnchorRecord> = {}): LocationAnchorRecord {
  return {
    id: 'anchor-1',
    code: 'RA-001',
    entranceId: 'ent-1',
    latitude: 24.7136,
    longitude: 46.6753,
    anchorType: 'ENTRANCE',
    validationStatus: 'FIELD_CONFIRMED',
    validFrom: new Date('2026-01-01T00:00:00Z'),
    validUntil: null,
    active: true,
    ...overrides,
  };
}

function lookupReturning(record: LocationAnchorRecord | null): AnchorLookup {
  return { getActiveAnchorByCode: async () => record };
}

describe('buildObservationFromAnchor', () => {
  it('takes coordinates ONLY from the anchor record, never from a caller-supplied parameter', () => {
    const a = anchor({ latitude: 24.5, longitude: 46.5, floorLevel: '2' });
    const obs = buildObservationFromAnchor(a, 'inc-1', new Date('2026-08-24T10:00:00Z'));
    expect(obs.source).toBe('ANCHOR_QR');
    expect(obs.latitude).toBe(24.5);
    expect(obs.longitude).toBe(46.5);
    expect(obs.floorLevel).toBe('2');
    expect(obs.metadata.coordinateAuthority).toBe('SERVER_ANCHOR_RECORD');
    expect(obs.metadata.anchorId).toBe(a.id);
  });

  it('has no function signature parameter through which a client-supplied lat/lng could flow in', () => {
    // Structural check: buildObservationFromAnchor's arity is exactly
    // (anchor, incidentId, capturedAt) — 3 params, none of which is a
    // latitude/longitude. This test exists to fail loudly if that ever
    // changes.
    expect(buildObservationFromAnchor.length).toBe(3);
  });
});

describe('resolveAnchorToObservation', () => {
  const capturedAt = new Date('2026-08-24T10:00:00Z');

  it('resolves a valid, active anchor code to an observation', async () => {
    const obs = await resolveAnchorToObservation(lookupReturning(anchor()), 'RA-001', 'inc-1', capturedAt);
    expect(obs.source).toBe('ANCHOR_QR');
    expect(obs.incidentId).toBe('inc-1');
  });

  it('throws AnchorNotFoundError for an unknown code', async () => {
    await expect(resolveAnchorToObservation(lookupReturning(null), 'NOPE', 'inc-1', capturedAt)).rejects.toThrow(
      AnchorNotFoundError
    );
  });

  it('throws AnchorNotActiveError for an inactive anchor', async () => {
    await expect(
      resolveAnchorToObservation(lookupReturning(anchor({ active: false })), 'RA-001', 'inc-1', capturedAt)
    ).rejects.toThrow(AnchorNotActiveError);
  });

  it('throws AnchorNotActiveError when captured before validFrom', async () => {
    const future = anchor({ validFrom: new Date('2030-01-01T00:00:00Z') });
    await expect(resolveAnchorToObservation(lookupReturning(future), 'RA-001', 'inc-1', capturedAt)).rejects.toThrow(
      AnchorNotActiveError
    );
  });

  it('throws AnchorNotActiveError when captured after validUntil', async () => {
    const expired = anchor({ validUntil: new Date('2020-01-01T00:00:00Z') });
    await expect(resolveAnchorToObservation(lookupReturning(expired), 'RA-001', 'inc-1', capturedAt)).rejects.toThrow(
      AnchorNotActiveError
    );
  });

  it('does not throw when capturedAt is within [validFrom, validUntil]', async () => {
    const bounded = anchor({
      validFrom: new Date('2026-01-01T00:00:00Z'),
      validUntil: new Date('2027-01-01T00:00:00Z'),
    });
    await expect(
      resolveAnchorToObservation(lookupReturning(bounded), 'RA-001', 'inc-1', capturedAt)
    ).resolves.toBeDefined();
  });
});

describe('buildObservationFromDeviceInput', () => {
  it('tags CALLER_DEVICE coordinate authority for BROWSER_GPS', () => {
    const obs = buildObservationFromDeviceInput({
      incidentId: 'inc-1',
      source: 'BROWSER_GPS',
      latitude: 24.7,
      longitude: 46.7,
      horizontalAccuracyMeters: 12,
      capturedAt: new Date('2026-08-24T10:00:00Z'),
    });
    expect(obs.metadata.coordinateAuthority).toBe('CALLER_DEVICE');
    expect(obs.horizontalAccuracyMeters).toBe(12);
  });

  it('tags CALLER_DEVICE coordinate authority for MANUAL_PIN', () => {
    const obs = buildObservationFromDeviceInput({
      incidentId: 'inc-1',
      source: 'MANUAL_PIN',
      latitude: 24.7,
      longitude: 46.7,
      capturedAt: new Date('2026-08-24T10:00:00Z'),
    });
    expect(obs.metadata.coordinateAuthority).toBe('CALLER_DEVICE');
    expect(obs.provenanceLabel).toBe('Manually placed pin');
  });
});
