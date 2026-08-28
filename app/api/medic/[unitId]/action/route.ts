/**
 * POST /api/medic/:unitId/action — RBAC's SUBMIT_FIELD_ACTION action
 * (MEDIC only), additionally row-scoped to the medic's own crewed unit
 * (viewer.unitId must equal :unitId — the WRITE-side twin of
 * canViewIncidentRow()'s READ-side check, per submitFieldAction()'s own
 * header note). Body: { incidentId, actionType, idempotencyKey, payload? }.
 */

/** Always dynamic — every route here reads cookies/DB state that must never be statically cached. */
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { submitFieldActionForUnit } from '@/server/repo';
import { errorToResponse, requireViewer, requireAction } from '@/server/route-helpers';
import { FIELD_ACTION_TYPES } from '@/lib/domain/types';

export async function POST(request: Request, { params }: { params: { unitId: string } }) {
  try {
    const viewer = requireViewer();
    requireAction(viewer, 'SUBMIT_FIELD_ACTION');
    if (viewer.unitId !== params.unitId) {
      return NextResponse.json(
        { error: 'ForbiddenActionError', message: 'A medic may only submit actions for their own crewed unit' },
        { status: 403 }
      );
    }

    const body = await request.json();
    if (!body.incidentId || !FIELD_ACTION_TYPES.includes(body.actionType) || !body.idempotencyKey) {
      return NextResponse.json(
        { error: 'MissingFields', message: `incidentId, idempotencyKey, and a valid actionType (${FIELD_ACTION_TYPES.join(', ')}) are required` },
        { status: 400 }
      );
    }
    const result = await submitFieldActionForUnit({
      incidentId: body.incidentId,
      unitId: params.unitId,
      actorId: viewer.userId,
      actionType: body.actionType,
      idempotencyKey: body.idempotencyKey,
      payload: body.payload,
    });
    return NextResponse.json(result);
  } catch (err) {
    return errorToResponse(err);
  }
}
