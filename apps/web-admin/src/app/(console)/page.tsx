'use client';
import { useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import type { AnalyticsSummary, KnowledgeGraphView } from '@agrimate/api-client';
import { Alert, Money, Skeleton, StateBadge, Table, Td } from '@agrimate/ui';
import { bucketTrend, CalendarHeat, ColumnTrend, compactINR, Dial, HeroBand, Journey, RangeTabs, RankBars, rupeeAxis, SplitBar, StatTile, VizCard, VizTable, type Tone } from '@agrimate/ui/viz';
import { api, errorMessage } from '@/lib/api';
import { useLoad, type Loaded } from '@/lib/use-load';
import { ErrorState, Ist, OrderLink, Q } from '@/components/console';
import type { AdminDispute, AdminPayout, EscrowView, LedgerAccounts, Queues, ReconReport, SlaBoard } from '@/lib/types';

const KnowledgeGraph = dynamic(() => import('@agrimate/ui/graph').then((m) => m.KnowledgeGraph), { ssr: false, loading: () => <Skeleton className="h-[420px] w-full" /> });

const QUEUE_LABELS: [keyof Queues, string][] = [['kyb', 'Buyer KYB'], ['kyc', 'Farmer KYC'], ['inspector', 'Inspector degrees'], ['logistics', 'Logistics documents'], ['organic', 'Organic certificates']];
const RANGES = [{ value: 7, label: '7 days' }, { value: 30, label: '30 days' }, { value: 90, label: '90 days' }, { value: 365, label: '1 year' }];

/** One figure. Each loads and fails on its own, so one broken endpoint never blanks the page. */
function Attention<T>({ label, href, q, value, tone }: { label: string; href: string; q: Loaded<T>; value: (d: T) => React.ReactNode; tone?: (d: T) => Tone }) {
  return <StatTile label={label} href={href} loading={!q.loaded && !q.error} error={!q.loaded && q.error ? errorMessage(q.error) : undefined} value={q.loaded ? value(q.data as T) : null} tone={q.loaded ? tone?.(q.data as T) ?? 'neutral' : 'neutral'} />;
}
const sampleNote = (d: { ok: number; sample: number }, noun: string) => (d.sample ? `${d.ok} of ${d.sample} ${noun}` : undefined);

export default function OverviewPage() {
  const [days, setDays] = useState(30);
  const summary = useLoad(() => api.get<AnalyticsSummary>(`/analytics/summary?days=${days}`), [days]);
  const graph = useLoad(() => api.get<KnowledgeGraphView>(`/analytics/graph?days=${Math.max(days, 90)}`), [days]);
  const queues = useLoad(() => api.get<Queues>('/admin/queues'), []);
  const board = useLoad(() => api.get<SlaBoard>('/admin/sla-board'), []);
  const escrow = useLoad(() => api.get<EscrowView>('/admin/escrow'), []);
  const ledger = useLoad(() => api.get<LedgerAccounts>('/admin/ledger/accounts'), []);
  const blocked = useLoad(() => api.get<AdminPayout[]>('/admin/payouts?status=BLOCKED'), []);
  const failed = useLoad(() => api.get<AdminPayout[]>('/admin/payouts?status=FAILED'), []);
  const disputes = useLoad(() => api.get<AdminDispute[]>('/admin/disputes?status=OPEN'), []);
  const recon = useLoad(() => api.get<ReconReport[]>('/admin/reconciliation'), []);

  // Changing the period keeps the old picture on screen, dimmed, until the new one arrives.
  const lastSummary = useRef<AnalyticsSummary | undefined>(undefined);
  if (summary.data) lastSummary.current = summary.data;
  const s = lastSummary.current;
  const lastGraph = useRef<KnowledgeGraphView | undefined>(undefined);
  if (graph.data) lastGraph.current = graph.data;

  const queueTotal = (q: Queues) => QUEUE_LABELS.reduce((n, [k]) => n + q[k].length, 0);
  const trial = ledger.data?.trialBalancePaise;
  const unbalanced = trial !== undefined && BigInt(trial) !== 0n;
  const lastRecon = recon.data?.[0];
  const rangeLabel = RANGES.find((r) => r.value === days)!.label;
  const columns = s ? bucketTrend(s.trend, s.days) : [];

  return (
    <div className="mx-auto max-w-[1500px] space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Overview</h1>
          <p className="text-sm text-slate-500">How the marketplace is doing, and what needs you now.</p>
        </div>
        <RangeTabs label="Period" value={days} options={RANGES} onChange={setDays} />
      </header>

      {unbalanced && (
        <div role="alert" className="rounded-xl border-2 border-red-700 bg-red-700 p-4 text-white">
          <p className="text-base font-semibold">The ledger is out of balance by <Money paise={trial} />.</p>
          <p className="mt-1 text-sm">Debits and credits must sum to zero. Treat every balance as unreliable and hold manual money actions until this is explained. Compare journals in the ledger explorer and tell engineering.</p>
        </div>
      )}
      {ledger.error != null && !ledger.loaded && <ErrorState title="The ledger trial balance could not be read, so it has not been confirmed as zero" error={ledger.error} onRetry={() => void ledger.reload()} />}
      {lastRecon && !lastRecon.matched && <Alert tone="red" role="alert">Reconciliation for {lastRecon.forDate} did not match. <Link href="/reconciliation" className="font-medium underline">Open reconciliation</Link></Alert>}
      {summary.error != null && !s && <ErrorState title="The dashboard figures could not be loaded" error={summary.error} onRetry={() => void summary.reload()} />}

      <div className={summary.loading && s ? 'space-y-4 opacity-60 transition-opacity' : 'space-y-4 transition-opacity'}>
        {s ? (
          <HeroBand eyebrow={`Trade value, last ${rangeLabel}`} value={compactINR(s.kpis.gmvPaise)} now={s.kpis.gmvPaise} previous={s.kpis.previousGmvPaise} trend={s.trend.map((d) => Number(BigInt(d.gmvPaise)))}
            stats={[
              { label: 'Held in escrow', value: compactINR(s.kpis.escrowPaise) },
              { label: 'Commission earned', value: compactINR(s.kpis.commissionPaise ?? '0') },
              { label: 'Live orders', value: String(s.kpis.activeOrders) },
              { label: 'Tonnes traded', value: (s.kpis.quantityKg / 1000).toLocaleString('en-IN', { maximumFractionDigits: 0 }) },
            ]} />
        ) : !summary.error && <Skeleton className="h-40 w-full rounded-2xl" />}

        <section aria-label="Needs attention" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Attention label="Verification queue" href="/queues" q={queues} value={queueTotal} tone={(d) => (queueTotal(d) > 0 ? 'warning' : 'good')} />
          <Attention label="Open alerts" href="/sla" q={board} value={(d) => d.alerts.length} tone={(d) => (d.alerts.length > 0 ? 'warning' : 'good')} />
          <Attention label="Overdue orders" href="/sla" q={board} value={(d) => d.overdue.length} tone={(d) => (d.overdue.length > 0 ? 'critical' : 'good')} />
          <Attention label="Open disputes" href="/disputes" q={disputes} value={(d) => d.length} tone={(d) => (d.length > 0 ? 'warning' : 'good')} />
          <Attention label="Blocked payouts" href="/payouts?status=BLOCKED" q={blocked} value={(d) => d.length} tone={(d) => (d.length > 0 ? 'warning' : 'good')} />
          <Attention label="Failed payouts" href="/payouts?status=FAILED" q={failed} value={(d) => d.length} tone={(d) => (d.length > 0 ? 'critical' : 'good')} />
        </section>

        {s && (
          <>
            <section aria-label="Service health" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
              <Dial label="Dispatched on time" value={s.dials.slaOnTime.value} good={90} warn={75} detail={sampleNote(s.dials.slaOnTime, 'orders')} href="/sla" />
              <Dial label="Quality pass rate" value={s.dials.qualityPass.value} good={90} warn={75} detail={sampleNote(s.dials.qualityPass, 'inspections')} href="/quality" />
              <Dial label="Delivered without dispute" value={s.dials.disputeFree.value} good={95} warn={85} detail={sampleNote(s.dials.disputeFree, 'deliveries')} href="/disputes" />
              <Dial label="Orders completed" value={s.dials.completion.value} good={90} warn={75} detail={sampleNote(s.dials.completion, 'closed orders')} href="/orders" />
              <Dial label="Payouts succeeded" value={s.dials.payoutSuccess?.value ?? null} good={99} warn={95} detail={s.dials.payoutSuccess && sampleNote(s.dials.payoutSuccess, 'payouts')} href="/payouts" />
            </section>

            <VizCard title="Where live orders are now" description="Every order still moving, in journey order. Click a stage to see them.">
              <Journey stages={s.pipeline.map((p) => ({ key: p.key, label: p.label, count: p.count, alert: p.key === 'disputed', href: p.key === 'disputed' ? '/disputes' : p.states.length === 1 ? `/orders?state=${p.states[0]}` : '/orders' }))} />
            </VizCard>

            <div className="grid gap-4 xl:grid-cols-3">
              <VizCard className="xl:col-span-2" title="Trade value over time" description={`${s.kpis.orders} orders in the last ${rangeLabel}${s.days >= 90 ? ', grouped by ' + (s.days >= 365 ? 'month' : 'week') : ''}.`}
                table={<VizTable head={['Period', 'Trade value', 'Detail']} rows={columns.map((c) => [c.label, c.display, c.note ?? ''])} />}>
                <ColumnTrend data={columns} axis={rupeeAxis} summary={`Trade value over the last ${rangeLabel}. Total ${compactINR(s.kpis.gmvPaise)}. Use the arrow keys to step through periods.`} />
              </VizCard>
              <VizCard title="Where the money went" description="Paid out and earned in this period." table={<VizTable head={['Part', 'Amount']} rows={s.split.map((p) => [p.label, compactINR(p.paise)])} />}>
                <SplitBar parts={s.split.map((p) => ({ key: p.key, label: p.label, value: Number(BigInt(p.paise)), display: compactINR(p.paise) }))} />
                <dl className="mt-4 grid grid-cols-4 gap-2 border-t border-slate-100 pt-3">
                  {s.outcomes.map((o) => <div key={o.key}><dd className="text-lg font-semibold text-slate-900">{o.count}</dd><dt className="truncate text-xs text-slate-500">{o.label}</dt></div>)}
                </dl>
              </VizCard>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <VizCard title="Top crops by value" table={<VizTable head={['Crop', 'Value', 'Orders']} rows={s.commodities.map((r) => [r.name, compactINR(r.gmvPaise), r.orders])} />}>
                <RankBars rows={s.commodities.map((r) => ({ name: r.name, value: Number(BigInt(r.gmvPaise)), display: compactINR(r.gmvPaise), note: `${r.orders}` }))} />
              </VizCard>
              <VizCard title="Sourcing states by value" table={<VizTable head={['State', 'Value', 'Orders']} rows={s.regions.map((r) => [r.name, compactINR(r.gmvPaise), r.orders])} />}>
                <RankBars rows={s.regions.map((r) => ({ name: r.name, value: Number(BigInt(r.gmvPaise)), display: compactINR(r.gmvPaise), note: `${r.orders}` }))} />
              </VizCard>
              <VizCard title="Daily activity" description="New orders placed each day." table={<VizTable head={['Date', 'Orders']} rows={s.trend.map((d) => [d.date, d.orders])} />}>
                <CalendarHeat unit="orders" days={s.trend.slice(-91).map((d) => ({ date: d.date, value: d.orders, display: `${d.orders} order${d.orders === 1 ? '' : 's'}, ${compactINR(d.gmvPaise)}` }))} />
              </VizCard>
            </div>
          </>
        )}

        <VizCard title="Trade network" description="Who buys what from whom. Bigger shapes carry more value." action={<Link href="/network" className="rounded-md px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-50">Open full map</Link>}>
          {lastGraph.current ? <KnowledgeGraph compact height={420} nodes={lastGraph.current.nodes} links={lastGraph.current.links} orderHref={(id) => `/orders/${id}`} /> : graph.error ? <ErrorState title="The network could not be loaded" error={graph.error} onRetry={() => void graph.reload()} /> : <Skeleton className="h-[420px] w-full" />}
        </VizCard>

        <div className="grid gap-4 lg:grid-cols-2">
          <VizCard title="Verification queues">
            <Q q={queues} rows={5}>
              {(d) => (
                <Table head={['Queue', 'Waiting']}>
                  {QUEUE_LABELS.map(([k, label]) => <tr key={k}><Td><Link href={`/queues?tab=${k}`} className="text-emerald-800 underline underline-offset-2">{label}</Link></Td><Td className="tabular-nums">{d[k].length}</Td></tr>)}
                </Table>
              )}
            </Q>
          </VizCard>
          <VizCard title="Overdue orders" description="Past the SLA deadline and not yet out of the gate.">
            <Q q={board} rows={3} isEmpty={(d) => d.overdue.length === 0} emptyTitle="No overdue orders">
              {(d) => (
                <Table head={['Order', 'State', 'Deadline']}>
                  {d.overdue.slice(0, 8).map((o) => <tr key={o.id}><Td><OrderLink id={o.id} code={o.code} /></Td><Td><StateBadge state={o.state} /></Td><Td><Ist at={o.slaDeadlineAt} /></Td></tr>)}
                </Table>
              )}
            </Q>
          </VizCard>
        </div>

        {escrow.error != null && !escrow.loaded && <ErrorState title="Escrow detail could not be read" error={escrow.error} onRetry={() => void escrow.reload()} />}
      </div>
    </div>
  );
}
