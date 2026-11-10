'use client';
/**
 * Six-month mandi price chart, following the dataviz method. Palette validated with validate_palette.js against the white
 * card surface: all gates pass, with a contrast WARN on slot 3 (aqua), whose relief is the legend and the table view below.
 * Colour follows the market, never its rank, so narrowing to one market does not repaint it. Prices are plotted as numbers
 * for geometry only; every printed amount goes through formatINR on the API's decimal string.
 */
import type { PricePoint } from '@agrimate/api-client';
import { formatINR } from '@agrimate/shared';
import { useMemo } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const SURFACE = '#ffffff';
const GRID = '#e1e0d9';
const AXIS = '#c3c2b7';
const MUTED = '#6b6a65';
const HEIGHT = 340;
const PLOT_HEIGHT = HEIGHT - 40;

/** Stable colour for a market, given the full market list of the commodity. */
export const marketColor = (allMarkets: string[], market: string) => SERIES[Math.max(0, allMarkets.indexOf(market)) % SERIES.length]!;

const dateLabel = (iso: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', ...opts }).format(new Date(`${iso}T00:00:00Z`));
export const formatPriceDate = (iso: string) => dateLabel(iso, { day: 'numeric', month: 'short', year: 'numeric' });

/** Round axis bounds in paise, with steps of 1, 2 or 5 rupee magnitudes. */
function niceScale(min: number, max: number, count = 5) {
  const span = Math.max(max - min, 100);
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let t = lo; t <= hi + step / 2; t += step) ticks.push(Math.round(t));
  return { lo, hi, ticks };
}

interface Row { date: string; [key: string]: unknown }

interface TooltipRow { market: string; point: PricePoint }

function ChartTooltip({ active, label, rows, single, colors }: { active?: boolean; label?: string | number; rows: Map<string, TooltipRow[]>; single: boolean; colors: (m: string) => string }) {
  if (!active || typeof label !== 'string') return null;
  const items = rows.get(label) ?? [];
  if (!items.length) return null;
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
      <p className="mb-1 text-slate-600">{formatPriceDate(label)}</p>
      <ul className="space-y-1">
        {items.map(({ market, point }) => (
          <li key={market} className="flex items-center gap-2">
            <span aria-hidden className="h-0.5 w-3 rounded" style={{ background: colors(market) }} />
            <span className="font-semibold text-slate-900 tabular-nums">{formatINR(point.modalPaisePerKg)}/kg</span>
            <span className="text-slate-600">{single ? 'modal' : market}</span>
            <span className="text-slate-500 tabular-nums">{formatINR(point.minPaisePerKg)} to {formatINR(point.maxPaisePerKg)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PriceChart({ points, markets, allMarkets, commodityName }: { points: PricePoint[]; markets: string[]; allMarkets: string[]; commodityName: string }) {
  const single = markets.length === 1;
  const color = (m: string) => marketColor(allMarkets, m);

  const { rows, tooltipRows, scale, monthTicks, endLabels } = useMemo(() => {
    const byDate = new Map<string, Row>();
    const tips = new Map<string, TooltipRow[]>();
    let low = Infinity;
    let high = -Infinity;
    for (const p of points) {
      if (!markets.includes(p.market)) continue;
      const row = byDate.get(p.date) ?? { date: p.date };
      const modal = Number(p.modalPaisePerKg);
      const min = Number(p.minPaisePerKg);
      const max = Number(p.maxPaisePerKg);
      row[p.market] = modal;
      if (single) row.range = [min, max];
      byDate.set(p.date, row);
      const list = tips.get(p.date) ?? [];
      list.push({ market: p.market, point: p });
      tips.set(p.date, list);
      low = Math.min(low, single ? min : modal);
      high = Math.max(high, single ? max : modal);
    }
    const sorted = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    const s = niceScale(Number.isFinite(low) ? low : 0, Number.isFinite(high) ? high : 100);

    const months: string[] = [];
    let lastMonth = '';
    for (const r of sorted) {
      const m = r.date.slice(0, 7);
      if (m !== lastMonth) { months.push(r.date); lastMonth = m; }
    }

    // Direct end labels only where they separate on screen; otherwise the legend and tooltip carry identity.
    const last = sorted[sorted.length - 1];
    const ends = markets
      .filter((m) => last && typeof last[m] === 'number')
      .map((m) => ({ market: m, value: last![m] as number }))
      .sort((a, b) => a.value - b.value);
    const pxPerPaisa = PLOT_HEIGHT / Math.max(s.hi - s.lo, 1);
    const separated = ends.every((e, i) => i === 0 || (e.value - ends[i - 1]!.value) * pxPerPaisa >= 16);

    return { rows: sorted, tooltipRows: tips, scale: s, monthTicks: months, endLabels: separated && !single ? new Set(ends.map((e) => e.market)) : new Set<string>() };
  }, [points, markets, single]);

  const lastIndex = rows.length - 1;
  const lastPoint = single ? tooltipRows.get(rows[lastIndex]?.date ?? '')?.[0]?.point : undefined;

  return (
    <figure className="m-0">
      <figcaption className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-700">
        {single ? (
          <>
            <span className="flex items-center gap-1.5"><span aria-hidden className="h-0.5 w-4 rounded" style={{ background: color(markets[0]!) }} />Modal price</span>
            <span className="flex items-center gap-1.5"><span aria-hidden className="h-3 w-4 rounded-sm" style={{ background: color(markets[0]!), opacity: 0.14 }} />Minimum to maximum</span>
          </>
        ) : markets.map((m) => (
          <span key={m} className="flex items-center gap-1.5"><span aria-hidden className="h-0.5 w-4 rounded" style={{ background: color(m) }} />{m}</span>
        ))}
        <span className="text-slate-500">₹ per kg</span>
      </figcaption>
      <div role="group" aria-label={`${commodityName} modal price per kg over six months, ${markets.join(', ')}. The same data is in the table view below.`}>
        <ResponsiveContainer width="100%" height={HEIGHT}>
          <ComposedChart data={rows} margin={{ top: 8, right: 76, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="date" ticks={monthTicks} tickFormatter={(d: string) => dateLabel(d, { month: 'short' })} tick={{ fontSize: 12, fill: MUTED }} tickLine={false} axisLine={{ stroke: AXIS }} interval={0} />
            <YAxis domain={[scale.lo, scale.hi]} ticks={scale.ticks} tickFormatter={(v: number) => formatINR(Math.round(v))} tick={{ fontSize: 12, fill: MUTED }} tickLine={false} axisLine={false} width={64} />
            <Tooltip cursor={{ stroke: AXIS, strokeWidth: 1 }} isAnimationActive={false} content={(p) => <ChartTooltip active={p.active} label={p.label} rows={tooltipRows} single={single} colors={color} />} />
            {single && <Area dataKey="range" stroke="none" fill={color(markets[0]!)} fillOpacity={0.12} isAnimationActive={false} activeDot={false} />}
            {markets.map((m) => (
              <Line
                key={m}
                dataKey={m}
                name={m}
                stroke={color(m)}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                isAnimationActive={false}
                activeDot={{ r: 4, stroke: SURFACE, strokeWidth: 2 }}
                dot={(d: { index: number; cx?: number; cy?: number }) => {
                  if (d.index !== lastIndex || d.cx === undefined || d.cy === undefined) return <g key={d.index} />;
                  const text = single && lastPoint ? formatINR(lastPoint.modalPaisePerKg) : endLabels.has(m) ? m : null;
                  return (
                    <g key={d.index}>
                      <circle cx={d.cx} cy={d.cy} r={4} fill={color(m)} stroke={SURFACE} strokeWidth={2} />
                      {text && <text x={d.cx + 8} y={d.cy + 4} fontSize={12} fill="#334155">{text}</text>}
                    </g>
                  );
                }}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
