/**
 * POST /api/demo/reset — the "start the walkthrough over" button. Gated by
 * assertDemoModeEnabled() FIRST, before touching the database at all, same
 * discipline as every other demo-only affordance (src/lib/demo-mode.ts).
 *
 * Runs entirely IN-PROCESS inside a single transaction: BEGIN, then (1)
 * truncateLiveIncidentData() wipes every Incident and its cascaded rows
 * plus resets every AmbulanceUnit to AVAILABLE (see repo.ts's doc comment
 * on why this is a repo-layer decision), (2) seedDemoData() — the SAME
 * fixture-build + INSERT sequence `npm run seed` / scripts/seed-demo.ts
 * uses — re-inserts the full known-good historical + golden-path fixture
 * set against the now-empty Incident table (units/entrances/anchors
 * already exist and upsert in place; not truncated, since Rescue Anchors
 * are meant to be physically re-printable/stable across a demo day, not
 * regenerated). COMMIT on success, ROLLBACK on any failure — so a reseed
 * error can never leave the demo data wiped, which is what happened
 * before: this route used to shell out to `npx tsx scripts/seed-demo.ts`
 * as a child process, but Vercel's serverless runtime has no
 * writable/installable filesystem for `npx` to work with there, so every
 * reset 500'd immediately after the truncate had already committed.
 *
 * `?fast=1` overrides the historical-incident count down to 50 so an
 * operator resetting BETWEEN dry-runs during hackathon prep isn't stuck
 * waiting on a 2000-row historical seed every time; the default (no query
 * param) reseeds with whatever count is configured (.env's
 * SEED_HISTORICAL_COUNT, or the script's own default).
 */

/** Always dynamic — every route here reads cookies/DB state that must never be statically cached. */
export const dynamic = 'force-dynamic';
/** A full reseed (2000 historical incidents plus every C1-C6 fixture) can take longer than Vercel's default serverless timeout. */
export const maxDuration = 60;
import { NextResponse } from 'next/server';
import { assertDemoModeEnabled } from '@/lib/demo-mode';
import { getPool } from '@/server/db';
import { truncateLiveIncidentData } from '@/server/repo';
import { errorToResponse } from '@/server/route-helpers';
import { seedDemoData } from '../../../../scripts/seed-demo';

export async function POST(request: Request) {
  try {
    assertDemoModeEnabled();
  } catch (err) {
    return errorToResponse(err);
  }

  const { searchParams } = new URL(request.url);
  const fast = searchParams.get('fast') === '1';

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await truncateLiveIncidentData(client);
    await seedDemoData(client, { historicalCount: fast ? 50 : undefined });
    await client.query('COMMIT');

    return NextResponse.json({ reset: true, fast });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return errorToResponse(err);
  } finally {
    client.release();
  }
}
