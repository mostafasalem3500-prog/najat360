/**
 * GET /api/dashboard/export/location-accuracy — downloads a raw per-
 * resolution location-accuracy report (up to 1000 most recent
 * LocationResolution rows) as CSV. SUPERVISOR-only, same reasoning as
 * /api/dashboard/metrics. See exportLocationAccuracyReportCsv() in
 * repo.ts for the CSV shape and the AuditLog entry this records per spec
 * 30.9.
 */

/** Always dynamic — reads live DB state, never statically cached. */
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { exportLocationAccuracyReportCsv } from '@/server/repo';
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
    const csv = await exportLocationAccuracyReportCsv(viewer.userId);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="najat360-location-accuracy-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (err) {
    return errorToResponse(err);
  }
}
