import { describe, expect, it } from 'vitest';
import {
  acceptSuggestion,
  ALLOWED_FIELD_VALUE_SCHEMAS,
  ALLOWLIST,
  AssistedFieldSuggestionSchema,
  DENYLIST,
  isAllowedField,
  isDeniedField,
  SuggestionRejectedError,
  validateAssistedSuggestion,
  validateSuggestedValueForField,
} from '@/lib/assisted-capture/allowlist';

describe('allowlist — layer 2: runtime schema validation', () => {
  it('accepts a well-formed suggestion for an allowlisted field', () => {
    const parsed = validateAssistedSuggestion({
      draftId: 'draft-1',
      fieldName: 'floorLevel',
      suggestedValue: '3',
      confidence: 0.8,
    });
    expect(parsed.fieldName).toBe('floorLevel');
  });

  it.each(DENYLIST)('rejects every denylisted field at the schema layer: %s', (field) => {
    expect(() =>
      validateAssistedSuggestion({
        draftId: 'draft-1',
        fieldName: field,
        suggestedValue: 'ALPHA-1',
        confidence: 0.9,
      })
    ).toThrow(SuggestionRejectedError);
  });

  it('rejects a field name that is neither allowlisted nor denylisted (unknown field)', () => {
    expect(() =>
      validateAssistedSuggestion({
        draftId: 'draft-1',
        fieldName: 'someRandomFutureField',
        suggestedValue: 'x',
        confidence: 0.5,
      })
    ).toThrow(SuggestionRejectedError);
  });

  it('rejects out-of-range confidence', () => {
    const result = AssistedFieldSuggestionSchema.safeParse({
      draftId: 'draft-1',
      fieldName: 'landmarkText',
      suggestedValue: 'near the mosque',
      confidence: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it('rejects fuzz input entirely unlike a suggestion object', () => {
    expect(() => validateAssistedSuggestion(null)).toThrow(SuggestionRejectedError);
    expect(() => validateAssistedSuggestion('just a string')).toThrow(SuggestionRejectedError);
    expect(() => validateAssistedSuggestion(42)).toThrow(SuggestionRejectedError);
    expect(() => validateAssistedSuggestion({})).toThrow(SuggestionRejectedError);
  });

  it('ALLOWED_FIELD_VALUE_SCHEMAS has exactly one entry per ALLOWLIST field — no more, no fewer', () => {
    expect(Object.keys(ALLOWED_FIELD_VALUE_SCHEMAS).sort()).toEqual([...ALLOWLIST].sort());
  });

  // Adversarial: an allowlisted field name paired with a value shape that
  // does not match that field's real type/range must still be rejected —
  // this is the exact gap `suggestedValue: z.unknown()` used to leave open
  // (found by comparing against an independent second implementation).
  it.each([
    ['reportedPatientCount', 'many', 'a string where an integer is required'],
    ['reportedPatientCount', 0, 'below the minimum of 1'],
    ['reportedPatientCount', 51, 'above the maximum of 50'],
    ['reportedPatientCount', 2.5, 'a non-integer number'],
    ['unableToSpeak', 'yes', 'a string where a boolean is required'],
    ['placeType', 'SPACESHIP', 'a value outside the real PlaceType enum'],
    ['preferredCommunicationMode', 'TELEPATHY', 'a value outside the real enum'],
    ['preferredLanguage', 'x', 'shorter than the minimum length'],
    ['floorLevel', 'B'.repeat(25), 'longer than the maximum length'],
  ] as const)('rejects field "%s" when suggestedValue is %s (%s)', (fieldName, badValue, _reason) => {
    const result = AssistedFieldSuggestionSchema.safeParse({
      draftId: 'draft-1',
      fieldName,
      suggestedValue: badValue,
      confidence: 0.8,
    });
    expect(result.success).toBe(false);
  });
});

describe('validateSuggestedValueForField — standalone per-field value re-validation', () => {
  it('accepts a value matching the field real shape', () => {
    expect(validateSuggestedValueForField('reportedPatientCount', 3)).toBe(3);
  });

  it('rejects a wrong-shaped value for an allowed field', () => {
    expect(() => validateSuggestedValueForField('reportedPatientCount', 'three')).toThrow(SuggestionRejectedError);
  });
});

describe('allowlist — layer 1: type guards agree with the constant lists', () => {
  it('isAllowedField is true for every ALLOWLIST entry and false for every DENYLIST entry', () => {
    for (const field of ALLOWLIST) {
      expect(isAllowedField(field)).toBe(true);
    }
    for (const field of DENYLIST) {
      expect(isAllowedField(field)).toBe(false);
    }
  });

  it('isDeniedField is true for every DENYLIST entry and false for every ALLOWLIST entry', () => {
    for (const field of DENYLIST) {
      expect(isDeniedField(field)).toBe(true);
    }
    for (const field of ALLOWLIST) {
      expect(isDeniedField(field)).toBe(false);
    }
  });

  it('ALLOWLIST and DENYLIST are disjoint', () => {
    const overlap = ALLOWLIST.filter((f) => (DENYLIST as readonly string[]).includes(f));
    expect(overlap).toEqual([]);
  });
});

describe('allowlist — layer 4: acceptSuggestion gatekeeper', () => {
  it('accepts a pending allowlisted suggestion for a human reviewer', () => {
    const result = acceptSuggestion({
      suggestion: {
        id: 'sugg-1',
        fieldName: 'preferredLanguage',
        suggestedValue: 'ur',
        status: 'PENDING',
      },
      reviewedById: 'call-taker-1',
    });
    expect(result).toEqual({
      fieldName: 'preferredLanguage',
      valueToWrite: 'ur',
      reviewedById: 'call-taker-1',
      wasEdited: false,
    });
  });

  it('uses the reviewer-edited value, and marks wasEdited, when editedValue is provided', () => {
    const result = acceptSuggestion({
      suggestion: {
        id: 'sugg-2',
        fieldName: 'floorLevel',
        suggestedValue: '3',
        status: 'PENDING',
      },
      reviewedById: 'call-taker-1',
      editedValue: '4',
    });
    expect(result.valueToWrite).toBe('4');
    expect(result.wasEdited).toBe(true);
  });

  it('refuses to accept without a reviewedById — there is no unattended acceptance path', () => {
    expect(() =>
      acceptSuggestion({
        suggestion: { id: 'sugg-3', fieldName: 'floorLevel', suggestedValue: '3', status: 'PENDING' },
        reviewedById: '   ',
      })
    ).toThrow(SuggestionRejectedError);
  });

  it.each(DENYLIST)(
    'refuses to accept a denylisted field even if it somehow reached this function: %s',
    (field) => {
      expect(() =>
        acceptSuggestion({
          suggestion: { id: 'sugg-x', fieldName: field, suggestedValue: 'X', status: 'PENDING' },
          reviewedById: 'call-taker-1',
        })
      ).toThrow(SuggestionRejectedError);
    }
  );

  it('refuses to accept an unknown field not present in ALLOWLIST', () => {
    expect(() =>
      acceptSuggestion({
        suggestion: { id: 'sugg-y', fieldName: 'notARealField', suggestedValue: 'X', status: 'PENDING' },
        reviewedById: 'call-taker-1',
      })
    ).toThrow(SuggestionRejectedError);
  });

  it('refuses to accept a reviewer edit that breaks the field real value shape', () => {
    // The AI's own suggestedValue (2) is fine; the reviewer's "correction"
    // is not a valid reportedPatientCount at all. Accepting must re-check
    // the value that will actually be written, not just the field name.
    expect(() =>
      acceptSuggestion({
        suggestion: { id: 'sugg-z', fieldName: 'reportedPatientCount', suggestedValue: 2, status: 'PENDING' },
        reviewedById: 'call-taker-1',
        editedValue: 'a lot of people',
      })
    ).toThrow(SuggestionRejectedError);
  });

  it('refuses to accept when even the original (unedited) suggestedValue does not match the field shape', () => {
    // Defense in depth: acceptSuggestion should not blindly trust that a
    // staged row already passed layer-2 validation when it was created.
    expect(() =>
      acceptSuggestion({
        suggestion: { id: 'sugg-w', fieldName: 'placeType', suggestedValue: 'SPACESHIP', status: 'PENDING' },
        reviewedById: 'call-taker-1',
      })
    ).toThrow(SuggestionRejectedError);
  });
});
