'use client';

/**
 * Demo Role Switcher — the UI half of src/server/session.ts. Lets a solo
 * operator walk the golden path (caller -> call-taker -> supervisor ->
 * medic) alone in front of an audience by switching which seeded demo user
 * they're acting as. This component itself renders unconditionally, but
 * every request it makes goes through /api/demo-session, which 403s the
 * instant DEMO_MODE isn't "true" — so on a non-demo deployment this widget
 * degrades to a harmless, permanently-erroring control, never a working
 * backdoor (see src/lib/demo-mode.ts's header for why the gate lives
 * server-side, not here).
 */
import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../_lib/api';

interface DemoSession {
  role: string;
  userId: string;
  unitId?: string | null;
}

interface UnitOption {
  id: string;
  code: string;
  label: string;
  status: string;
}

const ROLE_LABELS_AR: Record<string, string> = {
  CALL_TAKER: 'مستقبل البلاغ',
  SUPERVISOR: 'المشرف',
  MEDIC: 'المسعف',
};

export default function RoleSwitcher() {
  const [session, setSession] = useState<DemoSession | null | undefined>(undefined);
  const [units, setUnits] = useState<UnitOption[]>([]);
  const [showUnitPicker, setShowUnitPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ session: DemoSession | null }>('/api/demo-session')
      .then((r) => setSession(r.session))
      .catch(() => setSession(null));
    apiGet<{ units: UnitOption[] }>('/api/medic/units')
      .then((r) => setUnits(r.units))
      .catch(() => setUnits([]));
  }, []);

  async function chooseRole(role: string, unitId?: string) {
    setError(null);
    try {
      const r = await apiPost<{ session: DemoSession }>('/api/demo-session', { role, unitId });
      setSession(r.session);
      if (role !== 'MEDIC') setShowUnitPicker(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تبديل الدور');
    }
  }

  if (session === undefined) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="synthetic-badge">وضع تجريبي</span>
      <button
        onClick={() => chooseRole('CALL_TAKER')}
        className={`px-3 py-1 rounded-full border ${session?.role === 'CALL_TAKER' ? 'bg-cherry text-white border-cherry' : 'border-navy/30 text-navy'}`}
      >
        {ROLE_LABELS_AR.CALL_TAKER}
      </button>
      <button
        onClick={() => chooseRole('SUPERVISOR')}
        className={`px-3 py-1 rounded-full border ${session?.role === 'SUPERVISOR' ? 'bg-cherry text-white border-cherry' : 'border-navy/30 text-navy'}`}
      >
        {ROLE_LABELS_AR.SUPERVISOR}
      </button>
      <button
        onClick={() => setShowUnitPicker((v) => !v)}
        className={`px-3 py-1 rounded-full border ${session?.role === 'MEDIC' ? 'bg-cherry text-white border-cherry' : 'border-navy/30 text-navy'}`}
      >
        {ROLE_LABELS_AR.MEDIC}
        {session?.role === 'MEDIC' ? ` — ${units.find((u) => u.id === session.unitId)?.code ?? '...'}` : ''}
      </button>
      {showUnitPicker && (
        <select
          defaultValue=""
          onChange={(e) => {
            if (e.target.value) chooseRole('MEDIC', e.target.value);
          }}
          className="border rounded px-2 py-1"
        >
          <option value="" disabled>
            اختر الوحدة...
          </option>
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.code} — {u.label} ({u.status})
            </option>
          ))}
        </select>
      )}
      {error && <span className="text-cherry text-xs">{error}</span>}
    </div>
  );
}
