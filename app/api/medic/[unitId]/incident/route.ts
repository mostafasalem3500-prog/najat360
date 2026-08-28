/**
 * GET /api/medic/:unitId/incident — the FieldLink screen's own assigned
 * incident. Row-scoped via lib/auth/rbac.ts's canViewIncidentRow(): a
 * MEDIC-shaped viewer whose session unitId doesn't match the URL's :unitId
 * gets exactly the same 404 a stranger incident id would (spec 30.14 #5,
 * "FieldLink يمنع Medic من رؤية بلاغ آخر" — never a 403 that would confirm
 * some OTHER unit has an active incident).
 */

/** Always dynamic — every route here reads cookies/DB state that must never be statically cached. */
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getAssignedIncidentForUnit } from '@/server/repo';
import { errorToResponse, requireViewer } from '@/server/route-helpers';
import { serializeIncidentForRole, canViewIncidentRow } from '@/lib/auth/rbac';
import type { Incident } from '@/lib/domain/types';

export async function GET(_request: Request, { params }: { params: { unitId: string } }) {
  try {
    const viewer = requireViewer();
    if (viewer.role !== 'MEDIC') {
      return NextResponse.json({ error: 'ForbiddenActionError', message: 'Only MEDIC uses the FieldLink screen' }, { status: 403 });
    }
    const row = await getAssignedIncidentForUnit(params.unitId);
    if (!row || !canViewIncidentRow(viewer, row as unknown as Incident)) {
      return NextResponse.json({ incident: null });
    }
    const incident = serializeIncidentForRole(row as unknown as Incident, viewer);
    return NextResponse.json({ incident });
  } catch (err) {
    return errorToResponse(err);
  }
}
