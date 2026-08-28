import { describe, expect, it } from 'vitest';
import { ALLOWLIST } from '@/lib/assisted-capture/allowlist';
import { MockAssistedCaptureProvider } from '@/lib/assisted-capture/mock-provider';
import { LocalGlossaryTranslationProvider } from '@/lib/assisted-capture/local-glossary-provider';
import type { AssistedCaptureProvider } from '@/lib/assisted-capture/provider';

describe('MockAssistedCaptureProvider', () => {
  const provider = new MockAssistedCaptureProvider();

  it('delegates translate() to the injected TranslationProvider (LocalGlossaryTranslationProvider by default)', async () => {
    const result = await provider.translate({
      incidentId: 'inc-1',
      sourceText: 'i need help',
      sourceLanguage: 'en',
      targetLanguage: 'ar',
    });
    expect(result.translatedText).toBe('أحتاج مساعدة');
  });

  it('extracts floorLevel from a floor mention', async () => {
    const suggestions = await provider.extractOperationalFields({
      incidentId: 'inc-1',
      draftId: 'draft-1',
      translatedText: 'نحن في الطابق الثالث',
      sourceLanguage: 'en',
    });
    expect(suggestions).toContainEqual(
      expect.objectContaining({ fieldName: 'floorLevel', suggestedValue: '3', confidence: 0.9 })
    );
  });

  it('extracts both accessObstacle and entranceOrGateHint when the closed-gate phrase appears', async () => {
    const suggestions = await provider.extractOperationalFields({
      incidentId: 'inc-1',
      draftId: 'draft-1',
      translatedText: 'البوابة الخلفية مغلقة',
      sourceLanguage: 'en',
    });
    const fieldNames = suggestions.map((s) => s.fieldName).sort();
    expect(fieldNames).toEqual(['accessObstacle', 'entranceOrGateHint'].sort());
  });

  it('extracts reportedPatientCount from the fixed two-injured phrase', async () => {
    const suggestions = await provider.extractOperationalFields({
      incidentId: 'inc-1',
      draftId: 'draft-1',
      translatedText: 'يوجد شخصان مصابان بالقرب من البوابة الخلفية',
      sourceLanguage: 'en',
    });
    expect(suggestions).toContainEqual(expect.objectContaining({ fieldName: 'reportedPatientCount', suggestedValue: 2 }));
  });

  it('produces multiple independent suggestions when several rules match the same text', async () => {
    const suggestions = await provider.extractOperationalFields({
      incidentId: 'inc-1',
      draftId: 'draft-1',
      translatedText: 'نحن في الطابق الثالث والبوابة الخلفية مغلقة ويوجد شخصان مصابان',
      sourceLanguage: 'en',
    });
    const fieldNames = suggestions.map((s) => s.fieldName).sort();
    expect(fieldNames).toEqual(['accessObstacle', 'entranceOrGateHint', 'floorLevel', 'reportedPatientCount'].sort());
  });

  it('does NOT extract a suggestion for medical/diagnostic phrases even though they appear in the demo glossary', async () => {
    // "cannot breathe" / "unconscious" are real glossary phrases (see
    // local-glossary-provider.ts) but neither maps to any ALLOWLIST field —
    // this asserts the mock provider deliberately does not infer a
    // medical condition from caller speech.
    const suggestions = await provider.extractOperationalFields({
      incidentId: 'inc-1',
      draftId: 'draft-1',
      translatedText: 'لا يستطيع التنفس وهو فاقد الوعي',
      sourceLanguage: 'en',
    });
    expect(suggestions).toEqual([]);
  });

  it('returns no suggestions for text matching none of the extraction rules', async () => {
    const suggestions = await provider.extractOperationalFields({
      incidentId: 'inc-1',
      draftId: 'draft-1',
      translatedText: 'نص عشوائي لا علاقة له بأي قاعدة',
      sourceLanguage: 'en',
    });
    expect(suggestions).toEqual([]);
  });

  it('every produced suggestion names a field that is actually in ALLOWLIST (defense in depth on the test side too)', async () => {
    const suggestions = await provider.extractOperationalFields({
      incidentId: 'inc-1',
      draftId: 'draft-1',
      translatedText: 'نحن في الطابق الثالث والبوابة الخلفية مغلقة ويوجد شخصان مصابان',
      sourceLanguage: 'en',
    });
    for (const s of suggestions) {
      expect(ALLOWLIST).toContain(s.fieldName);
    }
  });

  it('caps evidenceTextMasked at 240 chars (enforced by validateAssistedSuggestion, which every candidate passes through)', async () => {
    const longPadding = 'س'.repeat(400);
    const suggestions = await provider.extractOperationalFields({
      incidentId: 'inc-1',
      draftId: 'draft-1',
      translatedText: `${longPadding}نحن في الطابق الثالث${longPadding}`,
      sourceLanguage: 'en',
    });
    const floorSuggestion = suggestions.find((s) => s.fieldName === 'floorLevel');
    expect(floorSuggestion?.evidenceTextMasked?.length).toBeLessThanOrEqual(240);
  });

  it('accepts a custom TranslationProvider via constructor injection', async () => {
    const custom = new MockAssistedCaptureProvider(new LocalGlossaryTranslationProvider());
    const result = await custom.translate({
      incidentId: 'inc-1',
      sourceText: 'i need help',
      sourceLanguage: 'en',
      targetLanguage: 'ar',
    });
    expect(result.translatedText).toBe('أحتاج مساعدة');
  });

  it('health() reports SIMULATED', async () => {
    const health = await provider.health();
    expect(health.status).toBe('SIMULATED');
    expect(health.provider).toBe('mock-assisted-capture-provider');
  });

  it('has no transcribe() implementation — audio path is deliberately unbuilt in this phase', () => {
    const asInterface: AssistedCaptureProvider = provider;
    expect(asInterface.transcribe).toBeUndefined();
  });
});
