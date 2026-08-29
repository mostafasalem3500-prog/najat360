/**
 * POST /api/dashboard/positioning/optimize — an on-demand "suggest one
 * repositioning move" action. SUPERVISOR-only, same reasoning as
 * /api/dashboard/metrics. Deliberately POST, not GET: it runs real
 * routing-matrix simulations (getRepositioningPlan() in repo.ts), so it's
 * a button click, not something polled or prefetched.
 *
 * Returns { plan: null } (200, not an error) when there isn't yet enough
 * live data to evaluate (no AVAILABLE units with a known location, or no
 * coverage grid cells) — the UI shows a plain "nothing to evaluate" state
 * for that, same as any other empty-state, not a failure.
 */

/** Always dynamic — reads/computes live DB state, never statically cached. */
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getRepositioningPlan } from '@/server/repo';
import { errorToResponse, requireViewer } from '@/server/route-helpers';

export async function POST() {
  try {
    const viewer = requireViewer();
    if (viewer.role !== 'SUPERVISOR') {
      return NextResponse.json(
        { error: 'ForbiddenActionError', message: 'Only the supervisor role requests a repositioning suggestion' },
        { status: 403 }
      );
    }
    const plan = await getRepositioningPlan();
    return NextResponse.json({ plan });
  } catch (err) {
    return errorToResponse(err);
  }
}
