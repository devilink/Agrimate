'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { signOut } from '@/app/actions/auth';
import { Avatar, Badge, Logo, cx } from '@/components/ui';
import {
  IconClipboardCheck, IconClock, IconDashboard, IconHandshake, IconLogOut, IconMenu, IconPackage, IconPlusCircle, IconRupee,
  IconScale, IconSliders, IconSprout, IconStore, IconTruck, IconUser, IconUsers, IconWallet, IconX,
} from '@/components/icons';

const ICONS = {
  dashboard: IconDashboard, market: IconStore, orders: IconPackage, jobs: IconTruck, parties: IconUsers,
  'new-order': IconPlusCircle, settings: IconSliders, account: IconUser, listings: IconSprout, requirements: IconClipboardCheck,
  prices: IconScale, overview: IconRupee, offers: IconHandshake, payments: IconWallet, activity: IconClock,
} as const;
export type NavIcon = keyof typeof ICONS;
export interface NavLink { href: string; label: string; icon: NavIcon }
export interface NavGroup { label?: string; links: NavLink[] }

const POST_DETAIL = /^\/(listings|requirements)\/[0-9a-f-]{36}$/i;

function isActive(path: string, href: string) {
  if (href === '/dashboard' || href === '/admin') return path === href;
  // Listing and requirement pages belong to the market; the index and "new" pages to My listings / requirements.
  if (href === '/market') return path === '/market' || POST_DETAIL.test(path);
  if (href === '/listings' || href === '/requirements') return path === href || path === `${href}/new`;
  // "/orders" should also light up for "/orders/abc", but "/admin/orders/new" is its own entry.
  return path === href || path.startsWith(`${href}/`);
}

function NavList({ groups, path }: { groups: NavGroup[]; path: string }) {
  return (
    <div className="space-y-6">
      {groups.map((g, i) => (
        <div key={g.label ?? i}>
          {g.label && <div className="mb-2 px-3 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-brand-200/60">{g.label}</div>}
          <ul className="space-y-0.5">
            {g.links.map((l) => {
              const Icon = ICONS[l.icon];
              const active = isActive(path, l.href);
              return (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    aria-current={active ? 'page' : undefined}
                    className={cx(
                      'group flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
                      active ? 'bg-white/10 text-white' : 'text-brand-100/80 hover:bg-white/5 hover:text-white',
                    )}
                  >
                    <Icon className={cx('size-[18px]', active ? 'text-harvest-300' : 'text-brand-300/70 group-hover:text-brand-200')} />
                    {l.label}
                    {active && <span className="ml-auto size-1.5 rounded-full bg-harvest-300" />}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function UserCard({ name, email, role }: { name: string; email: string; role: string }) {
  return (
    <div className="rounded-2xl bg-white/5 p-3 ring-1 ring-white/10">
      <div className="flex items-center gap-3">
        <Avatar name={name} className="bg-harvest-300 text-brand-950 ring-brand-900" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-white">{name}</div>
          <div className="truncate text-xs text-brand-200/70">{email}</div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <Badge tone={role === 'admin' ? 'amber' : 'green'}>{role}</Badge>
        <form action={signOut}>
          <button className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-brand-100/80 hover:bg-white/10 hover:text-white">
            <IconLogOut className="size-3.5" /> Sign out
          </button>
        </form>
      </div>
    </div>
  );
}

export function AppNav({ groups, name, email, role }: { groups: NavGroup[]; name: string; email: string; role: string }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [open]);

  const panel = (
    <div className="bg-furrows flex h-full flex-col bg-brand-900 px-4 py-5">
      <div className="mb-8 px-2"><Logo href="/dashboard" light /></div>
      <nav aria-label="Main" className="flex-1 overflow-y-auto"><NavList groups={groups} path={path} /></nav>
      <div className="mt-6"><UserCard name={name} email={email} role={role} /></div>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">{panel}</aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-stone-200/80 bg-canvas/85 px-4 py-3 backdrop-blur-md lg:hidden">
        <Logo href="/dashboard" />
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          aria-expanded={open}
          aria-controls="mobile-nav"
          className="grid size-10 place-items-center rounded-xl text-stone-700 hover:bg-stone-200/60"
        >
          <IconMenu />
        </button>
      </header>

      {/* Mobile drawer */}
      <div id="mobile-nav" className={cx('fixed inset-0 z-40 lg:hidden', open ? '' : 'pointer-events-none')} inert={!open}>
        <div
          onClick={() => setOpen(false)}
          className={cx('absolute inset-0 bg-stone-950/40 backdrop-blur-sm transition-opacity', open ? 'opacity-100' : 'opacity-0')}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          className={cx('absolute inset-y-0 left-0 w-72 max-w-[85vw] shadow-2xl transition-transform duration-200', open ? 'translate-x-0' : '-translate-x-full')}
        >
          {open && (
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close menu"
              className="absolute right-3 top-4 z-10 grid size-9 place-items-center rounded-lg text-brand-100 hover:bg-white/10"
            >
              <IconX />
            </button>
          )}
          {panel}
        </div>
      </div>
    </>
  );
}
