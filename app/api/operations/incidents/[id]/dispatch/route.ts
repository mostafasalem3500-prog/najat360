/**
 * POST /api/operations/incidents/:id/dispatch — RBAC's DECIDE_DISPATCH
 * action (SUPERVISOR only). Body: { recommendationId, chosenUnitId,
 * chosenEntranceId, overrideReason? } — chosenUnitId/chosenEntranceId let
 * the supervisor accept the top pick as-is (pass the recommendation's own
 * recommendedUnitId/recommendedEntranceId) or choose the alternative/any
 * other AVAILABLE unit, matching this file's underlying decideDispatch()
 * gatekeeper (src/lib/dispatch/decision.ts), which requires overrideReason
 * only when the choice differs from the recommendation.
 */

/** Always dynamic — every route here reads cookies/DB state that must never be statically cached. */
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { decideDispatchForIncident } from '@/server/repo';
import { errorToResponse, requireViewer, requireAction } from '@/server/route-helpers';

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const viewer = requireViewer();
    requireAction(viewer, 'DECIDE_DISPATCH');

    const body = await request.json();
    if (!body.recommendationId || !body.chosenUnitId || !body.chosenEntranceId) {
      return NextResponse.json(
        { error: 'MissingFields', message: 'recommendationId, chosenUnitId, and chosenEntranceId are all required' },
        { status: 400 }
      );
    }
    const decision = await decideDispatchForIncident({
      incidentId: params.id,
      recommendationId: body.recommendationId,
      chosenUnitId: body.chosenUnitId,
      chosenEntranceId: body.chosenEntranceId,
      decidedById: viewer.userId,
      overrideReason: body.overrideReason || undefined,
    });
    return NextResponse.json({ decision });
  } catch (err) {
    return errorToResponse(err);
  }
}
