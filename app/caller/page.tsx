'use client';

/**
 * Caller screen — P0 golden path step 1: QR anchor scan (or manual code
 * entry) OR browser GPS capture, then submit. Calls POST /api/caller/report
 * (src/lib/incidents/intake.ts's submitCallerReport() + resolveLocation()
 * wired together in src/server/repo.ts's createIncidentFromCallerReport()).
 *
 * The one-time callerToken this returns is stored in localStorage so a
 * caller who reloads the page (or a demo operator re-showing this screen)
 * keeps polling the SAME incident rather than losing it — this is real
 * per-browser convenience state, not the in-conversation-artifact preview
 * this codebase's other constraints are about (this page ships as part of
 * the deployed app itself).
 */
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiGet, apiPost, ApiError } from '../_lib/api';

interface ReportResult {
  incidentId: string;
  rescueCode: string;
  callerToken: string;
  callerTokenExpiresAt: string;
  status: string;
  hasConflict: boolean;
  confidenceIndex: number;
}

const STORAGE_KEY = 'najat360_caller_session';

const STATUS_LABELS_AR: Record<string, string> = {
  NEW: 'تم استلام البلاغ',
  VERIFYING: 'جارٍ تثبيت الموقع من غرفة العمليات',
  LOW_CONFIDENCE: 'الموقع غير واضح — يتم التحقق',
  READY_FOR_DECISION: 'جاهز لقرار الإرسال',
  NO_UNIT_AVAILABLE: 'لا توجد وحدة متاحة حاليًا',
  DISPATCHED: 'تم إسناد وحدة إسعاف',
  EN_ROUTE: 'الوحدة في الطريق إليك',
  AT_ACCESS_POINT: 'الوحدة وصلت عند المدخل',
  ON_SCENE: 'الفريق معك الآن',
  ACCESS_BLOCKED: 'تعذر الوصول — جارٍ إيجاد بديل',
  CLOSED: 'تم إغلاق البلاغ',
  CANCELLED_BY_OPERATOR: 'تم إلغاء البلاغ',
};

function CallerScreenInner() {
  const searchParams = useSearchParams();
  const anchorFromUrl = searchParams.get('anchor') ?? '';

  const [session, setSession] = useState<ReportResult | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const [language, setLanguage] = useState('ar');
  const [unableToSpeak, setUnableToSpeak] = useState(false);
  const [description, setDescription] = useState('');
  const [callerName, setCallerName] = useState('');
  const [callerPhone, setCallerPhone] = useState('');
  const [locationMode, setLocationMode] = useState<'ANCHOR' | 'GPS'>(anchorFromUrl ? 'ANCHOR' : 'GPS');
  const [anchorCode, setAnchorCode] = useState(anchorFromUrl);
  const [gpsCoords, setGpsCoords] = useState<{ latitude: number; longitude: number; accuracy: number } | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        setSession(JSON.parse(raw));
      } catch {
        // ignore corrupt local storage
      }
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    async function poll() {
      try {
        const r = await apiGet<{ status: string }>(
          `/api/caller/status?incidentId=${encodeURIComponent(session!.incidentId)}&token=${encodeURIComponent(session!.callerToken)}`
        );
        if (!cancelled) setStatus(r.status);
      } catch {
        // transient — keep the last known status, retry next tick
      }
    }
    poll();
    const interval = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [session]);

  function captureGps() {
    setGpsError(null);
    if (!('geolocation' in navigator)) {
      setGpsError('المتصفح لا يدعم تحديد الموقع.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        setGpsCoords({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
      (err) => setGpsError(err.message || 'تعذر الحصول على الموقع.'),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  async function submit() {
    setSubmitError(null);
    if (locationMode === 'ANCHOR' && !anchorCode.trim()) {
      setSubmitError('أدخل رمز نقطة النجاة أولًا.');
      return;
    }
    if (locationMode === 'GPS' && !gpsCoords) {
      setSubmitError('التقط موقعك عبر GPS أولًا.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await apiPost<ReportResult>('/api/caller/report', {
        language,
        unableToSpeak,
        description: description || undefined,
        callerName: callerName || undefined,
        callerPhone: callerPhone || undefined,
        location:
          locationMode === 'ANCHOR'
            ? { type: 'ANCHOR', anchorCode: anchorCode.trim() }
            : { type: 'GPS', latitude: gpsCoords!.latitude, longitude: gpsCoords!.longitude, horizontalAccuracyMeters: gpsCoords!.accuracy },
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(result));
      setSession(result);
      setStatus(result.status);
    } catch (e) {
      setSubmitError(e instanceof ApiError ? e.message : 'تعذر إرسال البلاغ. حاول مجددًا.');
    } finally {
      setSubmitting(false);
    }
  }

  function startNewReport() {
    localStorage.removeItem(STORAGE_KEY);
    setSession(null);
    setStatus(null);
  }

  if (session) {
    return (
      <div className="max-w-lg mx-auto card p-6 space-y-4">
        <span className="synthetic-badge">بيانات اصطناعية — عرض تجريبي</span>
        <h1 className="text-xl font-bold text-navy">تم استلام بلاغك</h1>
        <p className="text-navy/70 text-sm">رمز الإنقاذ الخاص بك — احتفظ به:</p>
        <p className="text-3xl font-bold tracking-widest text-cherry text-center py-3 bg-cherry/5 rounded">{session.rescueCode}</p>
        <div className="text-center">
          <p className="text-navy/60 text-sm">الحالة الحالية</p>
          <p className="text-lg font-bold text-navy">{STATUS_LABELS_AR[status ?? session.status] ?? status ?? session.status}</p>
        </div>
        {session.hasConflict && (
          <p className="text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded p-2">
            تم رصد تعارض بين مصادر الموقع — سيقوم مستقبل البلاغ بمراجعته وتثبيته.
          </p>
        )}
        <button onClick={startNewReport} className="w-full px-4 py-2 rounded border border-navy text-navy">
          بلاغ جديد
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto card p-6 space-y-5">
      <span className="synthetic-badge">بيانات اصطناعية — عرض تجريبي</span>
      <h1 className="text-xl font-bold text-navy">شاشة المتصل</h1>

      <div>
        <label className="block text-sm font-medium text-navy mb-1">مصدر الموقع</label>
        <div className="flex gap-2">
          <button
            onClick={() => setLocationMode('ANCHOR')}
            className={`flex-1 px-3 py-2 rounded border ${locationMode === 'ANCHOR' ? 'bg-navy text-white border-navy' : 'border-navy/30 text-navy'}`}
          >
            رمز نقطة نجاة (QR)
          </button>
          <button
            onClick={() => setLocationMode('GPS')}
            className={`flex-1 px-3 py-2 rounded border ${locationMode === 'GPS' ? 'bg-navy text-white border-navy' : 'border-navy/30 text-navy'}`}
          >
            موقعي (GPS)
          </button>
        </div>
      </div>

      {locationMode === 'ANCHOR' ? (
        <input
          value={anchorCode}
          onChange={(e) => setAnchorCode(e.target.value)}
          placeholder="مثال: ANCH-014"
          className="w-full border rounded px-3 py-2"
        />
      ) : (
        <div className="space-y-2">
          <button onClick={captureGps} className="w-full px-4 py-2 rounded bg-navy text-white">
            التقط موقعي الآن
          </button>
          {gpsCoords && (
            <p className="text-sm text-navy/70">
              تم الالتقاط: {gpsCoords.latitude.toFixed(5)}, {gpsCoords.longitude.toFixed(5)} (دقة ~{Math.round(gpsCoords.accuracy)} م)
            </p>
          )}
          {gpsError && <p className="text-sm text-cherry">{gpsError}</p>}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-navy mb-1">اللغة</label>
        <select value={language} onChange={(e) => setLanguage(e.target.value)} className="w-full border rounded px-3 py-2">
          <option value="ar">العربية</option>
          <option value="en">English</option>
        </select>
      </div>

      <label className="flex items-center gap-2 text-sm text-navy">
        <input type="checkbox" checked={unableToSpeak} onChange={(e) => setUnableToSpeak(e.target.checked)} />
        لا أستطيع التحدث الآن
      </label>

      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="وصف الحالة (اختياري)"
        className="w-full border rounded px-3 py-2"
        rows={3}
      />
      <input
        value={callerName}
        onChange={(e) => setCallerName(e.target.value)}
        placeholder="اسمك (اختياري)"
        className="w-full border rounded px-3 py-2"
      />
      <input
        value={callerPhone}
        onChange={(e) => setCallerPhone(e.target.value)}
        placeholder="رقم للتواصل (اختياري)"
        className="w-full border rounded px-3 py-2"
      />

      {submitError && <p className="text-sm text-cherry">{submitError}</p>}
      <button disabled={submitting} onClick={submit} className="w-full px-4 py-3 rounded bg-cherry text-white font-bold disabled:opacity-50">
        {submitting ? 'جارٍ الإرسال...' : 'إرسال البلاغ'}
      </button>
    </div>
  );
}

export default function CallerPage() {
  return (
    <Suspense fallback={null}>
      <CallerScreenInner />
    </Suspense>
  );
}
