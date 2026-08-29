/**
 * GET /api/dashboard/metrics — the operational dashboard's single data
 * source (app/dashboard/page.tsx). SUPERVISOR-only, same reasoning as
 * /api/operations/units-map: response-time and fleet-wide numbers are an
 * operations-room concern, not something a CALL_TAKER or MEDIC screen
 * needs. Every figure is computed live from Incident/IncidentEvent/
 * AmbulanceUnit/H3Prediction — see getDashboardMetrics()'s own header for
 * why there is deliberately no separate metrics table to drift out of sync.
 */

/** Always dynamic — every route here reads cookies/DB state that must never be statically cached. */
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getDashboardMetrics } from '@/server/repo';
import { errorToResponse, requireViewer } from '@/server/route-helpers';

export async function GET() {
  try {
    const viewer = requireViewer();
    if (viewer.role !== 'SUPERVISOR') {
      return NextResponse.json(
        { error: 'ForbiddenActionError', message: 'Only the supervisor role views the operations dashboard' },
        { status: 403 }
      );
    }
    const metrics = await getDashboardMetrics();
    return NextResponse.json(metrics);
  } catch (err) {
    return errorToResponse(err);
  }
}
