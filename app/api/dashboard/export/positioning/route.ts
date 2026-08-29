/**
 * GET /api/dashboard/export/positioning — downloads the current
 * positioning-hotspots list (app/dashboard/page.tsx's "توصيات التمركز
 * الاستباقي" section) as CSV. SUPERVISOR-only, same reasoning as
 * /api/dashboard/metrics. See exportPositioningReportCsv() in repo.ts for
 * the CSV shape and the AuditLog entry this records per spec 30.9.
 */

/** Always dynamic — reads live DB state, never statically cached. */
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { exportPositioningReportCsv } from '@/server/repo';
import { errorToResponse, requireViewer } from '@/server/route-helpers';

export async function GET() {
  try {
    const viewer = requireViewer();
    if (viewer.role !== 'SUPERVISOR') {
      return NextResponse.json(
        { error: 'ForbiddenActionError', message: 'Only the supervisor role exports dashboard reports' },
        { status: 403 }
      );
    }
    const csv = await exportPositioningReportCsv(viewer.userId);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="najat360-positioning-hotspots-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (err) {
    return errorToResponse(err);
  }
}
