import { describe, expect, it } from 'vitest';
import { CALLER_TOKEN_TTL_MS, MissingLanguageError, hashCallerToken, submitCallerReport } from '@/lib/incidents/intake';

const NOW = new Date('2026-08-28T10:00:00.000Z');

describe('submitCallerReport', () => {
  it('produces a NEW incident with a rescue code and a raw+hashed token', () => {
    const result = submitCallerReport({ language: 'ar', unableToSpeak: false, now: NOW });
    expect(result.status).toBe('NEW');
    expect(result.rescueCode).toMatch(/^NJT-/);
    expect(result.incidentId).toBeTruthy();
    expect(result.callerToken).toHaveLength(48); // 24 bytes hex-encoded
    expect(result.callerTokenHash).toBe(hashCallerToken(result.callerToken));
  });

  it('sets callerTokenExpiresAt exactly CALLER_TOKEN_TTL_MS after now', () => {
    const result = submitCallerReport({ language: 'ar', unableToSpeak: false, now: NOW });
    expect(result.callerTokenExpiresAt.getTime() - NOW.getTime()).toBe(CALLER_TOKEN_TTL_MS);
  });

  it('never persists the raw token anywhere but the one-time return value (hash is a one-way function of it)', () => {
    const a = submitCallerReport({ language: 'ar', unableToSpeak: false, now: NOW });
    const b = submitCallerReport({ language: 'ar', unableToSpeak: false, now: NOW });
    expect(a.callerToken).not.toBe(b.callerToken);
    expect(a.callerTokenHash).not.toBe(b.callerTokenHash);
  });

  it('throws MissingLanguageError when language is empty/whitespace', () => {
    expect(() => submitCallerReport({ language: '', unableToSpeak: false, now: NOW })).toThrow(MissingLanguageError);
    expect(() => submitCallerReport({ language: '   ', unableToSpeak: false, now: NOW })).toThrow(MissingLanguageError);
  });

  it('passes through optional caller-provided fields unchanged', () => {
    const result = submitCallerReport({
      language: 'en',
      unableToSpeak: true,
      description: 'Fall from stairs',
      callerName: 'Test Caller',
      callerPhone: 'SYN-CALLER-PHONE-000001',
      now: NOW,
    });
    expect(result.language).toBe('en');
    expect(result.unableToSpeak).toBe(true);
    expect(result.description).toBe('Fall from stairs');
    expect(result.callerName).toBe('Test Caller');
    expect(result.callerPhone).toBe('SYN-CALLER-PHONE-000001');
  });

  it('forwards rescueCodeOptions.isTaken so a route handler can enforce live DB uniqueness', () => {
    let calls = 0;
    const isTaken = (_code: string) => {
      calls += 1;
      return calls === 1; // first candidate "taken", second accepted
    };
    const result = submitCallerReport({ language: 'ar', unableToSpeak: false, now: NOW, rescueCodeOptions: { isTaken } });
    expect(calls).toBe(2);
    expect(result.rescueCode).toMatch(/^NJT-/);
  });

  it('hashCallerToken is deterministic for the same input', () => {
    expect(hashCallerToken('abc')).toBe(hashCallerToken('abc'));
    expect(hashCallerToken('abc')).not.toBe(hashCallerToken('abd'));
  });
});
