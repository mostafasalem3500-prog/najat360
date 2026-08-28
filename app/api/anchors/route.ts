/**
 * GET /api/anchors — every active Rescue Anchor (spec 29.1), for the
 * printable /anchors page. Public/no-RBAC: a Rescue Anchor's whole purpose
 * is to be printed and stuck on a physical door, so its code is meant to be
 * seen by anyone standing at that entrance — the security property this
 * project actually cares about (see lib/location/anchor-resolution.ts's
 * header) is that a client can never SUPPLY coordinates for one, not that
 * the code/entrance name are secret.
 */

/** Always dynamic — every route here reads cookies/DB state that must never be statically cached. */
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { listActiveAnchors } from '@/server/repo';
import { errorToResponse } from '@/server/route-helpers';

export async function GET() {
  try {
    const anchors = await listActiveAnchors();
    return NextResponse.json({ anchors });
  } catch (err) {
    return errorToResponse(err);
  }
}
