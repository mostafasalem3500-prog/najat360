/**
 * POST /api/operations/incidents/:id/recommendation — generates and
 * persists a fresh coverage-aware recommendation (C6's Dispatch Score +
 * coverage before/after) for a READY_FOR_DECISION incident. Restricted to
 * SUPERVISOR: lib/auth/rbac.ts's Action table has no standalone
 * "generate recommendation" entry, but this is squarely part of the
 * dispatch-decision workflow whose only other step (DECIDE_DISPATCH) is
 * SUPERVISOR-only — a CALL_TAKER reviewing/confirming location has no
 * reason to also be the one pulling the recommendation trigger.
 */

/** Always dynamic — every route here reads cookies/DB state that must never be statically cached. */
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { generateRecommendationForIncident } from '@/server/repo';
import { errorToResponse, requireViewer } from '@/server/route-helpers';

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
    const viewer = requireViewer();
    if (viewer.role !== 'SUPERVISOR') {
      return NextResponse.json({ error: 'ForbiddenActionError', message: 'Only SUPERVISOR generates a dispatch recommendation' }, { status: 403 });
    }
    const result = await generateRecommendationForIncident(params.id);
    return NextResponse.json(result);
  } catch (err) {
    return errorToResponse(err);
  }
}
