'use client';
/**
 * The trade network: who buys what from whom. Identity is carried by shape and label as well as colour.
 * Layout settles before the first paint, so the map doesn't jiggle while it loads. Drag a node, scroll to zoom, click to focus.
 */
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force';
import * as React from 'react';
import Link from 'next/link';
import { cn } from './index';
import { compactINR, VIZ } from './viz';

export type GraphType = 'BUYER' | 'FARMER' | 'COMMODITY' | 'STATE' | 'INSPECTOR' | 'TRANSPORTER';
export interface GraphNodeInput { id: string; type: GraphType; label: string; gmvPaise: string; orderCount: number; flagged: boolean; orders: { id: string; code: string; state: string }[] }
export interface GraphLinkInput { source: string; target: string; kind: string; orderCount: number; gmvPaise: string }
type SimNode = GraphNodeInput & SimulationNodeDatum & { r: number };
type SimLink = Omit<GraphLinkInput, 'source' | 'target'> & SimulationLinkDatum<SimNode> & { source: SimNode; target: SimNode };

const TYPES: Record<GraphType, { label: string; color: string; shape: string }> = {
  BUYER: { label: 'Buyers', color: VIZ.series[0]!, shape: 'circle' },
  FARMER: { label: 'Farmers', color: VIZ.series[1]!, shape: 'square' },
  COMMODITY: { label: 'Crops', color: VIZ.series[2]!, shape: 'diamond' },
  STATE: { label: 'States', color: VIZ.series[3]!, shape: 'hexagon' },
  INSPECTOR: { label: 'Inspectors', color: VIZ.series[4]!, shape: 'triangle' },
  TRANSPORTER: { label: 'Transporters', color: VIZ.series[5]!, shape: 'pentagon' },
};
const KIND_TEXT: Record<string, [string, string]> = { BUYS: ['Buys', 'Bought by'], SUPPLIES: ['Supplies', 'Supplied by'], GROWN_IN: ['Based in', 'Home to'], INSPECTS: ['Inspected', 'Inspected by'], HAULS_FOR: ['Hauled for', 'Hauled by'] };

function polygon(sides: number, r: number, rotate: number) {
  return Array.from({ length: sides }, (_, i) => { const a = rotate + (i * 2 * Math.PI) / sides; return `${(r * Math.cos(a)).toFixed(1)},${(r * Math.sin(a)).toFixed(1)}`; }).join(' ');
}
function Shape({ shape, r, fill, stroke = 'white', strokeWidth = 2 }: { shape: string; r: number; fill: string; stroke?: string; strokeWidth?: number }) {
  const p = { fill, stroke, strokeWidth, strokeLinejoin: 'round' as const };
  if (shape === 'circle') return <circle r={r} {...p} />;
  if (shape === 'square') return <rect x={-r * 0.9} y={-r * 0.9} width={r * 1.8} height={r * 1.8} rx={3} {...p} />;
  const sides = { diamond: 4, hexagon: 6, triangle: 3, pentagon: 5 }[shape] ?? 6;
  return <polygon points={polygon(sides, r * (shape === 'triangle' ? 1.25 : 1.15), shape === 'hexagon' ? 0 : -Math.PI / 2)} {...p} />;
}
const LegendMark = ({ type, dim }: { type: GraphType; dim?: boolean }) => <svg aria-hidden width={14} height={14} viewBox="-8 -8 16 16" className={cn('shrink-0', dim && 'opacity-30')}><Shape shape={TYPES[type].shape} r={6} fill={TYPES[type].color} strokeWidth={0} /></svg>;

export function KnowledgeGraph({ nodes: inputNodes, links: inputLinks, height = 560, orderHref, compact }: { nodes: GraphNodeInput[]; links: GraphLinkInput[]; height?: number; orderHref?: (id: string) => string; compact?: boolean }) {
  const boxRef = React.useRef<HTMLDivElement>(null);
  const svgRef = React.useRef<SVGSVGElement>(null);
  const [width, setWidth] = React.useState(800);
  const [, redraw] = React.useReducer((x: number) => x + 1, 0);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [hovered, setHovered] = React.useState<string | null>(null);
  const [hiddenTypes, setHiddenTypes] = React.useState<Set<GraphType>>(new Set());
  const [query, setQuery] = React.useState('');
  const [view, setView] = React.useState({ x: 0, y: 0, k: 1 });
  const [asList, setAsList] = React.useState(false);

  React.useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    setWidth(el.clientWidth || 800);
    const ro = new ResizeObserver(([e]) => { if (e) setWidth(e.contentRect.width); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const graph = React.useMemo(() => {
    const max = Math.max(...inputNodes.map((n) => Number(BigInt(n.gmvPaise))), 1);
    const nodes: SimNode[] = inputNodes.map((n) => ({ ...n, r: 8 + Math.sqrt(Number(BigInt(n.gmvPaise)) / max) * 18 }));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const links: SimLink[] = inputLinks.flatMap((l) => { const source = byId.get(l.source); const target = byId.get(l.target); return source && target ? [{ ...l, source, target }] : []; });
    const sim: Simulation<SimNode, SimLink> = forceSimulation(nodes)
      .force('link', forceLink<SimNode, SimLink>(links).id((n) => n.id).distance((l) => 60 + l.source.r + l.target.r).strength(0.35))
      .force('charge', forceManyBody().strength(-620))
      .force('x', forceX(0).strength(0.03)).force('y', forceY(0).strength(0.17))
      .force('collide', forceCollide<SimNode>().radius((n) => n.r + 24))
      .stop();
    for (let i = 0; i < 400; i++) sim.tick();
    return { nodes, links, byId, sim };
  }, [inputNodes, inputLinks]);

  const fit = React.useCallback(() => {
    if (!graph.nodes.length || width < 160) return;
    const xs = graph.nodes.map((n) => n.x ?? 0); const ys = graph.nodes.map((n) => n.y ?? 0);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const k = Math.max(0.2, Math.min(1.4, Math.min((width - 120) / Math.max(maxX - minX, 1), (height - 90) / Math.max(maxY - minY, 1))));
    setView({ k, x: width / 2 - (k * (minX + maxX)) / 2, y: height / 2 - (k * (minY + maxY)) / 2 });
  }, [graph, width, height]);
  React.useEffect(fit, [fit]);
  React.useEffect(() => { const s = graph.sim; s.on('tick', redraw); return () => { s.on('tick', null); s.stop(); }; }, [graph]);

  const zoomBy = React.useCallback((factor: number, cx: number, cy: number) => setView((v) => {
    const k = Math.min(4, Math.max(0.25, v.k * factor));
    return { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k };
  }), []);
  React.useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); const b = el.getBoundingClientRect(); zoomBy(e.deltaY < 0 ? 1.12 : 0.89, e.clientX - b.left, e.clientY - b.top); };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomBy, asList]);

  const drag = React.useRef<{ node?: SimNode; panX: number; panY: number; moved: boolean } | null>(null);
  const toGraph = (e: React.PointerEvent) => { const b = svgRef.current!.getBoundingClientRect(); return [(e.clientX - b.left - view.x) / view.k, (e.clientY - b.top - view.y) / view.k] as const; };
  const startNode = (e: React.PointerEvent, node: SimNode) => { e.stopPropagation(); (e.currentTarget as Element).setPointerCapture(e.pointerId); drag.current = { node, panX: 0, panY: 0, moved: false }; };
  const startPan = (e: React.PointerEvent) => { (e.currentTarget as Element).setPointerCapture(e.pointerId); drag.current = { panX: e.clientX - view.x, panY: e.clientY - view.y, moved: false }; };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    d.moved = true;
    if (d.node) { const [x, y] = toGraph(e); d.node.fx = x; d.node.fy = y; graph.sim.alpha(0.25).restart(); }
    else setView((v) => ({ ...v, x: e.clientX - d.panX, y: e.clientY - d.panY }));
  };
  const onUp = () => {
    const d = drag.current; drag.current = null;
    if (d?.node) { d.node.fx = null; d.node.fy = null; }
    if (d && !d.node && !d.moved) setSelected(null);
  };

  const visible = (n: SimNode) => !hiddenTypes.has(n.type);
  const focus = hovered ?? selected;
  const neighbours = React.useMemo(() => {
    const set = new Set<string>();
    if (focus) { set.add(focus); for (const l of graph.links) { if (l.source.id === focus) set.add(l.target.id); if (l.target.id === focus) set.add(l.source.id); } }
    return set;
  }, [focus, graph]);
  const q = query.trim().toLowerCase();
  const matches = (n: SimNode) => !q || n.label.toLowerCase().includes(q);
  const dimmed = (n: SimNode) => (focus ? !neighbours.has(n.id) : !!q && !matches(n));
  const labelCutoff = React.useMemo(() => [...graph.nodes].sort((a, b) => b.r - a.r)[Math.min(compact ? 10 : 22, graph.nodes.length - 1)]?.r ?? 0, [graph, compact]);
  const showLabel = (n: SimNode) => n.r >= labelCutoff || n.type === 'COMMODITY' || view.k > 1.3 || neighbours.has(n.id) || (!!q && matches(n));

  const current = selected ? graph.byId.get(selected) : undefined;
  const relations = current ? graph.links.flatMap((l) => (l.source.id === current.id ? [{ other: l.target, text: KIND_TEXT[l.kind]?.[0] ?? l.kind, l }] : l.target.id === current.id ? [{ other: l.source, text: KIND_TEXT[l.kind]?.[1] ?? l.kind, l }] : [])).sort((a, b) => b.l.orderCount - a.l.orderCount) : [];
  const presentTypes = (Object.keys(TYPES) as GraphType[]).filter((t) => graph.nodes.some((n) => n.type === t));
  const toggleType = (t: GraphType) => setHiddenTypes((s) => { const n = new Set(s); if (n.has(t)) n.delete(t); else n.add(t); return n; });

  if (!graph.nodes.length) return <p className="py-16 text-center text-sm text-slate-500">No trades in this period yet. The map fills in as orders are placed.</p>;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {presentTypes.map((t) => (
          <button key={t} type="button" aria-pressed={!hiddenTypes.has(t)} onClick={() => toggleType(t)} className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors', hiddenTypes.has(t) ? 'border-slate-200 text-slate-400 line-through' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50')}>
            <LegendMark type={t} dim={hiddenTypes.has(t)} />{TYPES[t].label}
          </button>
        ))}
        <span className="inline-flex items-center gap-1 px-1 text-xs text-slate-500"><span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full border-2" style={{ borderColor: VIZ.critical }} />Open dispute</span>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a name" aria-label="Find a name on the map" className="ml-auto h-8 w-40 rounded-md border border-slate-300 bg-white px-2.5 text-xs focus:border-emerald-700 focus:outline-none" />
        <button type="button" onClick={() => setAsList((v) => !v)} aria-pressed={asList} className="rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800">{asList ? 'Show map' : 'Show table'}</button>
      </div>

      {asList ? (
        <div className="overflow-x-auto" style={{ maxHeight: height }}>
          <table className="w-full text-left text-sm">
            <thead><tr className="border-b border-slate-200 text-xs text-slate-500">{['From', 'Relationship', 'To', 'Orders', 'Value'].map((h) => <th key={h} scope="col" className="py-2 pr-4 font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {[...graph.links].filter((l) => visible(l.source) && visible(l.target) && (matches(l.source) || matches(l.target))).sort((a, b) => b.orderCount - a.orderCount).map((l) => (
                <tr key={`${l.source.id}${l.target.id}${l.kind}`}><td className="py-1.5 pr-4 text-slate-800">{l.source.label}</td><td className="py-1.5 pr-4 text-slate-500">{KIND_TEXT[l.kind]?.[0] ?? l.kind}</td><td className="py-1.5 pr-4 text-slate-800">{l.target.label}</td><td className="py-1.5 pr-4 tabular-nums">{l.orderCount}</td><td className="py-1.5 pr-4 tabular-nums">{compactINR(l.gmvPaise)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={boxRef} className="relative overflow-hidden rounded-xl border border-slate-200 bg-[radial-gradient(circle_at_1px_1px,#e2e8f0_1px,transparent_0)] [background-size:22px_22px]" style={{ height }}>
          <svg ref={svgRef} width={width} height={height} className="block cursor-grab touch-none select-none active:cursor-grabbing" onPointerDown={startPan} onPointerMove={onMove} onPointerUp={onUp} role="group" aria-label="Trade network map. Use the table view for a text list.">
            <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
              {graph.links.filter((l) => visible(l.source) && visible(l.target)).map((l) => {
                const on = !!focus && (l.source.id === focus || l.target.id === focus);
                return <line key={`${l.source.id}${l.target.id}${l.kind}`} x1={l.source.x} y1={l.source.y} x2={l.target.x} y2={l.target.y} stroke={on ? VIZ.inkSoft : VIZ.base} strokeWidth={Math.min(5, 1 + Math.sqrt(l.orderCount) * 0.7) / view.k ** 0.5} opacity={focus && !on ? 0.12 : q ? 0.3 : 0.75} />;
              })}
              {graph.nodes.filter(visible).map((n) => (
                <g key={n.id} transform={`translate(${n.x},${n.y})`} opacity={dimmed(n) ? 0.16 : 1} className="cursor-pointer outline-none [&:focus-visible>circle.hit]:stroke-emerald-700" tabIndex={0} role="button" aria-pressed={selected === n.id}
                  aria-label={`${TYPES[n.type].label}: ${n.label}, ${n.orderCount} orders, ${compactINR(n.gmvPaise)}${n.flagged ? ', open dispute' : ''}`}
                  onPointerDown={(e) => startNode(e, n)} onPointerEnter={() => setHovered(n.id)} onPointerLeave={() => setHovered(null)} onFocus={() => setHovered(n.id)} onBlur={() => setHovered(null)}
                  onClick={() => { if (!drag.current?.moved) setSelected((s) => (s === n.id ? null : n.id)); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected((s) => (s === n.id ? null : n.id)); } }}>
                  <circle className="hit" r={Math.max(n.r + 4, 14)} fill="transparent" strokeWidth={2} />
                  {n.flagged && <circle r={n.r + 5} fill="none" stroke={VIZ.critical} strokeWidth={2.5} />}
                  {selected === n.id && <circle r={n.r + 9} fill="none" stroke={VIZ.ink} strokeWidth={1.5} />}
                  <Shape shape={TYPES[n.type].shape} r={n.r} fill={TYPES[n.type].color} />
                  {showLabel(n) && <text y={n.r + 15} textAnchor="middle" fontSize={11.5 / Math.max(view.k, 0.75)} fontWeight={600} fill={VIZ.ink} stroke="white" strokeWidth={3.5 / Math.max(view.k, 0.75)} paintOrder="stroke" className="pointer-events-none">{n.label.length > 20 && selected !== n.id ? `${n.label.slice(0, 19)}…` : n.label}</text>}
                </g>
              ))}
            </g>
          </svg>

          <div className="absolute bottom-3 left-3 flex overflow-hidden rounded-lg border border-slate-200 bg-white text-sm shadow-sm">
            <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1.25, width / 2, height / 2)} className="h-8 w-8 hover:bg-slate-100">+</button>
            <button type="button" aria-label="Zoom out" onClick={() => zoomBy(0.8, width / 2, height / 2)} className="h-8 w-8 border-l border-slate-200 hover:bg-slate-100">−</button>
            <button type="button" onClick={fit} className="h-8 border-l border-slate-200 px-2.5 text-xs font-medium hover:bg-slate-100">Fit</button>
          </div>

          {current && (
            <aside aria-label={`Details for ${current.label}`} className="absolute right-3 top-3 max-h-[calc(100%-1.5rem)] w-64 overflow-y-auto rounded-xl border border-slate-200 bg-white/95 p-3.5 shadow-lg backdrop-blur">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500"><LegendMark type={current.type} />{TYPES[current.type].label.replace(/s$/, '')}</p>
                  <p className="mt-0.5 truncate text-sm font-semibold text-slate-900">{current.label}</p>
                </div>
                <button type="button" aria-label="Close details" onClick={() => setSelected(null)} className="-mr-1 -mt-1 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">✕</button>
              </div>
              <div className="mt-2 flex gap-5">
                <div><p className="text-lg font-semibold text-slate-900">{compactINR(current.gmvPaise)}</p><p className="text-xs text-slate-500">Trade value</p></div>
                <div><p className="text-lg font-semibold text-slate-900">{current.orderCount}</p><p className="text-xs text-slate-500">Orders</p></div>
              </div>
              {current.flagged && <p className="mt-2 rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-800">▲ Linked to an open dispute</p>}
              {relations.length > 0 && <ul className="mt-3 space-y-1 border-t border-slate-100 pt-2">
                {relations.slice(0, 8).map((r) => (
                  <li key={r.other.id + r.text}><button type="button" onClick={() => setSelected(r.other.id)} className="flex w-full items-center justify-between gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-slate-50"><span className="truncate text-slate-700"><span className="text-slate-500">{r.text}</span> {r.other.label}</span><span className="shrink-0 tabular-nums text-slate-500">{r.l.orderCount}</span></button></li>
                ))}
              </ul>}
              {orderHref && current.orders.length > 0 && <div className="mt-2 border-t border-slate-100 pt-2"><p className="text-xs font-medium text-slate-500">Recent orders</p><ul className="mt-1 space-y-0.5">{current.orders.map((o) => <li key={o.id}><Link href={orderHref(o.id)} className="text-xs font-medium text-emerald-800 underline underline-offset-2">{o.code}</Link></li>)}</ul></div>}
            </aside>
          )}
          {!current && !compact && <p className="pointer-events-none absolute right-3 top-3 rounded-md bg-white/80 px-2 py-1 text-xs text-slate-500">Click a shape for details. Drag to rearrange, scroll to zoom.</p>}
        </div>
      )}
    </div>
  );
}
