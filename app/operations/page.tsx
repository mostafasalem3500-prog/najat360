'use client';

/**
 * Call-taker / supervisor operations screen — P0 golden path step 2.
 * Combines the two roles into one screen (RBAC still enforced per-action on
 * the server, not here) since a solo demo operator switches between them
 * with the Demo Role Switcher rather than needing two separate URLs.
 *
 * CALL_TAKER: reviews observations/conflicts, adds a manual observation,
 * confirms location (VERIFYING -> READY_FOR_DECISION).
 * SUPERVISOR: generates the coverage-aware recommendation (C6) and decides
 * dispatch (accept the top pick or override with a reason).
 */
import { useEffect, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { apiGet, apiPost, ApiError } from '../_lib/api';
import type { MapPoint } from '../_components/IncidentMap';

/** Leaflet touches window/document, so it can only run client-side — see IncidentMap.tsx's header. */
const IncidentMap = dynamic(() => import('../_components/IncidentMap'), { ssr: false });

interface IncidentRow {
  id: string;
  rescueCode: string;
  status: string;
  latitude?: number;
  longitude?: number;
  uncertaintyRadiusMeters?: number;
  confidenceScore?: number;
  callerName?: string;
  callerPhone?: string;
  description?: string;
  floorLevel?: string;
  language?: string;
  unableToSpeak?: boolean;
  suggestedEntranceId?: string;
  assignedEntranceId?: string;
  assignedUnitId?: string;
}

interface ObservationRow {
  id: string;
  source: string;
  latitude: number;
  longitude: number;
  horizontalAccuracyMeters: number | null;
  capturedAt: string;
  provenanceLabel: string;
}

interface ResolutionRow {
  id: string;
  confidenceIndex: number;
  supportingObservationIds: string[];
  conflictingObservationIds: string[];
  createdAt: string;
}

interface RecommendationRow {
  id: string;
  algorithmVersion: string;
  recommendedUnitId: string;
  alternativeUnitId: string | null;
  recommendedEntranceId: string;
  alternativeEntranceId: string | null;
  accessScore: number;
  acceptedById: string | null;
  overrideReason: string | null;
}

interface FieldActionRow {
  id: string;
  actionType: string;
  resultingStatus: string | null;
  processedAt: string;
}

interface IncidentDetail {
  incident: IncidentRow;
  observations: ObservationRow[];
  resolutions: ResolutionRow[];
  recommendations: RecommendationRow[];
  fieldActions: FieldActionRow[];
}

interface CoverageMetrics {
  meanEtaSeconds: number;
  p90EtaSeconds: number;
  worstCell: { h3Index: string; etaSeconds: number };
  gapCellCount: number;
  totalCells: number;
}

interface GenerateResult {
  recommendationId: string;
  recommendedUnitId: string;
  alternativeUnitId: string | null;
  recommendedEntranceId: string;
  alternativeEntranceId: string | null;
  dispatchScore: number;
  reasoning: string[];
  coverageBefore: CoverageMetrics;
  coverageAfter: CoverageMetrics;
}

interface LookupRow {
  id: string;
  code: string;
  label?: string;
  nameAr?: string;
  latitude?: number;
  longitude?: number;
}

const STATUS_LABELS_AR: Record<string, string> = {
  VERIFYING: 'قيد تثبيت الموقع',
  LOW_CONFIDENCE: 'ثقة منخفضة — تحت المراجعة',
  READY_FOR_DECISION: 'جاهز لقرار الإرسال',
  NO_UNIT_AVAILABLE: 'لا وحدة متاحة',
  DISPATCHED: 'تم الإسناد',
  EN_ROUTE: 'في الطريق',
  ACCESS_BLOCKED: 'تعذر الوصول',
  AT_ACCESS_POINT: 'عند المدخل',
  ON_SCENE: 'في الموقع',
  CLOSED: 'مغلق',
};

function fmtEta(seconds: number) {
  return `${Math.round(seconds / 60)} د ${Math.round(seconds % 60)} ث`;
}

export default function OperationsPage() {
  const [role, setRole] = useState<string | null | undefined>(undefined);
  const [incidents, setIncidents] = useState<IncidentRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<IncidentDetail | null>(null);
  const [units, setUnits] = useState<LookupRow[]>([]);
  const [entrances, setEntrances] = useState<LookupRow[]>([]);
  const [generated, setGenerated] = useState<GenerateResult | null>(null);
  const [chosenUnitId, setChosenUnitId] = useState('');
  const [chosenEntranceId, setChosenEntranceId] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [obsLat, setObsLat] = useState('');
  const [obsLng, setObsLng] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unitLabel = (id?: string | null) => (id ? units.find((u) => u.id === id)?.code ?? id.slice(0, 8) : '—');
  const entranceLabel = (id?: string | null) => (id ? entrances.find((e) => e.id === id)?.nameAr ?? id.slice(0, 8) : '—');

  const loadIncidents = useCallback(async () => {
    try {
      const r = await apiGet<{ incidents: IncidentRow[] }>('/api/operations/incidents');
      setIncidents(r.incidents);
    } catch (e) {
      if (e instanceof ApiError && e.status !== 401 && e.status !== 403) setError(e.message);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const r = await apiGet<IncidentDetail>(`/api/operations/incidents/${id}`);
      setDetail(r);
      setGenerated(null);
      setChosenUnitId(r.incident.assignedUnitId ?? '');
      setChosenEntranceId(r.incident.assignedEntranceId ?? '');
      setOverrideReason('');
    } catch (e) {
      if (e instanceof Error) setError(e.message);
    }
  }, []);

  useEffect(() => {
    apiGet<{ session: { role: string } | null }>('/api/demo-session').then((r) => setRole(r.session?.role ?? null));
    apiGet<{ units: LookupRow[] }>('/api/operations/units-map').then((r) => setUnits(r.units));
    apiGet<{ entrances: LookupRow[] }>('/api/entrances').then((r) => setEntrances(r.entrances));
  }, []);

  useEffect(() => {
    if (role === 'CALL_TAKER' || role === 'SUPERVISOR') {
      loadIncidents();
      const interval = setInterval(loadIncidents, 8000);
      return () => clearInterval(interval);
    }
  }, [role, loadIncidents]);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  async function runAction<T>(fn: () => Promise<T>): Promise<T | null> {
    setBusy(true);
    setError(null);
    try {
      const result = await fn();
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'حدث خطأ غير متوقع');
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function addObservation() {
    if (!selectedId || !obsLat || !obsLng) return;
    await runAction(() =>
      apiPost(`/api/operations/incidents/${selectedId}/observations`, {
        source: 'CALL_TAKER',
        latitude: Number(obsLat),
        longitude: Number(obsLng),
      })
    );
    setObsLat('');
    setObsLng('');
    await loadDetail(selectedId);
    await loadIncidents();
  }

  async function confirmLocation() {
    if (!selectedId) return;
    await runAction(() => apiPost(`/api/operations/incidents/${selectedId}/confirm-location`));
    await loadDetail(selectedId);
    await loadIncidents();
  }

  async function generateRecommendation() {
    if (!selectedId) return;
    const result = await runAction(() => apiPost<GenerateResult>(`/api/operations/incidents/${selectedId}/recommendation`));
    if (result) {
      setGenerated(result);
      setChosenUnitId(result.recommendedUnitId);
      setChosenEntranceId(result.recommendedEntranceId);
    }
    await loadDetail(selectedId);
  }

  async function decideDispatch() {
    if (!selectedId || !generated) return;
    await runAction(() =>
      apiPost(`/api/operations/incidents/${selectedId}/dispatch`, {
        recommendationId: generated.recommendationId,
        chosenUnitId,
        chosenEntranceId,
        overrideReason: overrideReason || undefined,
      })
    );
    await loadDetail(selectedId);
    await loadIncidents();
  }

  if (role === undefined) return null;
  if (role !== 'CALL_TAKER' && role !== 'SUPERVISOR') {
    return (
      <div className="card p-6 text-center">
        <p className="text-navy">اختر دور «مستقبل البلاغ» أو «المشرف» من أعلى الصفحة لدخول غرفة العمليات.</p>
      </div>
    );
  }

  const latestResolution = detail?.resolutions[0];
  const hasConflict = Boolean(latestResolution && latestResolution.conflictingObservationIds.length > 0);
  const status = detail?.incident.status;

  const unitPoint = (id?: string | null): MapPoint | null => {
    const u = id ? units.find((x) => x.id === id) : undefined;
    return u?.latitude != null && u?.longitude != null ? { latitude: u.latitude, longitude: u.longitude, label: u.code } : null;
  };
  const entrancePoint = (id?: string | null): MapPoint | null => {
    const e = id ? entrances.find((x) => x.id === id) : undefined;
    return e?.latitude != null && e?.longitude != null ? { latitude: e.latitude, longitude: e.longitude, label: e.nameAr ?? e.code } : null;
  };
  const mapUnitId = detail?.incident.assignedUnitId ?? generated?.recommendedUnitId ?? null;
  const mapEntranceId = detail?.incident.assignedEntranceId ?? generated?.recommendedEntranceId ?? null;
  const mapUnit = unitPoint(mapUnitId);
  const mapEntrance = entrancePoint(mapEntranceId);
  const mapAlternativeUnit = !detail?.incident.assignedUnitId && generated?.alternativeUnitId ? unitPoint(generated.alternativeUnitId) : null;

  return (
    <div className="grid md:grid-cols-3 gap-4">
      <div className="card p-3 space-y-2 md:col-span-1 max-h-[75vh] overflow-y-auto">
        <h2 className="font-bold text-navy px-1">البلاغات النشطة ({incidents.length})</h2>
        {incidents.map((inc) => (
          <button
            key={inc.id}
            onClick={() => setSelectedId(inc.id)}
            className={`w-full text-right p-2 rounded border ${selectedId === inc.id ? 'border-cherry bg-cherry/5' : 'border-navy/10'}`}
          >
            <div className="flex justify-between text-sm">
              <span className="font-bold">{inc.rescueCode}</span>
              <span className="text-navy/60">{STATUS_LABELS_AR[inc.status] ?? inc.status}</span>
            </div>
            {inc.confidenceScore != null && <div className="text-xs text-navy/50">ثقة الموقع: {inc.confidenceScore}</div>}
          </button>
        ))}
        {incidents.length === 0 && <p className="text-sm text-navy/50 px-1">لا توجد بلاغات نشطة حاليًا.</p>}
      </div>

      <div className="md:col-span-2 space-y-4">
        {error && <p className="text-cherry text-sm">{error}</p>}
        {!detail && <p className="text-navy/50">اختر بلاغًا من القائمة.</p>}
        {detail && (
          <>
            <div className="card p-4">
              <div className="flex justify-between items-center">
                <h2 className="text-lg font-bold text-navy">{detail.incident.rescueCode}</h2>
                <span className="synthetic-badge">{STATUS_LABELS_AR[status ?? ''] ?? status}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-3 text-sm text-navy/80">
                <p>المتصل: {detail.incident.callerName ?? '—'}</p>
                <p>الهاتف: {detail.incident.callerPhone ?? '—'}</p>
                <p>
                  الإحداثيات: {detail.incident.latitude?.toFixed(5)}, {detail.incident.longitude?.toFixed(5)}
                </p>
                <p>ثقة الموقع: {detail.incident.confidenceScore ?? '—'}</p>
                <p>نطاق عدم اليقين: {detail.incident.uncertaintyRadiusMeters ? `${Math.round(detail.incident.uncertaintyRadiusMeters)} م` : '—'}</p>
                <p>الطابق: {detail.incident.floorLevel ?? '—'}</p>
              </div>
              {detail.incident.description && <p className="mt-2 text-sm text-navy/70 border-t pt-2">{detail.incident.description}</p>}
            </div>

            {detail.incident.latitude != null && detail.incident.longitude != null && (
              <div className="card p-4">
                <h3 className="font-bold text-navy mb-2">الخريطة الحية</h3>
                <IncidentMap
                  incident={{
                    latitude: detail.incident.latitude,
                    longitude: detail.incident.longitude,
                    uncertaintyRadiusMeters: detail.incident.uncertaintyRadiusMeters,
                    rescueCode: detail.incident.rescueCode,
                  }}
                  observations={detail.observations.map((o) => ({
                    id: o.id,
                    latitude: o.latitude,
                    longitude: o.longitude,
                    provenanceLabel: o.provenanceLabel,
                    conflicting: latestResolution?.conflictingObservationIds.includes(o.id) ?? false,
                  }))}
                  unit={mapUnit}
                  alternativeUnit={mapAlternativeUnit}
                  entrance={mapEntrance}
                />
                <p className="text-xs text-navy/40 mt-2">
                  دائرة حمراء = نطاق عدم اليقين · نقاط رمادية/كهرمانية = مصادر الرصد (كهرمانية = متعارضة) · أخضر = الوحدة · كحلي = المدخل
                </p>
              </div>
            )}

            {hasConflict && (
              <p className="text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded p-3">
                تعارض بين مصادر الموقع — يوجد {latestResolution!.conflictingObservationIds.length} رصد متعارض مع المصدر الأساسي.
              </p>
            )}

            <div className="card p-4">
              <h3 className="font-bold text-navy mb-2">مصادر الموقع ({detail.observations.length})</h3>
              <div className="space-y-1 text-sm">
                {detail.observations.map((o) => (
                  <div key={o.id} className="flex justify-between border-b border-navy/5 py-1">
                    <span>{o.provenanceLabel}</span>
                    <span className="text-navy/50">
                      {o.source} · {o.latitude.toFixed(5)}, {o.longitude.toFixed(5)}
                    </span>
                  </div>
                ))}
              </div>

              {(status === 'VERIFYING' || status === 'LOW_CONFIDENCE') && (
                <div className="mt-3 flex gap-2 items-end">
                  <input value={obsLat} onChange={(e) => setObsLat(e.target.value)} placeholder="خط العرض" className="border rounded px-2 py-1 w-28" />
                  <input value={obsLng} onChange={(e) => setObsLng(e.target.value)} placeholder="خط الطول" className="border rounded px-2 py-1 w-28" />
                  <button disabled={busy} onClick={addObservation} className="px-3 py-1 rounded border border-navy text-navy text-sm">
                    إضافة رصد
                  </button>
                  <button disabled={busy} onClick={confirmLocation} className="px-3 py-1 rounded bg-navy text-white text-sm">
                    تثبيت الموقع
                  </button>
                </div>
              )}
            </div>

            {role === 'SUPERVISOR' && status === 'READY_FOR_DECISION' && (
              <div className="card p-4 space-y-3">
                <h3 className="font-bold text-navy">توصية الإرسال (Dispatch Score — C6)</h3>
                {!generated && (
                  <button disabled={busy} onClick={generateRecommendation} className="px-4 py-2 rounded bg-cherry text-white">
                    توليد توصية
                  </button>
                )}
                {generated && (
                  <div className="space-y-3">
                    <div className="grid md:grid-cols-2 gap-3">
                      <div className="border rounded p-3">
                        <p className="text-xs text-navy/50 mb-1">الأفضل</p>
                        <p className="font-bold">{unitLabel(generated.recommendedUnitId)} → {entranceLabel(generated.recommendedEntranceId)}</p>
                        <p className="text-sm text-navy/60">Dispatch Score: {generated.dispatchScore}</p>
                      </div>
                      <div className="border rounded p-3">
                        <p className="text-xs text-navy/50 mb-1">البديل</p>
                        <p className="font-bold">
                          {generated.alternativeUnitId ? unitLabel(generated.alternativeUnitId) : '—'} → {entranceLabel(generated.alternativeEntranceId)}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="border rounded p-2">
                        <p className="font-bold text-navy/70">التغطية قبل</p>
                        <p>متوسط ETA: {fmtEta(generated.coverageBefore.meanEtaSeconds)}</p>
                        <p>P90: {fmtEta(generated.coverageBefore.p90EtaSeconds)}</p>
                        <p>خلايا الفجوة: {generated.coverageBefore.gapCellCount}/{generated.coverageBefore.totalCells}</p>
                      </div>
                      <div className="border rounded p-2">
                        <p className="font-bold text-navy/70">التغطية بعد</p>
                        <p>متوسط ETA: {fmtEta(generated.coverageAfter.meanEtaSeconds)}</p>
                        <p>P90: {fmtEta(generated.coverageAfter.p90EtaSeconds)}</p>
                        <p>خلايا الفجوة: {generated.coverageAfter.gapCellCount}/{generated.coverageAfter.totalCells}</p>
                      </div>
                    </div>

                    <div className="border-t pt-3 space-y-2">
                      <p className="text-sm font-bold text-navy">قرار الإسناد</p>
                      <div className="flex gap-2">
                        <select value={chosenUnitId} onChange={(e) => setChosenUnitId(e.target.value)} className="border rounded px-2 py-1 flex-1">
                          <option value={generated.recommendedUnitId}>{unitLabel(generated.recommendedUnitId)} (الموصى بها)</option>
                          {generated.alternativeUnitId && (
                            <option value={generated.alternativeUnitId}>{unitLabel(generated.alternativeUnitId)} (بديل)</option>
                          )}
                        </select>
                        <select value={chosenEntranceId} onChange={(e) => setChosenEntranceId(e.target.value)} className="border rounded px-2 py-1 flex-1">
                          <option value={generated.recommendedEntranceId}>{entranceLabel(generated.recommendedEntranceId)} (الموصى به)</option>
                          {generated.alternativeEntranceId && (
                            <option value={generated.alternativeEntranceId}>{entranceLabel(generated.alternativeEntranceId)} (بديل)</option>
                          )}
                        </select>
                      </div>
                      {(chosenUnitId !== generated.recommendedUnitId || chosenEntranceId !== generated.recommendedEntranceId) && (
                        <input
                          value={overrideReason}
                          onChange={(e) => setOverrideReason(e.target.value)}
                          placeholder="سبب تجاوز التوصية (5 أحرف على الأقل)"
                          className="w-full border rounded px-2 py-1"
                        />
                      )}
                      <button disabled={busy} onClick={decideDispatch} className="w-full px-4 py-2 rounded bg-cherry text-white font-bold">
                        تأكيد الإسناد
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {detail.incident.assignedUnitId && (
              <div className="card p-4">
                <h3 className="font-bold text-navy mb-2">الوحدة المُسندة</h3>
                <p className="text-sm">
                  {unitLabel(detail.incident.assignedUnitId)} → {entranceLabel(detail.incident.assignedEntranceId)}
                </p>
                {detail.fieldActions.length > 0 && (
                  <div className="mt-3 space-y-1 text-sm">
                    {detail.fieldActions.map((fa) => (
                      <div key={fa.id} className="flex justify-between border-b border-navy/5 py-1">
                        <span>{fa.actionType}</span>
                        <span className="text-navy/50">{fa.resultingStatus ?? '—'}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
