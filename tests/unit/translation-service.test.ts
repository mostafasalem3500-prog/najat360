import { describe, expect, it, vi } from 'vitest';
import { translateWithFallback } from '@/lib/assisted-capture/translation-service';
import { LocalGlossaryTranslationProvider } from '@/lib/assisted-capture/local-glossary-provider';
import type { TranslationProvider } from '@/lib/assisted-capture/provider';

const baseInput = {
  incidentId: 'inc-1',
  sourceText: 'i need help',
  sourceLanguage: 'en',
  targetLanguage: 'ar',
};

describe('translateWithFallback', () => {
  it('returns the provider result unchanged when it resolves in time', async () => {
    const provider = new LocalGlossaryTranslationProvider();
    const result = await translateWithFallback({ provider, input: baseInput });
    expect(result.translatedText).toBe('أحتاج مساعدة');
    expect(result.fallbackReason).toBeUndefined();
  });

  it('falls back to the untranslated source text, tagged manual-entry, when the provider throws', async () => {
    const brokenProvider: TranslationProvider = {
      name: 'broken',
      translate: () => Promise.reject(new Error('provider is down')),
      health: async () => ({ status: 'UNREACHABLE', provider: 'broken' }),
    };
    const result = await translateWithFallback({ provider: brokenProvider, input: baseInput });
    expect(result.translatedText).toBe(baseInput.sourceText);
    expect(result.provider).toBe('manual-entry-fallback');
    expect(result.fallbackReason).toBe('PROVIDER_ERROR');
  });

  it('falls back with PROVIDER_TIMEOUT when the provider never resolves before the timeout', async () => {
    vi.useFakeTimers();
    try {
      const hangingProvider: TranslationProvider = {
        name: 'hanging',
        translate: () => new Promise(() => {}),
        health: async () => ({ status: 'DEGRADED', provider: 'hanging' }),
      };
      const resultPromise = translateWithFallback({ provider: hangingProvider, input: baseInput, timeoutMs: 50 });
      await vi.advanceTimersByTimeAsync(50);
      const result = await resultPromise;
      expect(result.fallbackReason).toBe('PROVIDER_TIMEOUT');
      expect(result.translatedText).toBe(baseInput.sourceText);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a GLOSSARY_MISS from the provider itself passes through unchanged — it is not caught by the outer timeout/error fallback', async () => {
    const provider = new LocalGlossaryTranslationProvider();
    const result = await translateWithFallback({
      provider,
      input: { ...baseInput, sourceText: 'unrecognized phrase entirely' },
    });
    expect(result.fallbackReason).toBe('GLOSSARY_MISS');
    expect(result.provider).toBe('local-glossary-translation-provider');
  });
});
