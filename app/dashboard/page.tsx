'use client';

/**
 * Operations dashboard — the "لوحة بيانات توضح جميع المؤشرات وزمن
 * الاستجابة" screen requested after the C1-C6 QA pass. SUPERVISOR-only
 * (matches /api/dashboard/metrics — see that route's header), refreshed
 * on an 8s poll like /operations. Every number here is computed live from
 * Incident/IncidentEvent/AmbulanceUnit/H3Prediction rows by
 * getDashboardMetrics() — see that function's header in src/server/repo.ts
 * for why there is no separate metrics table to fall out of sync.
 */
import { useEffect, useState } from 'react';
import { apiGet, ApiError } from '../_lib/api';
import { onRoleChanged } from '../_lib/role-events';

interface DashboardMetrics {
  totals: {
    incidents: number;
    activeIncidents: number;
    closedToday: number;
    units: number;
    availableUnits: number;
  };
  incidentsByStatus: { status: string; count: number }[];
  unitsByStatus: { status: string; count: number }[];
  responseTime: {
    avgDispatchMinutes: number | null;
    avgArrivalMinutes: number | null;
    avgResolutionMinutes: number | null;
    sampleSize: number;
  };
  demandCoverage: {
    h3PredictionCells: number;
    highDemandCells: number;
  };
  locationAccuracy: {
    avgConfidenceIndex: number | null;
    byBand: { band: 'HIGH' | 'MEDIUM' | 'LOW'; count: number }[];
    conflictRatePercent: number | null;
    totalResolutions: number;
  };
  positioning: {
    hotspots: {
      h3Index: string;
      etaSeconds: number;
      predictedDemand: number;
      recommendedUnits: number;
      nearestUnitId: string;
      reasoning: string[];
    }[];
    gapCellCount: number;
    totalCells: number;
  };
  recentIncidents: {
    id: string;
    rescueCode: string;
    status: string;
    priority: string | null;
    createdAt: string;
    assignedUnitId: string | null;
  }[];
}

const INCIDENT_STATUS_LABELS_AR: Record<string, string> = {
  NEW: 'جديد',
  VERIFYING: 'قيد تثبيت الموقع',
  LOW_CONFIDENCE: 'ثقة منخفضة',
  READY_FOR_DECISION: 'جاهز للإسناد',
  NO_UNIT_AVAILABLE: 'لا وحدة متاحة',
  DISPATCHED: 'تم الإسناد',
  EN_ROUTE: 'في الطريق',
  ACCESS_BLOCKED: 'تعذر الوصول',
  AT_ACCESS_POINT: 'عند المدخل',
  ON_SCENE: 'في الموقع',
  CLOSED: 'مغلق',
  CANCELLED_BY_OPERATOR: 'ملغى',
};

const UNIT_STATUS_LABELS_AR: Record<string, string> = {
  AVAILABLE: 'متاحة',
  DISPATCHED: 'مسندة',
  EN_ROUTE: 'في الطريق',
  ON_SCENE: 'في الموقع',
  OUT_OF_SERVICE: 'خارج الخدمة',
};

function fmtMinutes(v: number | null): string {
  if (v === null) return '—';
  if (v < 1) return `${Math.round(v * 60)} ث`;
  return `${v.toFixed(1)} د`;
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="card p-4">
      <p className="text-navy/60 text-sm">{label}</p>
      <p className="text-2xl font-bold text-navy">{value}</p>
      {sub && <p className="text-navy/50 text-xs mt-1">{sub}</p>}
    </div>
  );
}

export default function DashboardPage() {
  const [role, setRole] = useState<string | null | undefined>(undefined);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ session: { role: string } | null }>('/api/demo-session').then((r) => setRole(r.session?.role ?? null));
  }, []);

  // Picks up a role switch from the header without needing a manual reload — see role-events.ts.
  useEffect(() => onRoleChanged((session) => setRole(session.role)), []);

  useEffect(() => {
    if (role !== 'SUPERVISOR') return;
    let cancelled = false;
    async function load() {
      try {
        const r = await apiGet<DashboardMetrics>('/api/dashboard/metrics');
        if (!cancelled) {
          setMetrics(r);
          setError(null);
        }
      } catch (e) {
        if (!cancelled && e instanceof ApiError && e.status !== 401 && e.status !== 403) setError(e.message);
      }
    }
    load();
    const interval = setInterval(load, 8000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [role]);

  if (role === undefined) return null;

  if (role !== 'SUPERVISOR') {
    return (
      <div className="card p-6 text-center">
        <p className="text-navy">اختر دور «المشرف» من أعلى الصفحة لعرض لوحة المؤشرات.</p>
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="card p-6 text-center">
        <p className="text-navy/60">{error ?? 'جارٍ تحميل المؤشرات...'}</p>
      </div>
    );
  }

  const { totals, incidentsByStatus, unitsByStatus, responseTime, demandCoverage, locationAccuracy, positioning, recentIncidents } = metrics;
  const BAND_LABELS_AR: Record<string, string> = { HIGH: 'مرتفعة', MEDIUM: 'متوسطة', LOW: 'منخفضة' };

  return (
    <div className="space-y-6">
      <div>
        <span className="synthetic-badge">بيانات اصطناعية — عرض تجريبي</span>
        <h1 className="text-xl font-bold text-navy mt-2">لوحة مؤشرات العمليات</h1>
        <p className="text-navy/60 text-sm">تحدّث تلقائيًا كل 8 ثوانٍ</p>
      </div>

      {error && <p className="text-sm text-cherry">{error}</p>}

      <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="إجمالي البلاغات" value={totals.incidents} />
        <StatCard label="بلاغات نشطة" value={totals.activeIncidents} />
        <StatCard label="أُغلقت اليوم" value={totals.closedToday} />
        <StatCard label="إجمالي الوحدات" value={totals.units} />
        <StatCard label="وحدات متاحة الآن" value={totals.availableUnits} sub={`من أصل ${totals.units}`} />
      </section>

      <section>
        <h2 className="text-lg font-bold text-navy mb-2">زمن الاستجابة</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <StatCard label="متوسط زمن الإسناد" value={fmtMinutes(responseTime.avgDispatchMinutes)} sub="من استلام البلاغ حتى إسناد وحدة" />
          <StatCard label="متوسط زمن الوصول" value={fmtMinutes(responseTime.avgArrivalMinutes)} sub="من الإسناد حتى الوصول للموقع" />
          <StatCard label="متوسط زمن الإغلاق الكامل" value={fmtMinutes(responseTime.avgResolutionMinutes)} sub="من الاستلام حتى إغلاق البلاغ" />
          <StatCard label="حجم العينة" value={responseTime.sampleSize} sub="بلاغ محتسب في المتوسطات أعلاه" />
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <h2 className="text-lg font-bold text-navy mb-2">البلاغات حسب الحالة</h2>
          <div className="card p-4 space-y-2">
            {incidentsByStatus.map((row) => (
              <div key={row.status} className="flex items-center justify-between text-sm">
                <span className="text-navy/80">{INCIDENT_STATUS_LABELS_AR[row.status] ?? row.status}</span>
                <span className="font-bold text-navy">{row.count}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h2 className="text-lg font-bold text-navy mb-2">الوحدات حسب الحالة</h2>
          <div className="card p-4 space-y-2">
            {unitsByStatus.map((row) => (
              <div key={row.status} className="flex items-center justify-between text-sm">
                <span className="text-navy/80">{UNIT_STATUS_LABELS_AR[row.status] ?? row.status}</span>
                <span className="font-bold text-navy">{row.count}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-bold text-navy">دقة تحديد الموقع</h2>
          <a
            href="/api/dashboard/export/location-accuracy"
            className="text-xs font-medium rounded-full bg-navy/5 text-navy px-3 py-1 hover:bg-navy/10 transition"
          >
            تصدير CSV
          </a>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              label="متوسط درجة الثقة"
              value={locationAccuracy.avgConfidenceIndex !== null ? Math.round(locationAccuracy.avgConfidenceIndex) : '—'}
              sub={`عبر ${locationAccuracy.totalResolutions} عملية تحديد موقع`}
            />
            <StatCard
              label="نسبة التعارض بين المصادر"
              value={locationAccuracy.conflictRatePercent !== null ? `${locationAccuracy.conflictRatePercent}%` : '—'}
              sub="من عمليات تحديد الموقع"
            />
          </div>
          <div className="card p-4 space-y-2">
            <p className="text-navy/60 text-sm mb-1">توزيع درجة الثقة</p>
            {locationAccuracy.byBand.map((row) => (
              <div key={row.band} className="flex items-center justify-between text-sm">
                <span className="text-navy/80">{BAND_LABELS_AR[row.band] ?? row.band}</span>
                <span className="font-bold text-navy">{row.count}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-bold text-navy mb-2">تغطية الطلب (H3)</h2>
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="خلايا تنبؤ محسوبة" value={demandCoverage.h3PredictionCells} />
          <StatCard label="خلايا طلب مرتفع" value={demandCoverage.highDemandCells} sub="تحتاج وحدتين أو أكثر" />
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-bold text-navy">توصيات التمركز الاستباقي</h2>
          <a
            href="/api/dashboard/export/positioning"
            className="text-xs font-medium rounded-full bg-navy/5 text-navy px-3 py-1 hover:bg-navy/10 transition"
          >
            تصدير CSV
          </a>
        </div>
        <p className="text-navy/50 text-xs mb-2">
          خلايا هي فجوة تغطية حاليًا بموقع الأسطول الحالي *و* لها طلب متوقع — إشارة للنظر فيها، وليست أمرًا تلقائيًا؛ القرار بيد المشرف.
          {` (${positioning.gapCellCount} من ${positioning.totalCells} خلية تعتبر فجوة تغطية الآن)`}
        </p>
        {positioning.hotspots.length === 0 ? (
          <div className="card p-4 text-navy/50 text-sm">لا توجد نقاط ساخنة تحتاج إعادة تمركز حاليًا.</div>
        ) : (
          <div className="space-y-2">
            {positioning.hotspots.map((h) => (
              <div key={h.h3Index} className="card p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono text-xs text-navy/60">{h.h3Index}</span>
                  <span className="text-xs font-bold text-amber-700">يوصى بـ {h.recommendedUnits} وحدة</span>
                </div>
                {h.reasoning.map((line, i) => (
                  <p key={i} className="text-sm text-navy/80">
                    {line}
                  </p>
                ))}
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-bold text-navy mb-2">أحدث البلاغات</h2>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead>
              <tr className="border-b border-navy/10 text-navy/60">
                <th className="p-3">رمز الإنقاذ</th>
                <th className="p-3">الحالة</th>
                <th className="p-3">الأولوية</th>
                <th className="p-3">الوحدة المسندة</th>
                <th className="p-3">وقت الاستلام</th>
              </tr>
            </thead>
            <tbody>
              {recentIncidents.map((inc) => (
                <tr key={inc.id} className="border-b border-navy/5 last:border-0">
                  <td className="p-3 font-mono">{inc.rescueCode}</td>
                  <td className="p-3">{INCIDENT_STATUS_LABELS_AR[inc.status] ?? inc.status}</td>
                  <td className="p-3">{inc.priority ?? '—'}</td>
                  <td className="p-3">{inc.assignedUnitId ? inc.assignedUnitId.slice(0, 8) : '—'}</td>
                  <td className="p-3">{new Date(inc.createdAt).toLocaleString('ar-SA')}</td>
                </tr>
              ))}
              {recentIncidents.length === 0 && (
                <tr>
                  <td className="p-3 text-navy/50" colSpan={5}>
                    لا توجد بلاغات بعد.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
