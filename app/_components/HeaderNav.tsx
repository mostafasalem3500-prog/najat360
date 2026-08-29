'use client';

/**
 * Header navigation — split out of layout.tsx (a server component) purely
 * so the active-route highlight can use usePathname(), which needs a
 * client component. No data/behavior beyond that: every href/label here
 * is unchanged from the original inline nav, just re-styled and paired
 * with a lucide icon per destination.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PhoneCall, Radio, Ambulance, QrCode, LayoutDashboard } from 'lucide-react';

const LINKS = [
  { href: '/caller', label: 'شاشة المتصل', Icon: PhoneCall },
  { href: '/operations', label: 'غرفة العمليات', Icon: Radio },
  { href: '/medic', label: 'الميدان (FieldLink)', Icon: Ambulance },
  { href: '/anchors', label: 'نقاط النجاة (QR)', Icon: QrCode },
  { href: '/dashboard', label: 'لوحة المؤشرات', Icon: LayoutDashboard },
];

export default function HeaderNav() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1 overflow-x-auto">
      {LINKS.map(({ href, label, Icon }) => {
        const active = pathname === href || pathname?.startsWith(href + '/');
        return (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
              active
                ? 'bg-gradient-to-l from-cherry to-cherry-dark text-white shadow-sm shadow-cherry/30'
                : 'text-navy/70 hover:text-navy hover:bg-navy/5'
            }`}
          >
            <Icon size={16} strokeWidth={2.25} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
