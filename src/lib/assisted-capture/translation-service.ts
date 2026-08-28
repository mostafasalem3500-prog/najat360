/**
 * translateWithFallback — the concrete "timeout ثم fallback إلى الإدخال
 * اليدوي" (spec 30.4 rule #8) wiring for the translation step specifically.
 * Wraps any `TranslationProvider` (mock, local-glossary, or — later, behind
 * an environment flag — a real cloud provider) with `runWithTimeoutFallback`.
 *
 * On timeout or a thrown error from `provider.translate()`, this returns
 * the ORIGINAL untranslated `sourceText` tagged with a `fallbackReason` and
 * `provider: 'manual-entry-fallback'` — a sentinel value future UI code can
 * check to route the call-taker straight to manual entry instead of
 * displaying a translation that never actually happened. This is a
 * distinct, outer layer from `LocalGlossaryTranslationProvider`'s own
 * internal GLOSSARY_MISS fallback (which is a normal, non-erroring return
 * for an unrecognized phrase) — this wrapper only engages when the
 * provider call itself times out or fails outright.
 */
import { runWithTimeoutFallback } from './timeout-fallback';
import type { TranslationInput, TranslationProvider, TranslationResult } from './provider';

/** Chosen conservatively short so a live call-taker screen never stalls waiting on a translation provider — well under typical UI patience thresholds (~2-3s), with headroom for network jitter on a real provider. */
export const DEFAULT_TRANSLATION_TIMEOUT_MS = 4000;

export const MANUAL_ENTRY_FALLBACK_PROVIDER_NAME = 'manual-entry-fallback';

export interface TranslateWithFallbackOptions {
  provider: TranslationProvider;
  input: TranslationInput;
  timeoutMs?: number;
}

export async function translateWithFallback(options: TranslateWithFallbackOptions): Promise<TranslationResult> {
  const { provider, input, timeoutMs = DEFAULT_TRANSLATION_TIMEOUT_MS } = options;

  const outcome = await runWithTimeoutFallback(() => provider.translate(input), {
    timeoutMs,
    fallback: (reason) => ({
      translatedText: input.sourceText,
      provider: MANUAL_ENTRY_FALLBACK_PROVIDER_NAME,
      modelVersion: 'n/a',
      fallbackReason: reason,
    }),
  });

  return outcome.value;
}
