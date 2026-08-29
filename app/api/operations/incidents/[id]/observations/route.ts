/**
 * POST /api/operations/incidents/:id/observations — a call-taker/supervisor
 * adding a location signal (typically CALL_TAKER-sourced: "caller says
 * they're near the north gate") to an incident already in progress. Gated
 * by the same RBAC action as location review generally (CONFIRM_LOCATION —
 * CALL_TAKER/SUPERVISOR) since there is no more specific action name for
 * "add an observation" in lib/auth/rbac.ts's table and this is squarely
 * part of that same review workflow.
 */

/** Always dynamic — every route here reads cookies/DB state that must never be statically cached. */
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { addObservationAndResolve } from '@/server/repo';
import { errorToResponse, requireViewer, requireAction } from '@/server/route-helpers';

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const viewer = requireViewer();
    requireAction(viewer, 'CONFIRM_LOCATION');

    const body = await request.json();
    if (!body.source || !['CALL_TAKER', 'MANUAL_PIN', 'BROWSER_GPS'].includes(body.source)) {
      return NextResponse.json({ error: 'InvalidSource', message: 'source must be CALL_TAKER, MANUAL_PIN, or BROWSER_GPS' }, { status: 400 });
    }
    const resolution = await addObservationAndResolve({
      incidentId: params.id,
      source: body.source,
      latitude: Number(body.latitude),
      longitude: Number(body.longitude),
      horizontalAccuracyMeters: body.horizontalAccuracyMeters != null ? Number(body.horizontalAccuracyMeters) : undefined,
      floorLevel: body.floorLevel || undefined,
      actorId: viewer.userId,
    });
    return NextResponse.json({ resolution });
  } catch (err) {
    return errorToResponse(err);
  }
}
