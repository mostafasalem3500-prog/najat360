'use client';

/**
 * Medic FieldLink screen — P0 golden path step 3. Shows the single incident
 * currently assigned to whichever unit the Demo Role Switcher has this
 * operator crewing as, and lets them submit the next valid action. Every
 * submission carries a fresh idempotencyKey (spec 30.14 #6) — a duplicate
 * click reuses the SAME key within one optimistic-lock window so a flaky
 * double-tap is a safe no-op server-side, not a second action.
 */
import { useEffect, useState, useCallback } from 'react';
import { apiGet, apiPost, ApiError } from '../_lib/api';
import { onRoleChanged } from '../_lib/role-events';

interface IncidentView {
  id: string;
  rescueCode: string;
  status: string;
  latitude?: number;
  longitude?: number;
  placeType?: string;
  floorLevel?: string;
  assignedEntranceId?: string;
}

interface LookupRow {
  id: string;
  nameAr?: string;
}

const ACTIONS_BY_STATUS: Record<string, { type: string; label: string }[]> = {
  DISPATCHED: [
    { type: 'ACCEPT_TASK', label: 'قبول المهمة' },
    { type: 'START_MOVING', label: 'بدء التحرك' },
  ],
  EN_ROUTE: [
    { type: 'AT_ACCESS_POINT', label: 'وصلت عند المدخل' },
    { type: 'ACCESS_BLOCKED', label: 'تعذر الوصول' },
  ],
  ACCESS_BLOCKED: [{ type: 'START_MOVING', label: 'استئناف التحرك' }],
  AT_ACCESS_POINT: [{ type: 'ON_SCENE', label: 'وصلت إلى المصاب' }],
  ON_SCENE: [{ type: 'CLOSE_TASK', label: 'إغلاق البلاغ' }],
};

const STATUS_LABELS_AR: Record<string, string> = {
  DISPATCHED: 'تم إسنادك لهذا البلاغ',
  EN_ROUTE: 'أنت في الطريق',
  ACCESS_BLOCKED: 'تعذر الوصول — بانتظار حل',
  AT_ACCESS_POINT: 'عند المدخل',
  ON_SCENE: 'في الموقع',
  CLOSED: 'تم الإغلاق',
};

export default function MedicPage() {
  const [session, setSession] = useState<{ role: string; unitId?: string | null } | null | undefined>(undefined);
  const [incident, setIncident] = useState<IncidentView | null>(null);
  const [entrances, setEntrances] = useState<LookupRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (unitId: string) => {
    try {
      const r = await apiGet<{ incident: IncidentView | null }>(`/api/medic/${unitId}/incident`);
      setIncident(r.incident);
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
    }
  }, []);

  useEffect(() => {
    apiGet<{ session: { role: string; unitId?: string | null } | null }>('/api/demo-session').then((r) => setSession(r.session));
    apiGet<{ entrances: LookupRow[] }>('/api/entrances').then((r) => setEntrances(r.entrances));
  }, []);

  // Picks up a role switch made from the header's Demo Role Switcher
  // without needing a manual page reload — see role-events.ts's header.
  useEffect(() => onRoleChanged((s) => setSession(s)), []);

  useEffect(() => {
    if (session?.role === 'MEDIC' && session.unitId) {
      load(session.unitId);
      const interval = setInterval(() => load(session.unitId!), 6000);
      return () => clearInterval(interval);
    }
  }, [session, load]);

  async function submitAction(actionType: string) {
    if (!session?.unitId || !incident) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/medic/${session.unitId}/action`, {
        incidentId: incident.id,
        actionType,
        idempotencyKey: `${incident.id}-${actionType}-${crypto.randomUUID()}`,
      });
      await load(session.unitId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر إرسال الإجراء');
    } finally {
      setBusy(false);
    }
  }

  if (session === undefined) return null;
  if (session?.role !== 'MEDIC' || !session.unitId) {
    return (
      <div className="card p-6 text-center">
        <p className="text-navy">اختر دور «المسعف» ووحدتك من أعلى الصفحة لدخول شاشة الميدان (FieldLink).</p>
      </div>
    );
  }

  const entranceName = (id?: string) => (id ? entrances.find((e) => e.id === id)?.nameAr ?? id.slice(0, 8) : '—');

  return (
    <div className="max-w-lg mx-auto space-y-4">
      <span className="synthetic-badge">بيانات اصطناعية — عرض تجريبي</span>
      <h1 className="text-xl font-bold text-navy">FieldLink</h1>
      {error && <p className="text-cherry text-sm">{error}</p>}

      {!incident && <p className="card p-6 text-center text-navy/60">لا يوجد بلاغ مُسند لوحدتك حاليًا.</p>}

      {incident && (
        <div className="card p-5 space-y-3">
          <div className="flex justify-between items-center">
            <h2 className="font-bold text-navy text-lg">{incident.rescueCode}</h2>
            <span className="text-sm text-navy/60">{STATUS_LABELS_AR[incident.status] ?? incident.status}</span>
          </div>
          <p className="text-sm text-navy/70">المدخل المُسند: {entranceName(incident.assignedEntranceId)}</p>
          {incident.floorLevel && <p className="text-sm text-navy/70">الطابق: {incident.floorLevel}</p>}
          {incident.latitude != null && (
            <p className="text-sm text-navy/50">
              {incident.latitude.toFixed(5)}, {incident.longitude?.toFixed(5)}
            </p>
          )}

          <div className="grid gap-2 pt-2">
            {(ACTIONS_BY_STATUS[incident.status] ?? []).map((a) => (
              <button
                key={a.type}
                disabled={busy}
                onClick={() => submitAction(a.type)}
                className="px-4 py-3 rounded bg-cherry text-white font-bold disabled:opacity-50"
              >
                {a.label}
              </button>
            ))}
            {(ACTIONS_BY_STATUS[incident.status] ?? []).length === 0 && (
              <p className="text-sm text-navy/50 text-center">لا إجراء متاح في هذه الحالة.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
