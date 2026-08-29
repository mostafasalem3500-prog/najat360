import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import 'leaflet/dist/leaflet.css';
import RoleSwitcher from './_components/RoleSwitcher';

export const metadata: Metadata = {
  title: 'نجاة 360 — NAJAT360',
  description: 'طبقة رفيقة لتحديد الموقع بدقة والإرسال الذكي للوحدات — إسعافثون 2026',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body className="min-h-screen font-sans">
        <header className="bg-white border-b border-navy/10 sticky top-0 z-10">
          <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <nav className="flex items-center gap-4">
              <Link href="/" className="font-bold text-navy text-lg">
                نجاة <span className="text-cherry">360</span>
              </Link>
              <Link href="/caller" className="text-navy/80 hover:text-cherry">
                شاشة المتصل
              </Link>
              <Link href="/operations" className="text-navy/80 hover:text-cherry">
                غرفة العمليات
              </Link>
              <Link href="/medic" className="text-navy/80 hover:text-cherry">
                الميدان (FieldLink)
              </Link>
              <Link href="/anchors" className="text-navy/80 hover:text-cherry">
                نقاط النجاة (QR)
              </Link>
              <Link href="/dashboard" className="text-navy/80 hover:text-cherry">
                لوحة المؤشرات
              </Link>
            </nav>
            <RoleSwitcher />
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
