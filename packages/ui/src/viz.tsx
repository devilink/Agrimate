'use client';
/**
 * Dashboard pieces, shared by every portal. Plain SVG with no chart library, so that it stays light on a farmer's phone.
 * Colour rules: one accent for single series, a fixed categorical order for identity, status colours only for good/bad,
 * and always a label beside a colour. Every chart can be read as a table.
 */
import * as React from 'react';
import Link from 'next/link';
import { cn } from './index';

export const VIZ = {
  accent: '#047857', accentSoft: '#d1fae5', ink: '#0f172a', inkSoft: '#475569', muted: '#64748b', grid: '#e2e8f0', base: '#cbd5e1',
  good: '#0ca30c', warning: '#fab219', critical: '#d03b3b',
  series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#6250d6', '#e87ba4'],
  heat: ['#eef2f6', '#a7f3d0', '#34d399', '#047857', '#064e3b'],
};

const LAKH = 10_000_000n; // ₹1 lakh in paise
const CRORE = 1_000_000_000n;
/** ₹2.4 Cr, ₹18.6 L, ₹74.5K, in the units Indian businesses read. */
export function compactINR(paise: string | bigint | number): string {
  const p = BigInt(paise);
  const sign = p < 0n ? '-' : '';
  const a = p < 0n ? -p : p;
  const one = (n: bigint, d: bigint) => (Number((n * 10n) / d) / 10).toString();
  if (a >= CRORE) return `${sign}₹${one(a, CRORE)} Cr`;
  if (a >= LAKH) return `${sign}₹${one(a, LAKH)} L`;
  if (a >= 100_000n) return `${sign}₹${one(a, 100_000n)}K`;
  return `${sign}₹${(a / 100n).toString()}`;
}
const compactNumber = (v: number) => (v >= 1000 ? `${Math.round(v / 100) / 10}K` : String(Math.round(v)));

function useWidth(fallback: number) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [w, setW] = React.useState(fallback);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth || fallback);
    const ro = new ResizeObserver(([e]) => { if (e) setW(Math.max(120, e.contentRect.width)); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fallback]);
  return [ref, w] as const;
}

// ---- Layout ---------------------------------------------------------------------------------------------------------
export function VizCard({ title, description, table, action, className, children }: { title: string; description?: string; table?: React.ReactNode; action?: React.ReactNode; className?: string; children: React.ReactNode }) {
  const [asTable, setAsTable] = React.useState(false);
  return (
    <section className={cn('min-w-0 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgb(15_23_42/0.04)]', className)}>
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-slate-900">{title}</h2>
          {description && <p className="mt-0.5 text-[13px] text-slate-500">{description}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {action}
          {table && (
            <button type="button" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable} className="rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800">
              {asTable ? 'Show chart' : 'Show table'}
            </button>
          )}
        </div>
      </header>
      {asTable ? <div className="overflow-x-auto text-sm">{table}</div> : children}
    </section>
  );
}

export function RangeTabs<T extends number>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg bg-slate-200/70 p-0.5">
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)} className={cn('rounded-md px-3 py-1.5 text-xs font-semibold transition-colors', o.value === value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A simple table for the "Show table" view of any chart. */
export function VizTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <table className="w-full text-left">
      <thead><tr className="border-b border-slate-200 text-xs text-slate-500">{head.map((h) => <th key={h} scope="col" className="py-2 pr-4 font-medium">{h}</th>)}</tr></thead>
      <tbody className="divide-y divide-slate-100 tabular-nums text-slate-800">{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="py-1.5 pr-4">{c}</td>)}</tr>)}</tbody>
    </table>
  );
}

// ---- Figures --------------------------------------------------------------------------------------------------------
export function Sparkline({ values, width = 96, height = 30, color = VIZ.accent, trackColor = VIZ.base }: { values: number[]; width?: number; height?: number; color?: string; trackColor?: string }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const x = (i: number) => 3 + (i * (width - 6)) / (values.length - 1);
  const y = (v: number) => height - 4 - (v / max) * (height - 8);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join('');
  return (
    <svg aria-hidden width={width} height={height} className="block">
      <path d={d} fill="none" stroke={trackColor} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1]!)} r={4} fill={color} stroke="white" strokeWidth={2} />
    </svg>
  );
}

export type Tone = 'good' | 'warning' | 'critical' | 'neutral';
const TONE_MARK: Record<Tone, { icon: string; dot: string }> = { good: { icon: '✓', dot: 'bg-emerald-600' }, warning: { icon: '!', dot: 'bg-amber-400' }, critical: { icon: '▲', dot: 'bg-red-600' }, neutral: { icon: '', dot: 'bg-slate-300' } };

export function StatTile({ label, value, note, tone = 'neutral', href, loading, error }: { label: string; value: React.ReactNode; note?: string; tone?: Tone; href?: string; loading?: boolean; error?: string }) {
  const body = (
    <>
      <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
        {tone !== 'neutral' && <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', TONE_MARK[tone].dot)} />}
        <span className="truncate">{label}</span>
      </p>
      {error ? <p role="alert" className="mt-1 text-xs text-red-700">{error}</p> : loading ? <div aria-hidden className="mt-1.5 h-7 w-16 animate-pulse rounded bg-slate-200" /> : <p className={cn('mt-0.5 text-2xl font-semibold tracking-tight', tone === 'critical' ? 'text-red-700' : 'text-slate-900')}>{value}</p>}
      {note && !loading && !error && <p className="mt-0.5 text-xs text-slate-500">{note}</p>}
    </>
  );
  const cls = 'block rounded-xl border border-slate-200/80 bg-white px-4 py-3 transition hover:-translate-y-px hover:border-slate-300 hover:shadow-sm motion-reduce:transform-none';
  return href ? <Link href={href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}

const polar = (cx: number, cy: number, r: number, deg: number) => { const a = (deg * Math.PI) / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const; };
const DIAL_START = 150; const DIAL_SWEEP = 240;

/** A speedometer for one rate against its target. Text carries the verdict too, so colour is never the only signal. */
export function Dial({ label, value, detail, good, warn, href, words = { good: 'On track', warning: 'Watch', critical: 'Act now', none: 'No data yet' }, size = 168 }: {
  label: string; value: number | null; detail?: string; good: number; warn: number; href?: string; words?: { good: string; warning: string; critical: string; none: string }; size?: number;
}) {
  const [shown, setShown] = React.useState(0);
  React.useEffect(() => { const t = requestAnimationFrame(() => setShown(value ?? 0)); return () => cancelAnimationFrame(t); }, [value]);
  const tone: Tone = value === null ? 'neutral' : value >= good ? 'good' : value >= warn ? 'warning' : 'critical';
  const fill = tone === 'good' ? VIZ.good : tone === 'warning' ? VIZ.warning : tone === 'critical' ? VIZ.critical : VIZ.base;
  const track = tone === 'good' ? '#dcfce7' : tone === 'warning' ? '#fef3c7' : tone === 'critical' ? '#fee2e2' : VIZ.grid;
  const cx = 100; const cy = 100; const r = 80;
  const [sx, sy] = polar(cx, cy, r, DIAL_START); const [ex, ey] = polar(cx, cy, r, DIAL_START + DIAL_SWEEP);
  const arc = `M${sx.toFixed(2)} ${sy.toFixed(2)}A${r} ${r} 0 1 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`;
  const targetDeg = DIAL_START + (good / 100) * DIAL_SWEEP;
  const [t1x, t1y] = polar(cx, cy, r - 12, targetDeg); const [t2x, t2y] = polar(cx, cy, r + 12, targetDeg);
  const verdict = tone === 'neutral' ? words.none : words[tone];
  const body = (
    <>
      <svg viewBox="0 0 200 172" width={size} className="mx-auto block" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value ?? undefined} aria-valuetext={value === null ? words.none : `${value}%, ${verdict}`}>
        <path d={arc} fill="none" stroke={track} strokeWidth={14} strokeLinecap="round" />
        {value !== null && <path d={arc} fill="none" stroke={fill} strokeWidth={14} strokeLinecap="round" pathLength={100} strokeDasharray={`${Math.max(shown, 0.01)} 100`} className="transition-[stroke-dasharray] duration-700 ease-out motion-reduce:transition-none" />}
        <line x1={t1x} y1={t1y} x2={t2x} y2={t2y} stroke={VIZ.ink} strokeWidth={2} strokeLinecap="round" />
        {value !== null && (
          <g style={{ transform: `rotate(${DIAL_START + (shown / 100) * DIAL_SWEEP}deg)`, transformOrigin: '100px 100px' }} className="transition-transform duration-700 ease-out motion-reduce:transition-none">
            <line x1={100} y1={100} x2={160} y2={100} stroke={VIZ.ink} strokeWidth={2.5} strokeLinecap="round" />
          </g>
        )}
        <circle cx={cx} cy={cy} r={6} fill={VIZ.ink} stroke="white" strokeWidth={2} />
        <text x={cx} y={146} textAnchor="middle" fontSize={value === null ? 15 : 28} fontWeight={700} fill={VIZ.ink}>{value === null ? '—' : `${Math.round(value)}%`}</text>
      </svg>
      <p className="-mt-1 text-center text-sm font-semibold text-slate-900">{label}</p>
      <p className="mt-0.5 flex items-center justify-center gap-1 text-xs font-medium text-slate-600">
        {TONE_MARK[tone].icon && <span aria-hidden className="font-bold">{TONE_MARK[tone].icon}</span>}{verdict}
      </p>
      {detail && <p className="mt-0.5 text-center text-xs text-slate-500">{detail}</p>}
    </>
  );
  const cls = 'block rounded-2xl border border-slate-200/80 bg-white px-3 pb-4 pt-3 transition hover:border-slate-300 hover:shadow-sm';
  return href ? <Link href={href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}

/** The one number a page leads with, and the few it should be read with. */
export function HeroBand({ eyebrow, value, now, previous, trend, stats }: { eyebrow: string; value: string; now: string; previous: string; trend: number[]; stats: { label: string; value: string }[] }) {
  const [n, p] = [BigInt(now), BigInt(previous)];
  const pct = p > 0n ? Number(((n - p) * 1000n) / p) / 10 : null;
  return (
    <section className="relative overflow-hidden rounded-2xl bg-[linear-gradient(115deg,#0f766e_0%,#064e3b_48%,#022c22_100%)] p-6 text-white">
      <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-5">
        <div>
          <p className="text-sm font-medium text-emerald-100/90">{eyebrow}</p>
          <div className="mt-1 flex items-end gap-5">
            <p className="text-5xl font-semibold tracking-tight">{value}</p>
            <div className="max-sm:hidden"><Sparkline values={trend.length > 45 ? trend.filter((_, i) => i % 7 === 0) : trend} width={150} height={44} color="#6ee7b7" trackColor="rgb(167 243 208 / 0.55)" /></div>
          </div>
          <p className="mt-1.5 text-sm text-emerald-100/90">{pct === null ? 'No earlier period to compare yet' : <><span className="font-semibold text-white">{pct >= 0 ? '▲' : '▼'} {pct >= 1000 ? 'Over 10×' : `${Math.abs(pct)}%`}</span> against the period before</>}</p>
        </div>
        <dl className="grid grow grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4 lg:max-w-3xl">
          {stats.map((x) => <div key={x.label}><dd className="text-2xl font-semibold tracking-tight">{x.value}</dd><dt className="mt-0.5 text-xs text-emerald-100/80">{x.label}</dt></div>)}
        </dl>
      </div>
    </section>
  );
}

// ---- Charts ---------------------------------------------------------------------------------------------------------
function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

export interface Column { key: string; label: string; value: number; display: string; note?: string }
/** Columns over time. The hovered or focused column shows its figures, and arrow keys step through them. */
export function ColumnTrend({ data, axis = compactNumber, height = 220, summary }: { data: Column[]; axis?: (v: number) => string; height?: number; summary: string }) {
  const [ref, width] = useWidth(640);
  const [active, setActive] = React.useState<number | null>(null);
  const left = 58; const right = 8; const top = 18; const bottom = 26;
  const plotW = Math.max(40, width - left - right); const plotH = height - top - bottom;
  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  const y = (v: number) => top + plotH - (v / max) * plotH;
  const step = plotW / Math.max(data.length, 1);
  const barW = Math.min(24, Math.max(3, step - 3));
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(plotW / 68))));
  const a = active !== null ? data[active] : undefined;
  const peak = data.reduce((best, d, i) => (d.value > (data[best]?.value ?? -1) ? i : best), 0);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); setActive((i) => Math.min(data.length - 1, (i ?? -1) + 1)); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); setActive((i) => Math.max(0, (i ?? data.length) - 1)); }
  };
  return (
    <div ref={ref} className="relative">
      <svg width={width} height={height} className="block overflow-visible outline-none focus-visible:ring-2 focus-visible:ring-emerald-700" tabIndex={0} role="img" aria-label={summary} onKeyDown={onKey} onBlur={() => setActive(null)} onPointerLeave={() => setActive(null)}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={left} x2={left + plotW} y1={y(max * f)} y2={y(max * f)} stroke={f === 0 ? VIZ.base : VIZ.grid} />
            <text x={left - 8} y={y(max * f) + 4} textAnchor="end" fontSize={11} fill={VIZ.muted} className="tabular-nums">{axis(max * f)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = left + i * step + (step - barW) / 2;
          const yTop = y(d.value); const h = top + plotH - yTop;
          const r = Math.min(4, barW / 2, h);
          const path = h > 0 ? `M${x} ${top + plotH}V${yTop + r}Q${x} ${yTop} ${x + r} ${yTop}H${x + barW - r}Q${x + barW} ${yTop} ${x + barW} ${yTop + r}V${top + plotH}Z` : '';
          return (
            <g key={d.key} onPointerEnter={() => setActive(i)} onPointerDown={() => setActive(i)}>
              <rect x={left + i * step} y={top} width={step} height={plotH} fill="transparent" />
              {path && <path d={path} fill={VIZ.accent} opacity={active === null || active === i ? 1 : 0.35} className="transition-opacity" />}
              {i % labelEvery === 0 && <text x={left + i * step + step / 2} y={height - 8} textAnchor="middle" fontSize={11} fill={VIZ.muted}>{d.label}</text>}
            </g>
          );
        })}
        {active === null && (data[peak]?.value ?? 0) > 0 && <text x={left + peak * step + step / 2} y={y(data[peak]!.value) - 6} textAnchor={peak > data.length * 0.85 ? 'end' : 'middle'} fontSize={11} fontWeight={600} fill={VIZ.inkSoft}>{data[peak]!.display}</text>}
      </svg>
      {a && active !== null && (
        <div role="status" className="pointer-events-none absolute z-10 w-max max-w-48 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs text-white shadow-lg" style={{ left: Math.min(width - 130, Math.max(0, left + active * step + step / 2 - 60)), top: Math.max(0, y(a.value) - 58) }}>
          <p className="font-semibold">{a.display}</p>
          <p className="text-slate-300">{a.label}{a.note ? ` · ${a.note}` : ''}</p>
        </div>
      )}
    </div>
  );
}

export interface JourneyStage { key: string; label: string; count: number; href?: string; alert?: boolean }
/** Where every live order is right now, in journey order. */
export function Journey({ stages }: { stages: JourneyStage[] }) {
  const max = Math.max(...stages.map((s) => s.count), 1);
  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
      {stages.map((s, i) => {
        const body = (
          <>
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-semibold tracking-tight text-slate-900">{s.count}</span>
              {i < stages.length - 1 && <span aria-hidden className="text-slate-300 max-xl:hidden">→</span>}
            </div>
            <p className="mt-0.5 flex items-center gap-1 truncate text-xs font-medium text-slate-600">{s.alert && s.count > 0 && <span aria-hidden className="font-bold text-red-700">▲</span>}{s.label}</p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: s.alert ? '#fee2e2' : VIZ.accentSoft }}>
              <div className="h-full rounded-full transition-[width] duration-700 motion-reduce:transition-none" style={{ width: `${(s.count / max) * 100}%`, background: s.alert ? VIZ.critical : VIZ.accent }} />
            </div>
          </>
        );
        const cls = 'block rounded-xl bg-slate-50 px-3 py-2.5 transition-colors hover:bg-slate-100';
        return <li key={s.key}>{s.href ? <Link href={s.href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>}</li>;
      })}
    </ol>
  );
}

export interface RankRow { name: string; value: number; display: string; note?: string }
export function RankBars({ rows }: { rows: RankRow[] }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.name} className="group">
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="truncate text-slate-700">{r.name}</span>
            <span className="shrink-0 font-semibold tabular-nums text-slate-900">{r.display}{r.note && <span className="ml-1.5 font-normal text-slate-500">{r.note}</span>}</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-slate-100">
            <div className="h-full rounded-r-full transition-[width,opacity] duration-700 group-hover:opacity-80 motion-reduce:transition-none" style={{ width: `${Math.max(1, (r.value / max) * 100)}%`, background: VIZ.accent }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export interface SplitPart { key: string; label: string; value: number; display: string }
/** One whole split into parts, with each part's share printed on it when it fits. */
export function SplitBar({ parts }: { parts: SplitPart[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (total <= 0) return <p className="text-sm text-slate-500">Nothing to show yet.</p>;
  return (
    <div>
      <div className="flex h-7 gap-0.5" role="img" aria-label={parts.map((p) => `${p.label} ${p.display}`).join(', ')}>
        {parts.filter((p) => p.value > 0).map((p) => {
          const i = parts.indexOf(p); const pct = (p.value / total) * 100;
          return <div key={p.key} title={`${p.label}: ${p.display} (${pct.toFixed(1)}%)`} className="flex items-center rounded px-1.5 text-xs font-semibold" style={{ width: `${pct}%`, background: VIZ.series[i], color: i === 3 ? '#0b0b0b' : '#fff' }}>{pct >= 12 ? `${Math.round(pct)}%` : ''}</div>;
        })}
      </div>
      <ul className="mt-3 space-y-1.5">
        {parts.map((p, i) => (
          <li key={p.key} className="flex items-center justify-between gap-3 text-[13px]">
            <span className="flex min-w-0 items-center gap-2 text-slate-700"><span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: VIZ.series[i] }} /><span className="truncate">{p.label}</span></span>
            <span className="font-semibold tabular-nums text-slate-900">{p.display}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Activity by day, one column per week, darker means more. */
export function CalendarHeat({ days, unit }: { days: { date: string; value: number; display: string }[]; unit: string }) {
  const [hover, setHover] = React.useState<(typeof days)[number] | null>(null);
  const max = Math.max(...days.map((d) => d.value), 0);
  const level = (v: number) => (v <= 0 ? 0 : Math.min(4, Math.ceil((v / (max || 1)) * 4)));
  const first = days[0] ? new Date(`${days[0].date}T00:00:00Z`).getUTCDay() : 0;
  const offset = (first + 6) % 7;
  const cell = days.length <= 40 ? 26 : 15; const gap = 3;
  const weeks = Math.ceil((days.length + offset) / 7);
  return (
    <div>
      <svg width={weeks * (cell + gap)} height={7 * (cell + gap)} className="block max-w-full" role="img" aria-label={`Daily ${unit} for the last ${days.length} days`}>
        {days.map((d, i) => {
          const pos = i + offset;
          return <rect key={d.date} x={Math.floor(pos / 7) * (cell + gap)} y={(pos % 7) * (cell + gap)} width={cell} height={cell} rx={3} fill={VIZ.heat[level(d.value)]} onPointerEnter={() => setHover(d)} onPointerLeave={() => setHover(null)}><title>{`${d.date}: ${d.display}`}</title></rect>;
        })}
      </svg>
      <div className="mt-2 flex h-5 items-center justify-between gap-3 text-xs text-slate-500">
        <span className="truncate">{hover ? `${hover.date}: ${hover.display}` : `Hover a day for ${unit}`}</span>
        <span aria-hidden className="flex shrink-0 items-center gap-1">Less{VIZ.heat.map((c) => <span key={c} className="h-2.5 w-2.5 rounded-sm" style={{ background: c }} />)}More</span>
      </div>
    </div>
  );
}

/** Rolls daily figures up so that a long period stays readable. */
export function bucketTrend<T extends { date: string; gmvPaise: string; orders: number }>(trend: T[], days: number, compact = compactINR): Column[] {
  const size = days >= 365 ? 30 : days >= 90 ? 7 : 1;
  const out: Column[] = [];
  const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  for (let i = trend.length % size; i < trend.length; i += size) {
    const part = trend.slice(i, i + size);
    if (!part.length) continue;
    const paise = part.reduce((s, d) => s + BigInt(d.gmvPaise), 0n);
    const orders = part.reduce((s, d) => s + d.orders, 0);
    out.push({ key: part[0]!.date, label: fmt(part[0]!.date), value: Number(paise) / 100, display: compact(paise), note: `${orders} order${orders === 1 ? '' : 's'}${size > 1 ? `, from ${fmt(part[0]!.date)}` : ''}` });
  }
  return out;
}
/** Rupee axis labels in lakh and crore. */
export const rupeeAxis = (rupees: number) => compactINR(BigInt(Math.round(rupees * 100)));
