/**
 * Small shared helpers for the Next.js Route Handlers under app/api/**.
 * Kept out of repo.ts (which must stay a pure data-access layer callable
 * from anywhere, not Next.js-specific) and out of each route file (which
 * would otherwise duplicate this error-mapping switch 15 times).
 */
import { NextResponse } from 'next/server';
import { DemoModeDisabledError } from '@/lib/demo-mode';
import { ForbiddenActionError, assertCanPerformAction, type Action, type Viewer } from '@/lib/auth/rbac';
import { readDemoSession, demoSessionToViewer } from '@/server/session';

export class NoDemoSessionError extends Error {
  constructor() {
    super('No active Demo Role Switcher session — pick a role first');
    this.name = 'NoDemoSessionError';
  }
}

/**
 * Every operational (non-CALLER, non-public) route in this demo identifies
 * "who is asking" via the Demo Role Switcher cookie, since there is no real
 * login in this phase (see src/server/session.ts's header). Throws
 * NoDemoSessionError (-> 401 below) rather than returning null, so a route
 * handler cannot forget to check and silently treat "nobody" as some
 * default role.
 */
export function requireViewer(): Viewer {
  const session = readDemoSession();
  if (!session) throw new NoDemoSessionError();
  return demoSessionToViewer(session);
}

/** Throwing counterpart of lib/auth/rbac.ts's assertCanPerformAction(), re-exported here so route handlers import one helper module instead of two. */
export function requireAction(viewer: Viewer, action: Action): void {
  assertCanPerformAction(viewer.role, action);
}

/** Every domain error in src/lib/** that a route handler might see, mapped to the HTTP status a REST client should treat it as. Anything not listed here is a genuine bug -> 500, not swallowed. */
const ERROR_STATUS_BY_NAME: Record<string, number> = {
  MissingLanguageError: 400,
  MissingDecidedByError: 400,
  MissingDispatchOverrideReasonError: 400,
  MissingActorError: 400,
  MissingIdempotencyKeyError: 400,
  MissingOverrideReasonError: 400,
  AnchorNotFoundError: 404,
  AnchorNotActiveError: 409,
  UnitNotAvailableError: 409,
  UnitAlreadyAssignedError: 409,
  IncidentNotAssignedToUnitError: 403,
  DuplicateOnceOnlyActionError: 409,
  InvalidTransitionError: 409,
  ConnectivityRecoveryMismatchError: 409,
  NoAvailableUnitsForRecommendationError: 409,
  RecommendationNotFoundError: 404,
  RescueCodeCollisionError: 500,
  ForbiddenActionError: 403,
  DemoModeDisabledError: 403,
  NoDemoSessionError: 401,
};

export function errorToResponse(err: unknown): NextResponse {
  if (err instanceof Error) {
    const status = ERROR_STATUS_BY_NAME[err.name] ?? 500;
    if (status === 500) {
      // eslint-disable-next-line no-console
      console.error('Unhandled route error:', err);
    }
    return NextResponse.json({ error: err.name, message: err.message }, { status });
  }
  // eslint-disable-next-line no-console
  console.error('Unhandled non-Error thrown in route:', err);
  return NextResponse.json({ error: 'InternalError', message: 'Unexpected error' }, { status: 500 });
}

export { DemoModeDisabledError, ForbiddenActionError };
