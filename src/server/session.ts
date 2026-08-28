/**
 * Demo Role Switcher session — docs/product/NAJAT360-قرارات-ما-بعد-C0.md
 * correction #3, gated by `src/lib/demo-mode.ts`. This is NOT an
 * authentication system: it is a plain, unsigned cookie that lets one
 * operator manually switch which seeded demo user they are acting as while
 * walking the golden path solo (caller -> call-taker -> supervisor ->
 * medic) in front of an audience. Every route that reads it MUST first call
 * `assertDemoModeEnabled()` — there is no code path where this cookie
 * grants access in a non-demo deployment, by construction (see that
 * module's header for why the gate lives there, not here).
 *
 * A MEDIC viewer additionally carries `unitId` — which seeded
 * `AmbulanceUnit` the operator is currently "crewing" as, since this demo
 * seeds one MEDIC user shared across all units rather than one login per
 * unit (see scripts/seed-demo.ts's `buildUsers()`).
 */
import { cookies } from 'next/headers';
import { assertDemoModeEnabled } from '@/lib/demo-mode';
import type { Role } from '@/lib/domain/types';
import type { Viewer } from '@/lib/auth/rbac';

const COOKIE_NAME = 'najat360_demo_session';

export interface DemoSession {
  role: Role;
  userId: string;
  unitId?: string | null;
}

/** `user-<role_lowercased_with_underscores>` — matches scripts/seed-demo.ts's `buildUsers()` id scheme exactly. */
export function demoUserIdForRole(role: Role): string {
  return `user-${role.toLowerCase()}`;
}

export function readDemoSession(): DemoSession | null {
  assertDemoModeEnabled();
  const raw = cookies().get(COOKIE_NAME)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DemoSession;
    if (!parsed.role || !parsed.userId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function demoSessionToViewer(session: DemoSession): Viewer {
  return { role: session.role, userId: session.userId, unitId: session.unitId ?? null };
}

/** Cookie value to hand to a `Set-Cookie`/`cookies().set()` call — kept as a tiny helper so every write site serializes the same shape. */
export function serializeDemoSession(session: DemoSession): { name: string; value: string } {
  assertDemoModeEnabled();
  return { name: COOKIE_NAME, value: JSON.stringify(session) };
}

export const DEMO_SESSION_COOKIE_NAME = COOKIE_NAME;
