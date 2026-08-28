'use client';

import { useState } from 'react';
import Link from 'next/link';
import { apiPost, ApiError } from './_lib/api';

export default function HomePage() {
  const [resetting, setResetting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function resetDemo(fast: boolean) {
    setResetting(true);
    setMessage(null);
    try {
      await apiPost(`/api/demo/reset${fast ? '?fast=1' : ''}`);
      setMessage('تمت إعادة تعيين بيانات العرض التجريبي بنجاح.');
    } catch (e) {
      setMessage(e instanceof ApiError ? `تعذر إعادة التعيين: ${e.message}` : 'تعذر إعادة التعيين.');
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="space-y-8">
      <section className="card p-6">
        <h1 className="text-2xl font-bold text-navy mb-2">نجاة 360 — المسار الذهبي الكامل</h1>
        <p className="text-navy/80 leading-relaxed">
          نموذج ويب حي مبني فوق محرك نجاة 360 المُختبر (447 اختبارًا، المراحل C1–C6): من بلاغ المتصل، إلى تثبيت
          الموقع ومعالجة التعارض، إلى توصية الإرسال الواعية بالتغطية، إلى تتبع الميدان حتى الإغلاق. كل البيانات
          هنا اصطناعية بالكامل — لا بيانات تشغيلية حقيقية.
        </p>
      </section>

      <section className="grid md:grid-cols-3 gap-4">
        <StepCard
          href="/caller"
          title="١. شاشة المتصل"
          desc="مسح رمز QR لنقطة نجاة أو التقاط GPS، ثم إرسال البلاغ."
        />
        <StepCard
          href="/operations"
          title="٢. غرفة العمليات"
          desc="مستقبل البلاغ يثبّت الموقع؛ المشرف يولّد توصية إرسال ويقرر."
        />
        <StepCard href="/medic" title="٣. الميدان (FieldLink)" desc="المسعف يحدّث الحالة من الإسناد حتى الإغلاق." />
      </section>

      <section className="card p-6 space-y-3">
        <h2 className="font-bold text-navy">أدوات العرض التجريبي</h2>
        <p className="text-sm text-navy/70">
          استخدم هذا الزر لمسح كل الحوادث التي أنشأها هذا المسار الحي وإعادة زرع مجموعة العرض الكاملة (الوحدات،
          المداخل، نقاط النجاة، حوادث تاريخية) من جديد قبل عرض جديد.
        </p>
        <div className="flex gap-3">
          <button disabled={resetting} onClick={() => resetDemo(true)} className="px-4 py-2 rounded bg-navy text-white disabled:opacity-50">
            إعادة تعيين سريعة (~50 حادث تاريخي)
          </button>
          <button disabled={resetting} onClick={() => resetDemo(false)} className="px-4 py-2 rounded border border-navy text-navy disabled:opacity-50">
            إعادة تعيين كاملة
          </button>
        </div>
        {resetting && <p className="text-sm text-navy/60">جارٍ إعادة التعيين... قد يستغرق هذا حتى دقيقة واحدة.</p>}
        {message && <p className="text-sm text-cherry">{message}</p>}
        <p className="text-xs text-navy/50">
          يعمل هذا الزر فقط عندما يكون DEMO_MODE=true — راجع src/lib/demo-mode.ts.
        </p>
      </section>
    </div>
  );
}

function StepCard({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <Link href={href} className="card p-5 block hover:shadow-md transition-shadow">
      <h3 className="font-bold text-cherry mb-1">{title}</h3>
      <p className="text-sm text-navy/70">{desc}</p>
    </Link>
  );
}
