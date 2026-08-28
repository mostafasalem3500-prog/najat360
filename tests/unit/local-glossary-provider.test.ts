import { describe, expect, it } from 'vitest';
import { GLOSSARY_ENTRIES, LocalGlossaryTranslationProvider } from '@/lib/assisted-capture/local-glossary-provider';

describe('LocalGlossaryTranslationProvider', () => {
  const provider = new LocalGlossaryTranslationProvider();

  it('translates every glossary entry to its exact fixed target text', async () => {
    for (const entry of GLOSSARY_ENTRIES) {
      const result = await provider.translate({
        incidentId: 'inc-1',
        sourceText: entry.sourcePhrase,
        sourceLanguage: entry.sourceLanguage,
        targetLanguage: entry.targetLanguage,
      });
      expect(result.translatedText).toBe(entry.translatedText);
      expect(result.fallbackReason).toBeUndefined();
    }
  });

  it('matches case-insensitively and tolerates surrounding whitespace', async () => {
    const result = await provider.translate({
      incidentId: 'inc-1',
      sourceText: '  I NEED help  ',
      sourceLanguage: 'en',
      targetLanguage: 'ar',
    });
    expect(result.translatedText).toBe('أحتاج مساعدة');
  });

  it('returns GLOSSARY_MISS for a phrase not in the fixed dictionary, echoing the source text unchanged', async () => {
    const result = await provider.translate({
      incidentId: 'inc-1',
      sourceText: 'the weather is nice today',
      sourceLanguage: 'en',
      targetLanguage: 'ar',
    });
    expect(result.fallbackReason).toBe('GLOSSARY_MISS');
    expect(result.translatedText).toBe('the weather is nice today');
  });

  it('does not cross-match a phrase against the wrong source language', async () => {
    const result = await provider.translate({
      incidentId: 'inc-1',
      sourceText: 'i need help',
      sourceLanguage: 'tl', // this exact phrase is only registered under 'en'
      targetLanguage: 'ar',
    });
    expect(result.fallbackReason).toBe('GLOSSARY_MISS');
  });

  it('health() reports SIMULATED — pure in-memory lookup, no network I/O', async () => {
    const health = await provider.health();
    expect(health.status).toBe('SIMULATED');
    expect(health.provider).toBe('local-glossary-translation-provider');
  });

  it('every glossary entry targets Arabic, matching this phase scope', () => {
    for (const entry of GLOSSARY_ENTRIES) {
      expect(entry.targetLanguage).toBe('ar');
    }
  });
});
