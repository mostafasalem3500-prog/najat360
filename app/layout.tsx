import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import 'leaflet/dist/leaflet.css';
import RoleSwitcher from './_components/RoleSwitcher';
import HeaderNav from './_components/HeaderNav';
import { Siren } from 'lucide-react';

export const metadata: Metadata = {
  title: 'نجاة 360 — NAJAT360',
  description: 'طبقة رفيقة لتحديد الموقع بدقة والإرسال الذكي للوحدات — إسعافثون 2026',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;900&display=swap" rel="stylesheet" />
      </head>
      <body className="min-h-screen font-sans bg-app-gradient">
        <header className="bg-white/80 backdrop-blur-md border-b border-navy/10 sticky top-0 z-20">
          <div className="max-w-6xl mx-auto px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
            <Link href="/" className="flex items-center gap-2 shrink-0">
              <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-navy to-navy-light text-white shadow-md shadow-navy/20">
                <Siren size={18} strokeWidth={2.5} />
              </span>
              <span className="font-black text-navy text-lg tracking-tight">
                نجاة <span className="text-cherry">360</span>
              </span>
            </Link>
            <HeaderNav />
            <RoleSwitcher />
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
