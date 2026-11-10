'use client';
/**
 * Session guard and the persistent left nav. Nothing renders until /auth/me confirms a console role (admin, quality
 * verifier or transport manager), and each role is kept to its own pages.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ApiError, type MeView } from '@agrimate/api-client';
import { Button, Skeleton, cn } from '@agrimate/ui';
import { api, goToLogin, tokens } from '@/lib/api';
import { canOpen, HOME, isConsoleRole, NAV, ROLE_LABEL, type ConsoleRole } from '@/lib/roles';
import { ErrorState } from './console';

const MeCtx = createContext<(MeView & { role: ConsoleRole }) | null>(null);

/** The signed-in console user. Only usable inside the console layout. */
export function useMe() {
  const me = useContext(MeCtx);
  if (!me) throw new Error('useMe must be used inside Shell');
  return me;
}

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<(MeView & { role: ConsoleRole }) | null>(null);
  const [error, setError] = useState<unknown>(null);

  const check = useCallback(async () => {
    setError(null);
    if (!(await tokens.getAccess()) && !(await tokens.getRefresh())) { goToLogin(); return; }
    try {
      const u = await api.get<MeView>('/auth/me');
      if (!isConsoleRole(u.role)) {
        await api.logout();
        goToLogin('role');
        return;
      }
      setMe(u as MeView & { role: ConsoleRole });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { await tokens.clear(); goToLogin('expired'); return; }
      // The API being down is not the same as being signed out, so the session stays.
      setError(e);
    }
  }, []);

  useEffect(() => { void check(); }, [check]);

  const allowed = me ? canOpen(me.role, pathname) : false;
  useEffect(() => { if (me && !allowed) router.replace(HOME[me.role]); }, [me, allowed, router]);

  if (error) return <div className="mx-auto mt-16 max-w-xl px-4"><ErrorState title="The console could not start" error={error} onRetry={() => void check()} /></div>;
  if (!me || !allowed) return <div role="status" aria-label="Checking your session" className="mx-auto mt-16 max-w-xl space-y-2 px-4"><Skeleton /><Skeleton /><Skeleton /></div>;

  const nav = NAV[me.role];
  const home = HOME[me.role];

  return (
    <MeCtx.Provider value={me}>
      <div className="flex min-h-screen">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-10 focus:rounded focus:bg-white focus:p-2 focus:text-sm">Skip to content</a>
        <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r border-slate-200 bg-white">
          <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
            <span aria-hidden className="grid h-8 w-8 place-items-center rounded-md bg-emerald-700 text-sm font-bold text-white">A</span>
            <div>
              <p className="text-sm font-semibold text-slate-900">Agrimate</p>
              <p className="text-xs text-slate-500">{ROLE_LABEL[me.role]}</p>
            </div>
          </div>
          <nav aria-label="Main" className="flex-1 overflow-y-auto py-2">
            <ul>
              {nav.map((n) => {
                const active = n.href === home ? pathname === home : pathname === n.href || pathname.startsWith(`${n.href}/`);
                return (
                  <li key={n.href}>
                    <Link href={n.href} aria-current={active ? 'page' : undefined} className={cn('block border-l-2 px-4 py-1.5 text-sm', active ? 'border-emerald-700 bg-slate-50 font-medium text-slate-900' : 'border-transparent text-slate-700 hover:bg-slate-50')}>{n.label}</Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="border-t border-slate-200 p-3">
            <p className="truncate text-xs text-slate-600" title={me.email ?? undefined}>{me.name}</p>
            <Button variant="secondary" size="sm" className="mt-2 w-full" onClick={async () => { await api.logout(); goToLogin(); }}>Sign out</Button>
          </div>
        </aside>
        <main id="main" className="min-w-0 flex-1 px-6 py-5">{children}</main>
      </div>
    </MeCtx.Provider>
  );
}
