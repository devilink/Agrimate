'use client';
/**
 * Farmer-app primitives on top of @agrimate/ui. The shared kit is sized for desktop portals (40px controls, small text);
 * here every control is at least 56px tall and text is large and high-contrast, for outdoor use on small phones.
 */
import { Money, Skeleton, cn } from '@agrimate/ui';
import Link from 'next/link';
import { useEffect, useState, type ComponentType, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { useI18n } from '@/lib/i18n';
import { errorText } from '@/lib/errors';
import { AlertIcon, BackIcon, CheckIcon, ClockIcon, InfoIcon } from './icons';

export { Money, cn };
type IconT = ComponentType<{ size?: number; className?: string }>;

const BUTTON = 'flex min-h-14 w-full items-center justify-center gap-3 rounded-xl px-4 py-3 text-center text-lg font-bold focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed disabled:opacity-60';
const VARIANT = {
  primary: 'bg-emerald-800 text-white active:bg-emerald-900',
  secondary: 'border-2 border-slate-800 bg-white text-slate-900 active:bg-slate-100',
  danger: 'bg-red-700 text-white active:bg-red-800',
};
type Variant = keyof typeof VARIANT;

export function BigButton({ icon: Icon, variant = 'primary', className, children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: IconT; variant?: Variant }) {
  return <button type="button" {...p} className={cn(BUTTON, VARIANT[variant], className)}>{Icon && <Icon size={26} />}<span>{children}</span></button>;
}
export function BigLink({ icon: Icon, variant = 'primary', className, href, children }: { icon?: IconT; variant?: Variant; className?: string; href: string; children: ReactNode }) {
  return <Link prefetch={false} href={href} className={cn(BUTTON, VARIANT[variant], className)}>{Icon && <Icon size={26} />}<span>{children}</span></Link>;
}

export function PageTitle({ children, back }: { children: ReactNode; back?: string }) {
  const { t } = useI18n();
  return (
    <div className="mb-4 flex items-center gap-1">
      {back && <Link prefetch={false} href={back} aria-label={t('common.back')} className="-ml-2 flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-slate-900 active:bg-slate-100"><BackIcon /></Link>}
      <h1 className="text-2xl font-bold text-slate-950">{children}</h1>
    </div>
  );
}
export const Panel = ({ className, children }: { className?: string; children: ReactNode }) => <section className={cn('rounded-xl border-2 border-slate-300 bg-white p-4', className)}>{children}</section>;
export const SectionTitle = ({ children }: { children: ReactNode }) => <h2 className="mb-2 text-lg font-bold text-slate-950">{children}</h2>;

const TONES = {
  info: { box: 'border-sky-800 bg-sky-50 text-sky-950', icon: InfoIcon },
  warn: { box: 'border-amber-700 bg-amber-50 text-amber-950', icon: AlertIcon },
  error: { box: 'border-red-700 bg-red-50 text-red-950', icon: AlertIcon },
  success: { box: 'border-emerald-800 bg-emerald-50 text-emerald-950', icon: CheckIcon },
  wait: { box: 'border-slate-500 bg-slate-100 text-slate-950', icon: ClockIcon },
};
export function Notice({ tone = 'info', title, children, className }: { tone?: keyof typeof TONES; title?: ReactNode; children?: ReactNode; className?: string }) {
  const { box, icon: Icon } = TONES[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cn('flex gap-3 rounded-xl border-2 p-3', box, className)}>
      <Icon size={28} className="shrink-0" />
      <div className="min-w-0 flex-1">{title && <p className="font-bold">{title}</p>}{children && <div>{children}</div>}</div>
    </div>
  );
}
export function ErrorNotice({ error, className }: { error: unknown; className?: string }) {
  const { t, has } = useI18n();
  if (!error) return null;
  return <Notice tone="error" className={className}>{errorText(error, t, has)}</Notice>;
}

const CONTROL = 'block min-h-14 w-full rounded-xl border-2 border-slate-700 bg-white px-3 text-xl text-slate-950 placeholder:text-slate-500 focus:border-emerald-800 focus:outline-3 focus:outline-emerald-800/40 disabled:bg-slate-200 disabled:text-slate-700';
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block font-bold text-slate-950">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-slate-700">{hint}</span>}
      {error && <span role="alert" className="mt-1 block font-bold text-red-800">{error}</span>}
    </label>
  );
}
export const TextInput = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cn(CONTROL, className)} />;
export const SelectInput = ({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cn(CONTROL, className)}>{children}</select>;

export function Row({ label, children, strong }: { label: ReactNode; children: ReactNode; strong?: boolean }) {
  return <div className={cn('flex items-baseline justify-between gap-4 py-1.5', strong && 'border-t-2 border-slate-800 pt-2 text-lg font-bold')}><span className={strong ? 'text-slate-950' : 'text-slate-800'}>{label}</span><span className="shrink-0 text-right font-semibold tabular-nums text-slate-950">{children}</span></div>;
}

const PILL = { green: 'bg-emerald-800 text-white', amber: 'bg-amber-300 text-amber-950', red: 'bg-red-700 text-white', slate: 'bg-slate-200 text-slate-900', blue: 'bg-sky-800 text-white' };
export const Pill = ({ tone = 'slate', children }: { tone?: keyof typeof PILL; children: ReactNode }) => <span className={cn('inline-block rounded-full px-3 py-0.5 text-[0.9rem] font-bold', PILL[tone])}>{children}</span>;

const STATE_TONE: Record<string, keyof typeof PILL> = {
  SETTLED: 'green', INSPECTED: 'green', SELF_CERTIFIED: 'green', FULLY_FUNDED: 'green', INSPECTION_SCHEDULED: 'green', ADVANCE_LOCKED: 'green', LOGISTICS_PENDING: 'green', LOGISTICS_SECURED: 'green', AWAITING_BALANCE: 'green',
  IN_TRANSIT: 'blue', DELIVERED: 'blue', DISPUTE_WINDOW: 'blue', MATCHED: 'amber', AWAITING_ADVANCE: 'amber', RESOLVED: 'amber',
  DISPUTED: 'red', FARMER_DEFAULTED: 'red', BUYER_DEFAULTED: 'red', REFUNDED: 'slate', CANCELLED: 'slate',
};
export function OrderStatePill({ state }: { state: string }) {
  const { t, has } = useI18n();
  return <Pill tone={STATE_TONE[state] ?? 'slate'}>{has(`state.${state}`) ? t(`state.${state}`) : state}</Pill>;
}

/** The shared Countdown is desktop-sized English ("3d 4h"); this one is large and translated. */
export function BigCountdown({ to }: { to: string | null | undefined }) {
  const { t } = useI18n();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(i); }, []);
  if (!to) return null;
  const ms = new Date(to).getTime() - now;
  if (ms <= 0) return <p className="flex items-center gap-2 text-2xl font-bold text-red-800"><ClockIcon />{t('countdown.overdue')}</p>;
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const text = hours >= 24 ? t('countdown.daysHours', { d: Math.floor(hours / 24), h: hours % 24 }) : t('countdown.hoursMinutes', { h: hours, m: minutes });
  return (
    <div className={cn('flex items-center gap-2', ms < 6 * 3_600_000 ? 'text-red-800' : ms < 24 * 3_600_000 ? 'text-amber-800' : 'text-slate-950')}>
      <ClockIcon size={34} />
      <div><p className="text-3xl font-extrabold leading-tight tabular-nums">{text}</p><p className="font-semibold text-slate-800">{t('countdown.left')}</p></div>
    </div>
  );
}

export const ListSkeleton = ({ rows = 3 }: { rows?: number }) => <div className="space-y-4" aria-busy="true">{Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-32 w-full rounded-xl" />)}</div>;

export function ProgressBar({ fraction, label }: { fraction: number; label?: string }) {
  const pct = Math.round(fraction * 100);
  return (
    <div>
      {label && <p className="mb-1 font-bold">{label} {pct}%</p>}
      <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} className="h-4 w-full overflow-hidden rounded-full bg-slate-300"><div className="h-full bg-emerald-800 transition-[width]" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}
