/**
 * GET /api/operations/units-map — every AmbulanceUnit plus its most recent
 * UnitLocation (lat/lng), for the operations screen's live map (C7
 * prototype). Restricted to CALL_TAKER/SUPERVISOR — unit positions are
 * exactly the kind of live government-operational data lib/auth/rbac.ts's
 * Action table already treats as operations-room-only; a public/no-RBAC
 * endpoint like /api/entrances or /api/anchors would be wrong here.
 */

/** Always dynamic — every route here reads cookies/DB state that must never be statically cached. */
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { listUnitsWithLastLocation } from '@/server/repo';
import { errorToResponse, requireViewer } from '@/server/route-helpers';

export async function GET() {
  try {
    const viewer = requireViewer();
    if (viewer.role !== 'CALL_TAKER' && viewer.role !== 'SUPERVISOR') {
      return NextResponse.json({ error: 'ForbiddenActionError', message: 'Only the operations room views live unit positions' }, { status: 403 });
    }
    const units = await listUnitsWithLastLocation();
    return NextResponse.json({ units });
  } catch (err) {
    return errorToResponse(err);
  }
}
