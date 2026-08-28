/**
 * POST /api/caller/report — the P0 golden path's entry point (spec 21's
 * E2E: "افتح رابط المبلّغ ... أرسل البلاغ"). No RBAC/session check here on
 * purpose: a caller has no account (lib/auth/rbac.ts's own CALLER row notes
 * "Submits via a one-time token" — the token IS the access control, minted
 * by this very call, not checked before it).
 *
 * Body: { language, unableToSpeak, description?, callerName?, callerPhone?,
 *         location: { type:'ANCHOR', anchorCode } | { type:'GPS', latitude, longitude, horizontalAccuracyMeters? } }
 *
 * Response carries `callerToken` in the clear exactly once — the caller UI
 * must store it (e.g. in the page URL/localStorage) immediately, since
 * src/lib/incidents/intake.ts's header guarantees nothing in this codebase
 * can recover it later, only its hash.
 */

/** Always dynamic — every route here reads cookies/DB state that must never be statically cached. */
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createIncidentFromCallerReport, type CallerLocationInput } from '@/server/repo';
import { errorToResponse } from '@/server/route-helpers';

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (!body.location || (body.location.type !== 'ANCHOR' && body.location.type !== 'GPS')) {
      return NextResponse.json(
        { error: 'InvalidLocation', message: 'location must be { type: "ANCHOR", anchorCode } or { type: "GPS", latitude, longitude }' },
        { status: 400 }
      );
    }
    const location: CallerLocationInput =
      body.location.type === 'ANCHOR'
        ? { type: 'ANCHOR', anchorCode: String(body.location.anchorCode) }
        : {
            type: 'GPS',
            latitude: Number(body.location.latitude),
            longitude: Number(body.location.longitude),
            horizontalAccuracyMeters: body.location.horizontalAccuracyMeters != null ? Number(body.location.horizontalAccuracyMeters) : undefined,
          };

    const result = await createIncidentFromCallerReport({
      language: body.language,
      unableToSpeak: Boolean(body.unableToSpeak),
      description: body.description || undefined,
      callerName: body.callerName || undefined,
      callerPhone: body.callerPhone || undefined,
      location,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return errorToResponse(err);
  }
}
