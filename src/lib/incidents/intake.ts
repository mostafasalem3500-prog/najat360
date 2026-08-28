/**
 * submitCallerReport() — the gatekeeper for spec's own caller-journey entry
 * point (section 21's E2E golden path: "افتح رابط المبلّغ ... أرسل
 * البلاغ") and for `lib/auth/rbac.ts`'s already-declared
 * `SUBMIT_CALLER_REPORT` action, which had no implementation behind it
 * until this file. Same pure-function, no-I/O pattern as every other
 * gatekeeper in this codebase (`acceptSuggestion`, `decideDispatch`,
 * `submitFieldAction`): takes plain inputs, returns exactly what the
 * caller's repository layer must persist, and never touches a database, a
 * clock, or a random source through anything but its own explicit
 * parameters/return value.
 *
 * Two things this function is structurally incapable of doing, matching
 * this project's "safety is a shape of the code" discipline
 * (anchor-resolution.ts's header uses the same phrase):
 *   1. It cannot mint a caller session without also producing a fresh
 *      rescue code and a fresh one-time token — there is no code path that
 *      returns one without the other.
 *   2. The raw token is generated here and returned exactly once; nothing
 *      in this module (or anywhere else in this codebase) persists it raw —
 *      only `callerTokenHash` is meant to reach a database row (spec
 *      section 13: "hash لتوكن المبلّغ").
 */
import { randomBytes, createHash } from 'node:crypto';
import { generateRescueCode, type GenerateRescueCodeOptions } from '@/lib/rescue-code';

/**
 * A caller's one-time report link should not stay valid indefinitely — spec
 * section 13 implies a bounded caller session, not a permanent link. Two
 * hours is this project's own choice (long enough to cover a single
 * incident's full lifecycle in the demo, short enough that a leaked/shared
 * link does not stay useful for days); no spec line pins an exact number.
 */
export const CALLER_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

export class MissingLanguageError extends Error {
  constructor() {
    super('submitCallerReport: language is required');
    this.name = 'MissingLanguageError';
  }
}

export interface SubmitCallerReportInput {
  /** Free text (e.g. "ar", "en") — matches `Incident.language`'s plain `String` column; no fixed enum this phase (mirrors `preferredCommunicationMode`'s same design choice, see domain/types.ts). */
  language: string;
  unableToSpeak: boolean;
  description?: string;
  callerName?: string;
  callerPhone?: string;
  /** Passed through explicitly rather than read from `Date.now()` — same determinism discipline as `resolveLocation()`/`submitFieldAction()`. */
  now: Date;
  /** Forwarded to `generateRescueCode()` — a route handler wires `isTaken` to a live DB uniqueness check. */
  rescueCodeOptions?: GenerateRescueCodeOptions;
}

export interface SubmitCallerReportResult {
  incidentId: string;
  rescueCode: string;
  /** Returned exactly once — embed it in the caller's link/local storage immediately; it is not recoverable afterward (only its hash is meant to be persisted). */
  callerToken: string;
  callerTokenHash: string;
  callerTokenExpiresAt: Date;
  language: string;
  unableToSpeak: boolean;
  description?: string;
  callerName?: string;
  callerPhone?: string;
  /** Every new incident this function produces starts here — the only status `state-machine.ts`'s adjacency map allows an incident to originate in. */
  status: 'NEW';
}

/** Exported so a route handler can look a presented raw token back up by its hash without duplicating the hashing scheme. */
export function hashCallerToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

export function submitCallerReport(input: SubmitCallerReportInput): SubmitCallerReportResult {
  if (!input.language?.trim()) {
    throw new MissingLanguageError();
  }

  const { id, rescueCode } = generateRescueCode(input.rescueCodeOptions);
  const callerToken = randomBytes(24).toString('hex');

  return {
    incidentId: id,
    rescueCode,
    callerToken,
    callerTokenHash: hashCallerToken(callerToken),
    callerTokenExpiresAt: new Date(input.now.getTime() + CALLER_TOKEN_TTL_MS),
    language: input.language,
    unableToSpeak: input.unableToSpeak,
    description: input.description,
    callerName: input.callerName,
    callerPhone: input.callerPhone,
    status: 'NEW',
  };
}
