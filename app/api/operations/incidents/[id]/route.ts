/**
 * GET /api/operations/incidents/:id — full detail view (incident +
 * observations + resolutions + recommendations + field actions) for the
 * call-taker/supervisor screen. RBAC field projection applied to the
 * incident row only — observations/resolutions/recommendations/field
 * actions are operational audit data every CALL_TAKER/SUPERVISOR viewer
 * may see in full, unlike the Incident row's caller-contact fields.
 */

/** Always dynamic — every route here reads cookies/DB state that must never be statically cached. */
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getIncidentDetail } from '@/server/repo';
import { errorToResponse, requireViewer } from '@/server/route-helpers';
import { serializeIncidentForRole } from '@/lib/auth/rbac';
import type { Incident } from '@/lib/domain/types';

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const viewer = requireViewer();
    if (viewer.role !== 'CALL_TAKER' && viewer.role !== 'SUPERVISOR') {
      return NextResponse.json({ error: 'ForbiddenActionError', message: 'Only CALL_TAKER/SUPERVISOR view incident detail here' }, { status: 403 });
    }
    const detail = await getIncidentDetail(params.id);
    if (!detail) {
      return NextResponse.json({ error: 'NotFound', message: `No incident "${params.id}"` }, { status: 404 });
    }
    const incident = serializeIncidentForRole(detail.incident as unknown as Incident, viewer);
    return NextResponse.json({ ...detail, incident });
  } catch (err) {
    return errorToResponse(err);
  }
}
