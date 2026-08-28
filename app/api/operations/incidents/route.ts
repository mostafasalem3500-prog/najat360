/**
 * GET /api/operations/incidents — the call-taker/supervisor worklist. Every
 * incident currently in a non-terminal operational status (see repo.ts's
 * OPERATIONAL_STATUSES), field-projected per lib/auth/rbac.ts's
 * INCIDENT_FIELDS_BY_ROLE so a CALL_TAKER-shaped viewer never receives a
 * field their role isn't allowed to see, even though this same list feeds
 * both the call-taker and supervisor screens.
 */

/** Always dynamic — every route here reads cookies/DB state that must never be statically cached. */
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { listOperationalIncidents } from '@/server/repo';
import { errorToResponse, requireViewer } from '@/server/route-helpers';
import { serializeIncidentForRole } from '@/lib/auth/rbac';
import type { Incident } from '@/lib/domain/types';

export async function GET() {
  try {
    const viewer = requireViewer();
    if (viewer.role !== 'CALL_TAKER' && viewer.role !== 'SUPERVISOR') {
      return NextResponse.json({ error: 'ForbiddenActionError', message: 'Only CALL_TAKER/SUPERVISOR view the operations worklist' }, { status: 403 });
    }
    const rows = await listOperationalIncidents();
    const incidents = rows.map((row) => serializeIncidentForRole(row as unknown as Incident, viewer));
    return NextResponse.json({ incidents });
  } catch (err) {
    return errorToResponse(err);
  }
}
