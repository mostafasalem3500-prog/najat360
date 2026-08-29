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
import { broadcastRoleChanged } from '../_lib/role-events';
import { Headset, ShieldCheck, Ambulance, FlaskConical } from 'lucide-react';

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
      broadcastRoleChanged(r.session);
      if (role !== 'MEDIC') setShowUnitPicker(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تبديل الدور');
    }
  }

  if (session === undefined) return null;

  const roleBtn = (active: boolean) =>
    `flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold transition-all ${
      active
        ? 'bg-gradient-to-l from-navy to-navy-dark text-white shadow-sm shadow-navy/30'
        : 'border border-navy/20 text-navy/80 hover:border-navy/40 hover:bg-navy/5'
    }`;

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="synthetic-badge">
        <FlaskConical size={12} strokeWidth={2.5} />
        وضع تجريبي
      </span>
      <button onClick={() => chooseRole('CALL_TAKER')} className={roleBtn(session?.role === 'CALL_TAKER')}>
        <Headset size={14} strokeWidth={2.25} />
        {ROLE_LABELS_AR.CALL_TAKER}
      </button>
      <button onClick={() => chooseRole('SUPERVISOR')} className={roleBtn(session?.role === 'SUPERVISOR')}>
        <ShieldCheck size={14} strokeWidth={2.25} />
        {ROLE_LABELS_AR.SUPERVISOR}
      </button>
      <button onClick={() => setShowUnitPicker((v) => !v)} className={roleBtn(session?.role === 'MEDIC')}>
        <Ambulance size={14} strokeWidth={2.25} />
        {ROLE_LABELS_AR.MEDIC}
        {session?.role === 'MEDIC' ? ` — ${units.find((u) => u.id === session.unitId)?.code ?? '...'}` : ''}
      </button>
      {showUnitPicker && (
        <select
          defaultValue=""
          onChange={(e) => {
            if (e.target.value) chooseRole('MEDIC', e.target.value);
          }}
          className="border border-navy/20 rounded-full px-3 py-1.5 text-sm bg-white"
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
