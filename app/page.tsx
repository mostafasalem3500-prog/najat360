'use client';

import { useState } from 'react';
import Link from 'next/link';
import { apiPost, ApiError } from './_lib/api';
import { PhoneCall, Radio, Ambulance, ArrowLeft, RotateCcw, Zap, CheckCircle2, Sparkles } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

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
    <div className="space-y-8 animate-in">
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-navy via-navy to-navy-dark p-8 md:p-10 text-white shadow-navy-glow">
        <div className="absolute -top-16 -left-16 w-64 h-64 rounded-full bg-cherry/20 blur-3xl" />
        <div className="absolute -bottom-20 -right-10 w-72 h-72 rounded-full bg-gold/10 blur-3xl" />
        <div className="relative">
          <span className="chip bg-white/10 text-white mb-4">
            <Sparkles size={13} strokeWidth={2.5} />
            إسعافثون 2026 — نموذج حي
          </span>
          <h1 className="text-3xl md:text-4xl font-black mb-3 leading-tight">
            نجاة <span className="text-cherry-light">360</span> — المسار الذهبي الكامل
          </h1>
          <p className="text-white/80 leading-relaxed max-w-2xl">
            نموذج ويب حي مبني فوق محرك نجاة 360 المُختبر بأكثر من 480 اختبارًا آليًا: من بلاغ المتصل، إلى تثبيت
            الموقع ومعالجة التعارض بدقة، إلى توصية إرسال واعية بالتغطية والتمركز، إلى تتبع الميدان حتى الإغلاق.
          </p>
          <p className="text-white/50 text-xs mt-4">كل البيانات هنا اصطناعية بالكامل — لا بيانات تشغيلية حقيقية.</p>
        </div>
      </section>

      <section className="grid md:grid-cols-3 gap-4">
        <StepCard
          n="١"
          Icon={PhoneCall}
          href="/caller"
          title="شاشة المتصل"
          desc="مسح رمز QR لنقطة نجاة أو التقاط GPS، ثم إرسال البلاغ."
        />
        <StepCard
          n="٢"
          Icon={Radio}
          href="/operations"
          title="غرفة العمليات"
          desc="مستقبل البلاغ يثبّت الموقع؛ المشرف يولّد توصية إرسال واعية بالتغطية ويقرر."
        />
        <StepCard n="٣" Icon={Ambulance} href="/medic" title="الميدان (FieldLink)" desc="المسعف يحدّث الحالة من الإسناد حتى الإغلاق." />
      </section>

      <section className="card p-6 space-y-3">
        <h2 className="font-bold text-navy flex items-center gap-2">
          <RotateCcw size={18} className="text-cherry" strokeWidth={2.25} />
          أدوات العرض التجريبي
        </h2>
        <p className="text-sm text-navy/70">
          استخدم هذا الزر لمسح كل الحوادث التي أنشأها هذا المسار الحي وإعادة زرع مجموعة العرض الكاملة (الوحدات،
          المداخل، نقاط النجاة، حوادث تاريخية) من جديد قبل عرض جديد.
        </p>
        <div className="flex flex-wrap gap-3">
          <button disabled={resetting} onClick={() => resetDemo(true)} className="btn btn-primary">
            <Zap size={15} strokeWidth={2.5} />
            إعادة تعيين سريعة (~50 حادث تاريخي)
          </button>
          <button disabled={resetting} onClick={() => resetDemo(false)} className="btn btn-secondary">
            <RotateCcw size={15} strokeWidth={2.25} />
            إعادة تعيين كاملة
          </button>
        </div>
        {resetting && <p className="text-sm text-navy/60">جارٍ إعادة التعيين... قد يستغرق هذا حتى دقيقة واحدة.</p>}
        {message && (
          <p className="text-sm text-emerald-700 flex items-center gap-1.5">
            <CheckCircle2 size={15} strokeWidth={2.25} />
            {message}
          </p>
        )}
        <p className="text-xs text-navy/50">
          يعمل هذا الزر فقط عندما يكون DEMO_MODE=true — راجع src/lib/demo-mode.ts.
        </p>
      </section>
    </div>
  );
}

function StepCard({ n, Icon, href, title, desc }: { n: string; Icon: LucideIcon; href: string; title: string; desc: string }) {
  return (
    <Link href={href} className="card p-5 block relative overflow-hidden group">
      <span className="absolute top-3 left-4 text-4xl font-black text-navy/[0.06] select-none">{n}</span>
      <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-cherry to-cherry-dark text-white shadow-sm shadow-cherry/30 mb-3">
        <Icon size={18} strokeWidth={2.25} />
      </span>
      <h3 className="font-bold text-navy mb-1 flex items-center gap-1">
        {title}
        <ArrowLeft size={14} className="text-cherry opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
      </h3>
      <p className="text-sm text-navy/70">{desc}</p>
    </Link>
  );
}
