/**
 * Generic "timeout ثم fallback إلى الإدخال اليدوي" (spec 30.4, rule #8)
 * primitive. Any AssistedCaptureProvider/TranslationProvider call site
 * wraps its provider call with this instead of hand-rolling its own
 * Promise.race + try/catch, so every call site gets identical, tested
 * timeout behavior and a consistently typed `FallbackReason`.
 *
 * This module does not know what "manual entry" means for any particular
 * caller — that is the caller's `fallback` callback's job (e.g. the
 * translation service returns the untranslated source text tagged
 * `PROVIDER_TIMEOUT`/`PROVIDER_ERROR` so the UI can route the call-taker to
 * manual entry; see translation-service.ts).
 */
import type { FallbackReason } from './provider';

export class ProviderTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Provider call exceeded ${timeoutMs}ms timeout`);
    this.name = 'ProviderTimeoutError';
  }
}

export interface FallbackOutcome<T> {
  value: T;
  usedFallback: boolean;
  fallbackReason?: FallbackReason;
}

export interface RunWithTimeoutFallbackOptions<T> {
  timeoutMs: number;
  /** Called with the reason the primary path failed; returns (or resolves to) the fallback value. Errors thrown here are NOT caught — a broken fallback path should fail loudly rather than pretend to succeed. */
  fallback: (reason: FallbackReason) => T | Promise<T>;
}

/**
 * Races `operation()` against a timeout. On timeout, or if `operation()`
 * itself rejects, calls `options.fallback(reason)` and returns its result
 * with `usedFallback: true`. Never throws for a timeout or an operation
 * rejection — those are exactly the two cases this function exists to turn
 * into a usable fallback result instead of an unhandled failure reaching
 * the UI.
 */
export async function runWithTimeoutFallback<T>(
  operation: () => Promise<T>,
  options: RunWithTimeoutFallbackOptions<T>
): Promise<FallbackOutcome<T>> {
  const { timeoutMs, fallback } = options;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ProviderTimeoutError(timeoutMs)), timeoutMs);
  });

  try {
    const value = await Promise.race([operation(), timeoutPromise]);
    return { value, usedFallback: false };
  } catch (err) {
    const reason: FallbackReason = err instanceof ProviderTimeoutError ? 'PROVIDER_TIMEOUT' : 'PROVIDER_ERROR';
    const value = await fallback(reason);
    return { value, usedFallback: true, fallbackReason: reason };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
