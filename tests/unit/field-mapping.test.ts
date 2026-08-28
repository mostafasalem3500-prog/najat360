import { describe, expect, it } from 'vitest';
import { mapAllowedFieldToIncidentPatch } from '@/lib/assisted-capture/field-mapping';
import { ALLOWLIST } from '@/lib/assisted-capture/allowlist';

describe('field-mapping', () => {
  it('maps preferredLanguage to the real `language` column, not a nonexistent preferredLanguage column', () => {
    expect(mapAllowedFieldToIncidentPatch('preferredLanguage', 'ur')).toEqual({ language: 'ur' });
  });

  it('maps the remaining allowlisted fields 1:1 to their own-named column', () => {
    expect(mapAllowedFieldToIncidentPatch('floorLevel', '3')).toEqual({ floorLevel: '3' });
    expect(mapAllowedFieldToIncidentPatch('landmarkText', 'near the mosque')).toEqual({
      landmarkText: 'near the mosque',
    });
    expect(mapAllowedFieldToIncidentPatch('reportedPatientCount', 2)).toEqual({ reportedPatientCount: 2 });
  });

  it('every field in ALLOWLIST has a mapping — none silently falls through', () => {
    for (const field of ALLOWLIST) {
      const patch = mapAllowedFieldToIncidentPatch(field, 'x');
      expect(Object.keys(patch)).toHaveLength(1);
    }
  });
});
