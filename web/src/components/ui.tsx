import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { IconAlert, IconCheckCircle, IconInbox, IconInfo, LogoMark } from '@/components/icons';

// Shared, stateless building blocks. Imported by client components too, so nothing here may be async or server-only.

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}

export function Logo({ href = '/', light = false, className }: { href?: string; light?: boolean; className?: string }) {
  return (
    <Link href={href} className={cx('inline-flex items-center gap-2.5', className)} aria-label="Agrimate home">
      <LogoMark className="size-8 shrink-0" />
      <span className={cx('font-display text-xl font-semibold tracking-tight', light ? 'text-white' : 'text-brand-900')}>Agrimate</span>
    </Link>
  );
}

export function PageHeader({ title, subtitle, action, eyebrow, back }: {
  title: ReactNode; subtitle?: ReactNode; action?: ReactNode; eyebrow?: ReactNode; back?: { href: string; label: string };
}) {
  return (
    <div className="mb-8 animate-fade-in">
      {back && (
        <Link href={back.href} className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-stone-500 hover:text-brand-700">
          <span aria-hidden="true">←</span> {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          {eyebrow && <div className="mb-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-brand-600">{eyebrow}</div>}
          <h1 className="font-display text-[1.75rem] font-semibold leading-tight tracking-tight text-stone-900 sm:text-3xl">{title}</h1>
          {subtitle && <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-stone-600">{subtitle}</div>}
        </div>
        {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
      </div>
    </div>
  );
}

export function Card({ title, children, className, action, icon, description, padded = true }: {
  title?: ReactNode; children: ReactNode; className?: string; action?: ReactNode; icon?: ReactNode; description?: ReactNode; padded?: boolean;
}) {
  return (
    <section className={cx('rounded-2xl border border-stone-200/80 bg-white shadow-card', padded && 'p-5 sm:p-6', className)}>
      {(title || action) && (
        <div className={cx('mb-5 flex items-start justify-between gap-3', !padded && 'px-5 pt-5 sm:px-6 sm:pt-6')}>
          <div className="flex min-w-0 items-start gap-3">
            {icon && <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700 [&>svg]:size-[18px]">{icon}</span>}
            <div className="min-w-0">
              {title && <h2 className="text-[0.95rem] font-semibold text-stone-900">{title}</h2>}
              {description && <p className="mt-0.5 text-sm text-stone-500">{description}</p>}
            </div>
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

const btn = {
  primary: 'bg-brand-700 text-white shadow-sm shadow-brand-900/10 hover:bg-brand-800 active:bg-brand-900',
  secondary: 'border border-stone-300 bg-white text-stone-800 shadow-sm hover:border-stone-400 hover:bg-stone-50',
  danger: 'bg-rose-600 text-white shadow-sm hover:bg-rose-700',
  ghost: 'text-stone-700 hover:bg-stone-100 hover:text-stone-900',
  accent: 'bg-harvest-400 text-brand-950 shadow-sm hover:bg-harvest-300',
} as const;
export type ButtonVariant = keyof typeof btn;

export function buttonClass(variant: ButtonVariant = 'primary', small = false) {
  return cx(
    'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-xl font-semibold transition-all duration-150',
    'disabled:cursor-not-allowed disabled:opacity-60 [&>svg]:size-4',
    small ? 'h-8 px-3 text-[0.8125rem]' : 'h-10 px-4 text-sm',
    btn[variant],
  );
}

export function ButtonLink({ href, children, variant = 'primary', small, className }: {
  href: string; children: ReactNode; variant?: ButtonVariant; small?: boolean; className?: string;
}) {
  return <Link href={href} className={cx(buttonClass(variant, small), className)}>{children}</Link>;
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1.5 block text-[0.8125rem] font-medium text-stone-700">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs leading-relaxed text-stone-500">{hint}</span>}
    </label>
  );
}

const inputBase = cx(
  'block w-full rounded-xl border border-stone-300 bg-white px-3.5 py-2.5 text-sm text-stone-900 shadow-sm transition-colors',
  'placeholder:text-stone-400 hover:border-stone-400',
  'focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-600/15',
  'disabled:cursor-not-allowed disabled:bg-stone-50 disabled:text-stone-500',
);

export function Input(props: ComponentProps<'input'>) {
  return <input {...props} className={cx(inputBase, props.type === 'file' && 'py-2', props.className)} />;
}
export function Select(props: ComponentProps<'select'>) {
  return (
    <select
      {...props}
      className={cx(
        inputBase,
        'select-chevron appearance-none pr-10',
        props.className,
      )}
    />
  );
}
export function Textarea(props: ComponentProps<'textarea'>) {
  return <textarea rows={3} {...props} className={cx(inputBase, 'resize-y', props.className)} />;
}

export function Checkbox({ label, hint, ...props }: ComponentProps<'input'> & { label: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-stone-200 bg-stone-50/60 px-3.5 py-3 text-sm transition-colors hover:border-stone-300 has-[:checked]:border-brand-300 has-[:checked]:bg-brand-50/60">
      <input type="checkbox" {...props} className="mt-0.5 size-4 shrink-0 rounded" />
      <span>
        <span className="font-medium text-stone-800">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-stone-500">{hint}</span>}
      </span>
    </label>
  );
}

const tones = {
  green: 'bg-brand-50 text-brand-800 ring-brand-600/20',
  amber: 'bg-harvest-50 text-harvest-700 ring-harvest-500/25',
  red: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  blue: 'bg-sky-50 text-sky-800 ring-sky-600/20',
  violet: 'bg-violet-50 text-violet-800 ring-violet-600/20',
  gray: 'bg-stone-100 text-stone-700 ring-stone-500/15',
} as const;
export type Tone = keyof typeof tones;

const dots: Record<Tone, string> = {
  green: 'bg-brand-500', amber: 'bg-harvest-500', red: 'bg-rose-500', blue: 'bg-sky-500', violet: 'bg-violet-500', gray: 'bg-stone-400',
};

export function Badge({ children, tone = 'gray', dot = false }: { children: ReactNode; tone?: Tone; dot?: boolean }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset', tones[tone])}>
      {dot && <span className={cx('size-1.5 rounded-full', dots[tone])} />}
      <span className="inline-block first-letter:uppercase">{children}</span>
    </span>
  );
}

export function statusTone(status: string): Tone {
  if (['completed', 'open', 'accepted', 'confirmed_payment', 'pass'].includes(status)) return 'green';
  if (['disputed', 'cancelled', 'rejected', 'fail', 'void'].includes(status)) return 'red';
  if (['in_transit', 'delivered'].includes(status)) return 'blue';
  if (status === 'ready') return 'violet';
  if (['quality_check', 'pending'].includes(status)) return 'amber';
  return 'gray';
}

export function Empty({ children, icon, action }: { children: ReactNode; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-stone-300 bg-stone-50/50 px-6 py-10 text-center">
      <span className="mb-3 grid size-11 place-items-center rounded-full bg-white text-stone-400 shadow-card ring-1 ring-stone-200 [&>svg]:size-5">
        {icon ?? <IconInbox />}
      </span>
      <div className="max-w-sm text-sm text-stone-600">{children}</div>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="-mx-5 overflow-x-auto sm:-mx-6">
      <table className="min-w-full text-left text-sm">
        <thead>
          <tr className="border-y border-stone-100 bg-stone-50/70">
            {head.map((h, i) => (
              <th key={h || i} className="whitespace-nowrap px-3 py-2.5 text-[0.7rem] font-semibold uppercase tracking-wider text-stone-500 first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100 [&>tr]:transition-colors [&>tr:hover]:bg-stone-50/60">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cx('whitespace-nowrap px-3 py-3 text-stone-700 first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6', className)}>{children}</td>;
}

const noticeTones = {
  amber: { box: 'border-harvest-200 bg-harvest-50 text-harvest-700', icon: <IconAlert /> },
  blue: { box: 'border-sky-200 bg-sky-50 text-sky-900', icon: <IconInfo /> },
  green: { box: 'border-brand-200 bg-brand-50 text-brand-900', icon: <IconCheckCircle /> },
  red: { box: 'border-rose-200 bg-rose-50 text-rose-800', icon: <IconAlert /> },
} as const;

export function Notice({ children, tone = 'amber', className }: { children: ReactNode; tone?: keyof typeof noticeTones; className?: string }) {
  const t = noticeTones[tone];
  return (
    <div className={cx('mb-6 flex gap-3 rounded-xl border px-4 py-3 text-sm leading-relaxed', t.box, className)}>
      <span className="mt-0.5 shrink-0 [&>svg]:size-[18px]">{t.icon}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Inline result of a form submission. */
export function FormMessage({ error, ok }: { error?: string; ok?: string }) {
  if (error) {
    return (
      <p role="alert" className="flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 animate-fade-in">
        <IconAlert className="mt-0.5 size-4 shrink-0" />{error}
      </p>
    );
  }
  if (ok) {
    return (
      <p role="status" className="flex items-start gap-2 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800 animate-fade-in">
        <IconCheckCircle className="mt-0.5 size-4 shrink-0" />{ok}
      </p>
    );
  }
  return null;
}

export function Dl({ items, cols = 2 }: { items: [string, ReactNode][]; cols?: 2 | 3 }) {
  return (
    <dl className={cx('grid grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-2', cols === 3 && 'lg:grid-cols-3')}>
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs font-medium text-stone-500">{k}</dt>
          <dd className="mt-1 break-words font-medium text-stone-900">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function StatCard({ label, value, href, icon, tone = 'green', hint }: {
  label: string; value: ReactNode; href?: string; icon?: ReactNode; tone?: 'green' | 'amber' | 'red' | 'blue'; hint?: string;
}) {
  const iconTone = { green: 'bg-brand-50 text-brand-700', amber: 'bg-harvest-50 text-harvest-600', red: 'bg-rose-50 text-rose-600', blue: 'bg-sky-50 text-sky-700' }[tone];
  const body = (
    <div className={cx('group h-full rounded-2xl border border-stone-200/80 bg-white p-5 shadow-card transition-all', href && 'hover:-translate-y-0.5 hover:border-stone-300 hover:shadow-lift')}>
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm font-medium text-stone-600">{label}</div>
        {icon && <span className={cx('grid size-9 place-items-center rounded-xl [&>svg]:size-[18px]', iconTone)}>{icon}</span>}
      </div>
      <div className="mt-3 font-display text-3xl font-semibold tabular-nums tracking-tight text-stone-900">{value}</div>
      {(hint || href) && (
        <div className="mt-1 text-xs text-stone-500">
          {hint}{href && <span className="ml-1 inline-block text-brand-700 opacity-0 transition-opacity group-hover:opacity-100">View →</span>}
        </div>
      )}
    </div>
  );
  return href ? <Link href={href} className="block h-full">{body}</Link> : body;
}

/** Link-based filter pills (work without JavaScript, keep state in the URL). */
export function FilterPills({ items, label }: { items: { href: string; label: ReactNode; active: boolean }[]; label: string }) {
  return (
    <nav aria-label={label} className="scrollbar-none -mx-4 mb-6 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
      {items.map((it) => (
        <Link
          key={it.href}
          href={it.href}
          aria-current={it.active ? 'page' : undefined}
          className={cx(
            'shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors',
            it.active ? 'border-brand-700 bg-brand-700 text-white shadow-sm' : 'border-stone-200 bg-white text-stone-700 hover:border-stone-300 hover:bg-stone-50',
          )}
        >
          {it.label}
        </Link>
      ))}
    </nav>
  );
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';
  return (
    <span className={cx('grid size-9 shrink-0 place-items-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800 ring-2 ring-white', className)}>
      {initials}
    </span>
  );
}

export function Divider({ className }: { className?: string }) {
  return <div className={cx('my-5 border-t border-stone-100', className)} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-shimmer rounded-lg bg-stone-200/70', className)} />;
}
