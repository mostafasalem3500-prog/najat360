'use client';

/**
 * Printable Rescue Anchor QR list (spec 29.1). Each code renders as a QR
 * encoding a link to /caller?anchor=<code> — scanning it lands directly on
 * the caller screen with the anchor code pre-filled (see app/caller/page.tsx
 * reading the `anchor` query param), so a physical sticker at a real
 * entrance is a genuine one-scan path into the golden path, not just a
 * printed string someone has to retype.
 */
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { apiGet } from '../_lib/api';

interface AnchorRow {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  anchorType: string;
  floorLevel: string | null;
}

function AnchorCard({ anchor }: { anchor: AnchorRow }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    QRCode.toDataURL(`${origin}/caller?anchor=${encodeURIComponent(anchor.code)}`, { margin: 1, width: 220 })
      .then(setDataUrl)
      .catch(() => setDataUrl(null));
  }, [anchor.code]);

  return (
    <div className="card p-4 text-center break-inside-avoid">
      {dataUrl ? (
        <img src={dataUrl} alt={`QR ${anchor.code}`} className="mx-auto" />
      ) : (
        <div className="h-[220px]" />
      )}
      <p className="font-bold text-navy mt-2">{anchor.code}</p>
      <p className="text-sm text-navy/70">
        {anchor.nameAr} {anchor.floorLevel ? `— ${anchor.floorLevel}` : ''}
      </p>
      <p className="text-xs text-navy/40">{anchor.anchorType}</p>
    </div>
  );
}

export default function AnchorsPage() {
  const [anchors, setAnchors] = useState<AnchorRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ anchors: AnchorRow[] }>('/api/anchors')
      .then((r) => setAnchors(r.anchors))
      .catch(() => setError('تعذر تحميل نقاط النجاة.'));
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-navy">نقاط النجاة (Rescue Anchors) — للطباعة</h1>
        <button onClick={() => window.print()} className="px-4 py-2 rounded bg-navy text-white print:hidden">
          طباعة
        </button>
      </div>
      <p className="text-sm text-navy/60 print:hidden">
        كل رمز يشفّر رابطًا مباشرًا إلى شاشة المتصل مع تعبئة رمز النقطة تلقائيًا — الإحداثيات نفسها تُقرأ من الخادم
        دائمًا (spec 29.1)، لا يمكن لأي عميل إرسال إحداثيات مزيفة عبر مسح رمز.
      </p>
      {error && <p className="text-cherry">{error}</p>}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {anchors.map((a) => (
          <AnchorCard key={a.id} anchor={a} />
        ))}
      </div>
    </div>
  );
}
