/**
 * POST /api/demo/reset — the "start the walkthrough over" button. Gated by
 * assertDemoModeEnabled() FIRST, before touching the database at all, same
 * discipline as every other demo-only affordance (src/lib/demo-mode.ts).
 *
 * Two steps: (1) truncateLiveIncidentData() wipes every Incident and its
 * cascaded rows plus resets every AmbulanceUnit to AVAILABLE (see repo.ts's
 * doc comment on why this is a repo-layer decision), (2) re-run
 * scripts/seed-demo.ts as a child process, which — against the now-empty
 * Incident table — cleanly re-inserts the full known-good historical +
 * golden-path fixture set (units/entrances/anchors already exist and
 * upsert in place; not truncated, since Rescue Anchors are meant to be
 * physically re-printable/stable across a demo day, not regenerated).
 *
 * `?fast=1` overrides SEED_HISTORICAL_COUNT down to 50 for the reseed
 * subprocess so an operator resetting BETWEEN dry-runs during hackathon
 * prep isn't stuck waiting on a 2000-row historical seed every time; the
 * default (no query param) reseeds with whatever count is configured
 * (.env's SEED_HISTORICAL_COUNT, or that script's own default), matching
 * exactly what `npm run seed` on its own would produce.
 */

/** Always dynamic — every route here reads cookies/DB state that must never be statically cached. */
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { assertDemoModeEnabled } from '@/lib/demo-mode';
import { truncateLiveIncidentData } from '@/server/repo';
import { errorToResponse } from '@/server/route-helpers';

const execFileAsync = promisify(execFile);

export async function POST(request: Request) {
  try {
    assertDemoModeEnabled();

    await truncateLiveIncidentData();

    const { searchParams } = new URL(request.url);
    const fast = searchParams.get('fast') === '1';
    const env = { ...process.env, ...(fast ? { SEED_HISTORICAL_COUNT: '50' } : {}) };

    await execFileAsync('npx', ['tsx', 'scripts/seed-demo.ts'], {
      cwd: process.cwd(),
      env,
      maxBuffer: 1024 * 1024 * 32,
      timeout: 120_000,
    });

    return NextResponse.json({ reset: true, fast });
  } catch (err) {
    return errorToResponse(err);
  }
}
