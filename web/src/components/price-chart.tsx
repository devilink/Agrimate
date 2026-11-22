import { dateIN } from '@/lib/money';

export interface PricePoint { date: string; modal: number; min: number | null; max: number | null }

const W = 640, H = 200, PAD_L = 52, PAD_R = 12, PAD_T = 12, PAD_B = 26;
const num = new Intl.NumberFormat('en-IN');

/**
 * Server-rendered trend of reference prices (₹/quintal): the modal line over a min–max band. Plain SVG, so it needs
 * no chart library and no JavaScript. Points are averaged per day by the caller.
 */
export function PriceChart({ points, label }: { points: PricePoint[]; label: string }) {
  if (points.length < 2) {
    return <p className="rounded-xl bg-stone-50 px-4 py-6 text-center text-sm text-stone-500">Not enough price history for a chart yet.</p>;
  }
  const t = points.map((p) => Date.parse(p.date));
  const t0 = Math.min(...t), t1 = Math.max(...t);
  const lows = points.map((p) => p.min ?? p.modal), highs = points.map((p) => p.max ?? p.modal);
  let lo = Math.min(...lows), hi = Math.max(...highs);
  const padY = Math.max((hi - lo) * 0.1, hi * 0.01, 1);
  lo = Math.max(0, lo - padY); hi += padY;

  const x = (ms: number) => PAD_L + ((ms - t0) / Math.max(t1 - t0, 1)) * (W - PAD_L - PAD_R);
  const y = (v: number) => PAD_T + (1 - (v - lo) / (hi - lo)) * (H - PAD_T - PAD_B);

  const line = points.map((p, i) => `${x(t[i]).toFixed(1)},${y(p.modal).toFixed(1)}`).join(' ');
  const band = [
    ...points.map((p, i) => `${x(t[i]).toFixed(1)},${y(p.max ?? p.modal).toFixed(1)}`),
    ...points.map((p, i) => `${x(t[i]).toFixed(1)},${y(p.min ?? p.modal).toFixed(1)}`).reverse(),
  ].join(' ');
  const ticks = [lo, (lo + hi) / 2, hi];
  const last = points[points.length - 1];
  const first = points[0];

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}: from ₹${num.format(first.modal)} on ${dateIN(first.date)} to ₹${num.format(last.modal)} on ${dateIN(last.date)} per quintal`} className="h-auto w-full">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)} stroke="#e7e5e4" strokeDasharray="3 4" />
            <text x={PAD_L - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#78716c">₹{num.format(Math.round(v))}</text>
          </g>
        ))}
        <polygon points={band} fill="#1f563d" fillOpacity="0.08" />
        <polyline points={line} fill="none" stroke="#1f563d" strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <circle key={p.date} cx={x(t[i])} cy={y(p.modal)} r={i === points.length - 1 ? 4 : 2.25} fill={i === points.length - 1 ? '#e8a72f' : '#1f563d'}>
            <title>{`${dateIN(p.date)}: ₹${num.format(p.modal)}/qtl`}</title>
          </circle>
        ))}
        <text x={PAD_L} y={H - 6} fontSize="11" fill="#78716c">{dateIN(first.date)}</text>
        <text x={W - PAD_R} y={H - 6} fontSize="11" fill="#78716c" textAnchor="end">{dateIN(last.date)}</text>
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-500">
        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-brand-700" />Modal price</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-brand-700/10" />Min–max range</span>
        <span>₹ per quintal, averaged across markets each day</span>
      </figcaption>
    </figure>
  );
}

/** Averages entries per date into chart points, oldest first. */
export function dailyAverages(rows: { price_date: string; modal_paise_per_kg: number; min_paise_per_kg: number | null; max_paise_per_kg: number | null }[]): PricePoint[] {
  const byDate = new Map<string, { modal: number[]; min: number[]; max: number[] }>();
  for (const r of rows) {
    const d = byDate.get(r.price_date) ?? { modal: [], min: [], max: [] };
    d.modal.push(Number(r.modal_paise_per_kg));
    if (r.min_paise_per_kg) d.min.push(Number(r.min_paise_per_kg));
    if (r.max_paise_per_kg) d.max.push(Number(r.max_paise_per_kg));
    byDate.set(r.price_date, d);
  }
  const avg = (a: number[]) => (a.length ? Math.round(a.reduce((s, v) => s + v, 0) / a.length) : null);
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({ date, modal: avg(d.modal)!, min: avg(d.min), max: avg(d.max) }));
}
