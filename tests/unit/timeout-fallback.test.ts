import { describe, expect, it, vi } from 'vitest';
import { ProviderTimeoutError, runWithTimeoutFallback } from '@/lib/assisted-capture/timeout-fallback';

describe('runWithTimeoutFallback', () => {
  it('returns the operation result directly when it resolves before the timeout', async () => {
    const outcome = await runWithTimeoutFallback(() => Promise.resolve('ok'), {
      timeoutMs: 1000,
      fallback: () => 'should-not-be-called',
    });
    expect(outcome).toEqual({ value: 'ok', usedFallback: false });
  });

  it('falls back with PROVIDER_ERROR when the operation rejects', async () => {
    const outcome = await runWithTimeoutFallback<string>(() => Promise.reject(new Error('boom')), {
      timeoutMs: 1000,
      fallback: (reason) => `fallback:${reason}`,
    });
    expect(outcome).toEqual({ value: 'fallback:PROVIDER_ERROR', usedFallback: true, fallbackReason: 'PROVIDER_ERROR' });
  });

  it('falls back with PROVIDER_TIMEOUT when the operation exceeds the timeout', async () => {
    vi.useFakeTimers();
    try {
      const never = new Promise<string>(() => {
        /* never resolves */
      });
      const outcomePromise = runWithTimeoutFallback(() => never, {
        timeoutMs: 50,
        fallback: (reason) => `fallback:${reason}`,
      });
      await vi.advanceTimersByTimeAsync(50);
      const outcome = await outcomePromise;
      expect(outcome).toEqual({
        value: 'fallback:PROVIDER_TIMEOUT',
        usedFallback: true,
        fallbackReason: 'PROVIDER_TIMEOUT',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('ProviderTimeoutError carries the configured timeoutMs', () => {
    const err = new ProviderTimeoutError(250);
    expect(err.timeoutMs).toBe(250);
    expect(err.name).toBe('ProviderTimeoutError');
  });

  it('does not swallow an error thrown by the fallback itself', async () => {
    await expect(
      runWithTimeoutFallback(() => Promise.reject(new Error('primary failed')), {
        timeoutMs: 1000,
        fallback: () => {
          throw new Error('fallback also failed');
        },
      })
    ).rejects.toThrow('fallback also failed');
  });
});
