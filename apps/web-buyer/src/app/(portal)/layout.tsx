'use client';
import { Badge, Button, cn, humanise, Skeleton } from '@agrimate/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { ErrorState } from '@/components/common';
import { SessionGate, useSession } from '@/lib/session';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', exact: true },
  { href: '/rfqs/new', label: 'Post RFQ', exact: true },
  { href: '/rfqs', label: 'RFQs and bids', exact: true },
  { href: '/catalog', label: 'Catalog' },
  { href: '/orders', label: 'Orders' },
  { href: '/prices', label: 'Market prices' },
  { href: '/kyb', label: 'Business verification' },
];

const KYB_TONE: Record<string, string> = { VERIFIED: 'green', REJECTED: 'red', MANUAL_REVIEW: 'amber', PENDING: 'amber', NOT_SUBMITTED: 'amber' };

function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { me, signOut } = useSession();
  const status = me.buyer?.kybStatus ?? 'NOT_SUBMITTED';
  return (
    <div className="flex min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:rounded focus:bg-white focus:p-2">Skip to content</a>
      <aside className="sticky top-0 flex h-screen w-52 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="px-4 py-4">
          <p className="text-base font-semibold text-slate-900">Agrimate</p>
          <p className="text-xs text-slate-500">Buyer portal</p>
        </div>
        <nav aria-label="Main" className="flex-1 space-y-0.5 px-2">
          {NAV.map((n) => {
            const active = n.exact ? path === n.href : path.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} aria-current={active ? 'page' : undefined} className={cn('block rounded-md px-3 py-2 text-sm', active ? 'bg-emerald-50 font-medium text-emerald-900' : 'text-slate-700 hover:bg-slate-100')}>
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="space-y-2 border-t border-slate-200 p-3">
          <p className="truncate text-sm font-medium text-slate-900" title={me.buyer?.companyName ?? me.name}>{me.buyer?.companyName ?? me.name}</p>
          <Badge tone={KYB_TONE[status] ?? 'slate'}>KYB: {humanise(status).toLowerCase()}</Badge>
          <Button variant="secondary" size="sm" className="w-full" onClick={() => void signOut()}>Sign out</Button>
        </div>
      </aside>
      <main id="main" className="min-w-0 flex-1 p-6">{children}</main>
    </div>
  );
}

const GateLoading = () => (
  <div className="flex min-h-screen" aria-busy="true">
    <div className="w-52 shrink-0 space-y-3 border-r border-slate-200 bg-white p-4">
      {Array.from({ length: 7 }, (_, i) => <Skeleton key={i} className="h-5 w-full" />)}
    </div>
    <div className="flex-1 space-y-3 p-6"><span className="sr-only">Loading</span><Skeleton className="h-7 w-48" /><Skeleton className="h-40 w-full" /></div>
  </div>
);

export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <SessionGate loading={<GateLoading />} failed={(message, retry) => <div className="mx-auto max-w-xl p-10"><ErrorState message={message} onRetry={retry} /></div>}>
      <Shell>{children}</Shell>
    </SessionGate>
  );
}
