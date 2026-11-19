'use client';
/**
 * Shared shadcn-style primitives for the Next.js portals. Plain Tailwind, no runtime theme.
 * Each portal scans this file for classes with `@source "../../../../packages/ui/src";` in its globals.css.
 */
import * as React from 'react';
import { formatINR } from '@agrimate/shared';

export const cn = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

const BTN: Record<string, string> = {
  primary: 'bg-emerald-700 text-white hover:bg-emerald-800 disabled:bg-emerald-300',
  secondary: 'bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 disabled:text-slate-400',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300',
  ghost: 'text-slate-700 hover:bg-slate-100',
};
export function Button({ variant = 'primary', size = 'md', className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof BTN | string; size?: 'sm' | 'md' | 'lg' }) {
  const sz = size === 'sm' ? 'h-8 px-3 text-sm' : size === 'lg' ? 'h-14 px-6 text-lg' : 'h-10 px-4 text-sm';
  return <button {...p} className={cn('inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed', BTN[variant], sz, className)} />;
}
export const Card = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div {...p} className={cn('rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgb(15_23_42/0.04)]', className)} />;
export const CardTitle = ({ className, ...p }: React.HTMLAttributes<HTMLHeadingElement>) => <h2 {...p} className={cn('mb-3 text-base font-semibold text-slate-900', className)} />;
const FIELD = 'h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-700 focus:outline-none focus:ring-1 focus:ring-emerald-700 disabled:bg-slate-100';
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, r) => <input ref={r} {...p} className={cn(FIELD, className)} />);
Input.displayName = 'Input';
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...p }, r) => <select ref={r} {...p} className={cn(FIELD, className)} />);
Select.displayName = 'Select';
export const Textarea = ({ className, ...p }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={cn(FIELD, 'h-24 py-2', className)} />;
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && !error && <span className="block text-xs text-slate-500">{hint}</span>}
      {error && <span role="alert" className="block text-xs text-red-700">{error}</span>}
    </label>
  );
}
const TONES: Record<string, string> = { green: 'bg-emerald-100 text-emerald-800', amber: 'bg-amber-100 text-amber-900', red: 'bg-red-100 text-red-800', blue: 'bg-sky-100 text-sky-800', slate: 'bg-slate-100 text-slate-700' };
export const Badge = ({ tone = 'slate', className, ...p }: React.HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof TONES | string }) => <span {...p} className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', TONES[tone], className)} />;

const STATE_TONE: Record<string, string> = {
  SETTLED: 'green', INSPECTED: 'green', SELF_CERTIFIED: 'amber', FULLY_FUNDED: 'green', VERIFIED: 'green', PROCESSED: 'green', PAID: 'green', DELIVERED: 'blue', IN_TRANSIT: 'blue', DISPUTE_WINDOW: 'blue',
  DISPUTED: 'red', FARMER_DEFAULTED: 'red', BUYER_DEFAULTED: 'red', REFUNDED: 'slate', CANCELLED: 'slate', REJECTED: 'red', FAILED: 'red', BLOCKED: 'red', MANUAL_REVIEW: 'amber', PENDING: 'amber', PARTIAL: 'amber',
};
export const humanise = (s: string) => s.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
export const StateBadge = ({ state }: { state: string }) => <Badge tone={STATE_TONE[state] ?? 'slate'}>{humanise(state)}</Badge>;
export const Money = ({ paise, className }: { paise: string | bigint | number | null | undefined; className?: string }) => <span className={cn('tabular-nums', className)}>{paise === null || paise === undefined ? '—' : formatINR(paise)}</span>;
export const Alert = ({ tone = 'amber', className, ...p }: React.HTMLAttributes<HTMLDivElement> & { tone?: 'amber' | 'red' | 'green' | 'blue' }) => {
  const t = { amber: 'border-amber-300 bg-amber-50 text-amber-900', red: 'border-red-300 bg-red-50 text-red-800', green: 'border-emerald-300 bg-emerald-50 text-emerald-900', blue: 'border-sky-300 bg-sky-50 text-sky-900' }[tone];
  return <div role="status" {...p} className={cn('rounded-md border p-3 text-sm', t, className)} />;
};
export const Skeleton = ({ className }: { className?: string }) => <div aria-hidden className={cn('animate-pulse rounded bg-slate-200', className ?? 'h-5 w-full')} />;
export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed border-slate-300 p-10 text-center"><p className="font-medium text-slate-800">{title}</p>{children && <div className="mt-2 text-sm text-slate-600">{children}</div>}</div>;
}
export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [done, setDone] = React.useState(false);
  return <Button type="button" variant="secondary" size="sm" onClick={async () => { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); }}>{done ? 'Copied' : label}</Button>;
}
/** Live countdown to an SLA deadline; turns amber inside 24 h and red inside 6 h. */
export function Countdown({ to, className }: { to: string | null | undefined; className?: string }) {
  const [now, setNow] = React.useState<number | null>(null);
  React.useEffect(() => { setNow(Date.now()); const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  if (!to || now === null) return <span className={className}>—</span>;
  const ms = new Date(to).getTime() - now;
  if (ms <= 0) return <span className={cn('font-medium text-red-700', className)}>Overdue</span>;
  const h = Math.floor(ms / 3_600_000); const m = Math.floor((ms % 3_600_000) / 60_000);
  return <span className={cn('tabular-nums font-medium', ms < 6 * 3_600_000 ? 'text-red-700' : ms < 24 * 3_600_000 ? 'text-amber-700' : 'text-slate-800', className)}>{h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h ${m}m`}</span>;
}
export function Table({ head, children, className }: { head: React.ReactNode[]; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-x-auto rounded-xl border border-slate-200/80 bg-white', className)}>
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-600"><tr>{head.map((h, i) => <th key={i} scope="col" className="px-4 py-2.5 font-medium">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}
export const Td = ({ className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) => <td {...p} className={cn('px-4 py-2.5 align-middle text-slate-800', className)} />;
