import { describe, expect, it } from 'vitest';
import {
  overrideLocation,
  MissingLocationOverrideReasonError,
  MissingOverriddenByError,
  type OverrideLocationInput,
} from '@/lib/location/override';
import type { ObservationForResolution } from '@/lib/location/resolver';

const NOW = new Date('2026-08-24T12:00:00.000Z');

function baseInput(overrides: Partial<OverrideLocationInput> = {}): OverrideLocationInput {
  return {
    incidentId: 'inc-1',
    newObservationId: 'obs-override-1',
    overriddenById: 'calltaker-1',
    reason: 'caller clarified they are at the north gate, not the anchor point',
    newObservation: {
      latitude: 24.7136,
      longitude: 46.6753,
      horizontalAccuracyMeters: 20,
      capturedAt: NOW,
    },
    existingObservations: [],
    now: NOW,
    ...overrides,
  };
}

describe('overrideLocation', () => {
  it('throws MissingOverriddenByError when overriddenById is empty or whitespace', () => {
    expect(() => overrideLocation(baseInput({ overriddenById: '' }))).toThrow(MissingOverriddenByError);
    expect(() => overrideLocation(baseInput({ overriddenById: '   ' }))).toThrow(MissingOverriddenByError);
  });

  it('throws MissingLocationOverrideReasonError when reason is missing or too short', () => {
    expect(() => overrideLocation(baseInput({ reason: '' }))).toThrow(MissingLocationOverrideReasonError);
    expect(() => overrideLocation(baseInput({ reason: 'hi' }))).toThrow(MissingLocationOverrideReasonError);
  });

  it('checks overriddenById before reason (a missing user fails for the right error even with no reason)', () => {
    expect(() => overrideLocation(baseInput({ overriddenById: '', reason: '' }))).toThrow(MissingOverriddenByError);
  });

  it('builds a new observation always sourced as CALL_TAKER, never MANUAL_PIN', () => {
    const result = overrideLocation(baseInput());
    expect(result.observation.source).toBe('CALL_TAKER');
  });

  it('tags the new observation metadata with coordinateAuthority HUMAN_OVERRIDE plus the audit fields', () => {
    const result = overrideLocation(baseInput());
    expect(result.observation.metadata).toMatchObject({
      coordinateAuthority: 'HUMAN_OVERRIDE',
      overriddenById: 'calltaker-1',
      reason: 'caller clarified they are at the north gate, not the anchor point',
    });
  });

  it('uses the caller-supplied newObservationId as the observation id', () => {
    const result = overrideLocation(baseInput({ newObservationId: 'my-custom-id' }));
    expect(result.observation.id).toBe('my-custom-id');
  });

  it('with no existing observations, the override becomes the sole (and therefore primary) observation with no conflict', () => {
    const result = overrideLocation(baseInput({ existingObservations: [] }));
    expect(result.resolution.hasConflict).toBe(false);
    expect(result.resolution.primaryObservationId).toBe('obs-override-1');
  });

  it('does NOT automatically win against a higher-priority existing ANCHOR_QR observation far away — it surfaces as a conflict instead', () => {
    const anchorObservation: ObservationForResolution = {
      id: 'obs-anchor-1',
      source: 'ANCHOR_QR',
      latitude: 24.7136,
      longitude: 46.6753,
      horizontalAccuracyMeters: 3,
      capturedAt: NOW,
    };
    // ~500m away from the anchor observation — well past the 60m conflict threshold.
    const result = overrideLocation(
      baseInput({
        existingObservations: [anchorObservation],
        newObservation: { latitude: 24.7181, longitude: 46.6753, horizontalAccuracyMeters: 20, capturedAt: NOW },
      })
    );
    // ANCHOR_QR (priority 7) still outranks CALL_TAKER (priority 5), so the anchor stays primary...
    expect(result.resolution.primaryObservationId).toBe('obs-anchor-1');
    // ...and the human override is surfaced as a conflicting observation, not silently dropped or auto-winning.
    expect(result.resolution.hasConflict).toBe(true);
    expect(result.resolution.conflictingObservationIds).toContain('obs-override-1');
  });

  it('merges the override into the full existing observation history rather than replacing it', () => {
    const existing: ObservationForResolution[] = [
      { id: 'obs-1', source: 'BROWSER_GPS', latitude: 24.7136, longitude: 46.6753, capturedAt: NOW },
      { id: 'obs-2', source: 'LANDMARK', latitude: 24.7137, longitude: 46.6754, capturedAt: NOW },
    ];
    const result = overrideLocation(baseInput({ existingObservations: existing }));
    // primary should be the CALL_TAKER override (priority 5) since it outranks BROWSER_GPS (2) and LANDMARK (3).
    expect(result.resolution.primaryObservationId).toBe('obs-override-1');
    // both prior observations remain accounted for (either supporting or conflicting), not silently dropped.
    const accountedFor = [...result.resolution.supportingObservationIds, ...result.resolution.conflictingObservationIds];
    expect(accountedFor).toContain('obs-1');
    expect(accountedFor).toContain('obs-2');
  });

  it('does not mutate the existingObservations array passed in', () => {
    const existing: ObservationForResolution[] = [
      { id: 'obs-1', source: 'BROWSER_GPS', latitude: 24.7136, longitude: 46.6753, capturedAt: NOW },
    ];
    const snapshot = JSON.parse(JSON.stringify(existing));
    overrideLocation(baseInput({ existingObservations: existing }));
    expect(JSON.parse(JSON.stringify(existing))).toEqual(snapshot);
  });

  it('propagates the real resolveLocation() algorithm version, never a hardcoded/fake one', () => {
    const result = overrideLocation(baseInput());
    expect(result.resolution.algorithmVersion).toBe('location-resolver-v1');
  });

  it('returns the overriddenById and reason alongside the observation/resolution', () => {
    const result = overrideLocation(baseInput({ overriddenById: 'calltaker-9', reason: 'a genuinely valid reason here' }));
    expect(result.overriddenById).toBe('calltaker-9');
    expect(result.reason).toBe('a genuinely valid reason here');
  });
});
