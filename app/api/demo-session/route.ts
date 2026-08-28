/**
 * Demo Role Switcher session endpoint — the ONLY place a client sets/reads
 * which seeded demo user it is acting as (src/server/session.ts). Both
 * verbs call assertDemoModeEnabled() (indirectly, via readDemoSession()/
 * serializeDemoSession()) before doing anything, so this route 403s outright
 * on any deployment where DEMO_MODE isn't "true" — there is no code path
 * here that works around that gate.
 */

/** Always dynamic — every route here reads cookies/DB state that must never be statically cached. */
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ROLES, type Role } from '@/lib/domain/types';
import { demoUserIdForRole, readDemoSession, serializeDemoSession } from '@/server/session';
import { errorToResponse } from '@/server/route-helpers';

export async function GET() {
  try {
    const session = readDemoSession();
    return NextResponse.json({ session });
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const role = body.role as Role;
    if (!ROLES.includes(role)) {
      return NextResponse.json({ error: 'InvalidRole', message: `role must be one of ${ROLES.join(', ')}` }, { status: 400 });
    }
    const unitId = role === 'MEDIC' ? (body.unitId as string | undefined) ?? null : null;
    const session = { role, userId: demoUserIdForRole(role), unitId };
    const cookie = serializeDemoSession(session);
    cookies().set(cookie.name, cookie.value, { httpOnly: true, sameSite: 'lax', path: '/' });
    return NextResponse.json({ session });
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function DELETE() {
  try {
    // Clearing the switcher still requires DEMO_MODE — asserted the same
    // way as the other two verbs (readDemoSession() calls it internally).
    readDemoSession();
    cookies().delete('najat360_demo_session');
    return NextResponse.json({ session: null });
  } catch (err) {
    return errorToResponse(err);
  }
}
