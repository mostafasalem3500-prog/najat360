/** GET /api/entrances — id/code/name lookup for every active Entrance. Used by the operations screen to label a Recommendation's bare entrance ids. Public/no-RBAC for the same reason as /api/anchors: entrance names aren't sensitive, only anchor coordinate-authority is (see anchor-resolution.ts). */

/** Always dynamic — every route here reads cookies/DB state that must never be statically cached. */
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { listEntrancesBasic } from '@/server/repo';
import { errorToResponse } from '@/server/route-helpers';

export async function GET() {
  try {
    const entrances = await listEntrancesBasic();
    return NextResponse.json({ entrances });
  } catch (err) {
    return errorToResponse(err);
  }
}
