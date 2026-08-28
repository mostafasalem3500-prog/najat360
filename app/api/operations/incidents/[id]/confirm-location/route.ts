/** POST /api/operations/incidents/:id/confirm-location — RBAC's CONFIRM_LOCATION action (CALL_TAKER/SUPERVISOR): VERIFYING -> READY_FOR_DECISION. */

/** Always dynamic — every route here reads cookies/DB state that must never be statically cached. */
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { confirmIncidentLocation } from '@/server/repo';
import { errorToResponse, requireViewer, requireAction } from '@/server/route-helpers';

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
    const viewer = requireViewer();
    requireAction(viewer, 'CONFIRM_LOCATION');
    const result = await confirmIncidentLocation(params.id, viewer.userId);
    return NextResponse.json({ transition: result });
  } catch (err) {
    return errorToResponse(err);
  }
}
