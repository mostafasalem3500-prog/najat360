/**
 * GET /api/caller/status?incidentId=...&token=... — the caller screen's
 * status-poll endpoint. The presented token (hashed and compared against
 * Incident.callerTokenHash by getCallerIncidentView()) is this route's
 * entire access control, matching lib/auth/rbac.ts's CALLER row design
 * note. Returns 404 for "wrong/expired token" and "no such incident" alike
 * — never distinguishing them — so a guess cannot be used to enumerate
 * incident ids or probe token validity.
 */

/** Always dynamic — every route here reads cookies/DB state that must never be statically cached. */
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getCallerIncidentView } from '@/server/repo';
import { errorToResponse } from '@/server/route-helpers';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const incidentId = searchParams.get('incidentId');
    const token = searchParams.get('token');
    if (!incidentId || !token) {
      return NextResponse.json({ error: 'MissingParams', message: 'incidentId and token are both required' }, { status: 400 });
    }
    const view = await getCallerIncidentView(incidentId, token);
    if (!view) {
      return NextResponse.json({ error: 'NotFound', message: 'No matching incident for this id/token' }, { status: 404 });
    }
    return NextResponse.json(view);
  } catch (err) {
    return errorToResponse(err);
  }
}
