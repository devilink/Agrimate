'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { currentUserId, isSignedIn } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { flushQueue, useQueue } from '@/lib/queue';
import { HomeIcon, ListIcon, OfflineIcon, SproutIcon, TruckIcon, UserIcon, WalletIcon } from './icons';
import { LanguageSwitcher } from './language-switcher';
import { cn } from './ui';

const NAV = [
  { href: '/', key: 'nav.home', icon: HomeIcon },
  { href: '/listings', key: 'nav.sell', icon: SproutIcon },
  { href: '/rfqs', key: 'nav.requests', icon: ListIcon },
  { href: '/orders', key: 'nav.orders', icon: TruckIcon },
  { href: '/ledger', key: 'nav.money', icon: WalletIcon },
];

export function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  return online;
}

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const online = useOnline();
  const queue = useQueue();
  const [ready, setReady] = useState(false);
  const owner = ready ? currentUserId() : undefined;
  const waiting = queue.filter((q) => q.status === 'PENDING' && q.kind !== 'LANGUAGE' && q.ownerId === owner).length;

  useEffect(() => {
    if (isSignedIn()) setReady(true);
    else router.replace('/login');
  }, [router]);

  // The outbox retries on reconnect, at start-up, and every 30 s in case the online event never fired.
  useEffect(() => {
    if (!owner) return;
    const flush = () => void flushQueue(owner);
    flush();
    window.addEventListener('online', flush);
    const timer = setInterval(flush, 30_000);
    return () => { window.removeEventListener('online', flush); clearInterval(timer); };
  }, [owner]);

  if (!ready) return null;
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col">
      <header className="sticky top-0 z-20 flex items-center justify-between gap-2 border-b-2 border-slate-300 bg-white px-3 py-2">
        <Link prefetch={false} href="/" className="flex min-h-12 items-center gap-2 text-xl font-extrabold text-emerald-900"><SproutIcon size={28} />{t('app.name')}</Link>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <Link prefetch={false} href="/account" aria-label={t('nav.account')} className="flex h-12 w-12 items-center justify-center rounded-lg border-2 border-slate-800 text-slate-950"><UserIcon size={24} /></Link>
        </div>
      </header>
      {!online && <div role="status" className="flex items-center gap-2 bg-slate-900 px-3 py-2 font-bold text-white"><OfflineIcon size={24} className="shrink-0" />{t('offline.banner')}</div>}
      {waiting > 0 && <div role="status" className="bg-amber-200 px-3 py-2 font-bold text-amber-950">{t('offline.waiting', { n: waiting })}</div>}
      <main className="flex-1 px-3 pb-28 pt-4">{children}</main>
      <nav aria-label={t('nav.label')} className="fixed inset-x-0 bottom-0 z-20 border-t-2 border-slate-300 bg-white pb-[env(safe-area-inset-bottom)]">
        <ul className="mx-auto grid max-w-xl grid-cols-5">
          {NAV.map(({ href, key, icon: Icon }) => {
            const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
            return (
              <li key={href}>
                <Link prefetch={false} href={href} aria-current={active ? 'page' : undefined} className={cn('flex min-h-16 flex-col items-center justify-center gap-0.5 px-0.5 py-1 text-center text-[0.8rem] font-bold leading-tight', active ? 'bg-emerald-800 text-white' : 'text-slate-900 active:bg-slate-100')}>
                  <Icon size={26} /><span>{t(key)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
