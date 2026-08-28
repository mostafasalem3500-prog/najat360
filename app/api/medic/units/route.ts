/** GET /api/medic/units — every AmbulanceUnit, for the Demo Role Switcher's "which unit am I crewing as MEDIC" picker. No RBAC gate: choosing which unit to demo-switch into happens BEFORE a session exists. */

/** Always dynamic — every route here reads cookies/DB state that must never be statically cached. */
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { listUnitsForDemoPicker } from '@/server/repo';
import { errorToResponse } from '@/server/route-helpers';

export async function GET() {
  try {
    const units = await listUnitsForDemoPicker();
    return NextResponse.json({ units });
  } catch (err) {
    return errorToResponse(err);
  }
}
