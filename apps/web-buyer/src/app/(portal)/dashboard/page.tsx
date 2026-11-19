'use client';
import { useState } from 'react';
import dynamic from 'next/dynamic';
import type { AnalyticsSummary, BuyerOrder, KnowledgeGraphView, OrderListItem, RfqView } from '@agrimate/api-client';
import { EmptyState, Skeleton } from '@agrimate/ui';
import { bucketTrend, ColumnTrend, compactINR, Dial, HeroBand, Journey, RangeTabs, RankBars, rupeeAxis, SplitBar, StatTile, VizCard, VizTable } from '@agrimate/ui/viz';
import Link from 'next/link';
import { ErrorState, KybBlockedNotice, LinkButton, TableSkeleton } from '@/components/common';
import { ACTIVE_ORDER_HEAD, ActiveOrdersTable } from '@/components/orders-table';
import { api, mapLimit } from '@/lib/api';
import { useResource } from '@/lib/hooks';
import { isActiveOrder } from '@/lib/order-state';

const KnowledgeGraph = dynamic(() => import('@agrimate/ui/graph').then((m) => m.KnowledgeGraph), { ssr: false, loading: () => <Skeleton className="h-[400px] w-full" /> });

/** Escrow balances exist only on the order detail response, so the table reads them one by one, up to this many orders. */
const ESCROW_LOOKUP_LIMIT = 40;
const RANGES = [{ value: 30, label: '30 days' }, { value: 90, label: '90 days' }, { value: 365, label: '1 year' }];

interface TableData { active: OrderListItem[]; escrow: Record<string, string | undefined>; rfqsWithBids: number; openRfqs: number }

async function loadTable(): Promise<TableData> {
  const [orders, rfqs] = await Promise.all([api.get<OrderListItem[]>('/orders'), api.get<RfqView[]>('/rfqs')]);
  const active = orders.filter((o) => isActiveOrder(o.state));
  const rows = await mapLimit(active.slice(0, ESCROW_LOOKUP_LIMIT), 6, async (o) => [o.id, (await api.get<BuyerOrder>(`/orders/${o.id}`)).escrowPaise] as const);
  const open = rfqs.filter((r) => r.state === 'RFQ_OPEN' || r.state === 'BIDDING');
  return { active, escrow: Object.fromEntries(rows), rfqsWithBids: open.filter((r) => r.bidCount > 0).length, openRfqs: open.length };
}
const note = (d: { ok: number; sample: number }, noun: string) => (d.sample ? `${d.ok} of ${d.sample} ${noun}` : undefined);

export default function DashboardPage() {
  const [days, setDays] = useState(90);
  const table = useResource(loadTable, [], { pollMs: 60_000 });
  const summary = useResource(() => api.get<AnalyticsSummary>(`/analytics/summary?days=${days}`), [days], { pollMs: 60_000 });
  const graph = useResource(() => api.get<KnowledgeGraphView>('/analytics/graph?days=90'), []);
  const s = summary.data; const d = table.data;
  const rangeLabel = RANGES.find((r) => r.value === days)!.label;
  const columns = s ? bucketTrend(s.trend, s.days) : [];

  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Dashboard</h1>
          <p className="text-sm text-slate-500">Your buying, your money in escrow and your orders at a glance.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RangeTabs label="Period" value={days} options={RANGES} onChange={setDays} />
          <LinkButton href="/catalog" variant="secondary">Browse catalog</LinkButton>
          <LinkButton href="/rfqs/new">Post RFQ</LinkButton>
        </div>
      </header>
      <KybBlockedNotice action="post RFQs or accept offers" />
      {(summary.error || table.error) && <ErrorState message={(summary.error ?? table.error)!} onRetry={() => { void summary.reload(); void table.reload(); }} />}

      <div className={summary.loading && s ? 'space-y-4 opacity-60 transition-opacity' : 'space-y-4 transition-opacity'}>
        {s ? (
          <HeroBand eyebrow={`Bought in the last ${rangeLabel}`} value={compactINR(s.kpis.gmvPaise)} now={s.kpis.gmvPaise} previous={s.kpis.previousGmvPaise} trend={s.trend.map((x) => Number(BigInt(x.gmvPaise)))}
            stats={[
              { label: 'In escrow, held safely', value: compactINR(s.kpis.escrowPaise) },
              { label: 'Due from you now', value: compactINR(s.kpis.duePaise) },
              { label: 'Live orders', value: String(s.kpis.activeOrders) },
              { label: 'Tonnes bought', value: (s.kpis.quantityKg / 1000).toLocaleString('en-IN', { maximumFractionDigits: 0 }) },
            ]} />
        ) : !summary.error && <Skeleton className="h-40 w-full rounded-2xl" />}

        {s && (
          <>
            <section aria-label="How your orders are going" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Dial label="Dispatched on time" value={s.dials.slaOnTime.value} good={90} warn={75} detail={note(s.dials.slaOnTime, 'orders')} href="/orders" />
              <Dial label="Quality pass rate" value={s.dials.qualityPass.value} good={90} warn={75} detail={note(s.dials.qualityPass, 'inspections')} href="/orders" />
              <Dial label="Delivered without dispute" value={s.dials.disputeFree.value} good={95} warn={85} detail={note(s.dials.disputeFree, 'deliveries')} href="/orders" />
              <Dial label="Orders completed" value={s.dials.completion.value} good={90} warn={75} detail={note(s.dials.completion, 'closed orders')} href="/orders" />
            </section>

            <VizCard title="Where your orders are now" description="Every order still moving, in journey order.">
              <Journey stages={s.pipeline.map((p) => ({ key: p.key, label: p.label, count: p.count, alert: p.key === 'disputed', href: '/orders' }))} />
            </VizCard>

            <div className="grid gap-4 xl:grid-cols-3">
              <VizCard className="xl:col-span-2" title="Your spending over time" description={`${s.kpis.orders} orders in the last ${rangeLabel}.`} table={<VizTable head={['Period', 'Value', 'Detail']} rows={columns.map((c) => [c.label, c.display, c.note ?? ''])} />}>
                <ColumnTrend data={columns} axis={rupeeAxis} summary={`Spending over the last ${rangeLabel}. Total ${compactINR(s.kpis.gmvPaise)}. Use the arrow keys to step through periods.`} />
              </VizCard>
              <div className="space-y-4">
                <VizCard title="What you paid for" table={<VizTable head={['Part', 'Amount']} rows={s.split.map((p) => [p.label, compactINR(p.paise)])} />}>
                  <SplitBar parts={s.split.map((p) => ({ key: p.key, label: p.label, value: Number(BigInt(p.paise)), display: compactINR(p.paise) }))} />
                </VizCard>
                <div className="grid grid-cols-2 gap-3">
                  <StatTile label="Open RFQs" value={d?.openRfqs ?? 0} loading={!d} href="/rfqs" note={d ? `${d.rfqsWithBids} with bids to review` : undefined} />
                  <StatTile label="Refunded or cancelled" value={s.outcomes.filter((o) => o.key === 'refunded' || o.key === 'cancelled').reduce((n, o) => n + o.count, 0)} href="/orders" />
                </div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <VizCard title="Top crops by value" table={<VizTable head={['Crop', 'Value', 'Orders']} rows={s.commodities.map((r) => [r.name, compactINR(r.gmvPaise), r.orders])} />}>
                <RankBars rows={s.commodities.map((r) => ({ name: r.name, value: Number(BigInt(r.gmvPaise)), display: compactINR(r.gmvPaise), note: `${r.orders}` }))} />
              </VizCard>
              <VizCard title="Sourcing states by value" table={<VizTable head={['State', 'Value', 'Orders']} rows={s.regions.map((r) => [r.name, compactINR(r.gmvPaise), r.orders])} />}>
                <RankBars rows={s.regions.map((r) => ({ name: r.name, value: Number(BigInt(r.gmvPaise)), display: compactINR(r.gmvPaise), note: `${r.orders}` }))} />
              </VizCard>
            </div>
          </>
        )}

        <VizCard title="My supply network" description="The farmers, crops and states behind your orders." action={<Link href="/network" className="rounded-md px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-50">Open full map</Link>}>
          {graph.data ? <KnowledgeGraph compact height={400} nodes={graph.data.nodes} links={graph.data.links} orderHref={(id) => `/orders/${id}`} /> : !graph.error && <Skeleton className="h-[400px] w-full" />}
        </VizCard>

        <section aria-labelledby="active-orders">
          <h2 id="active-orders" className="mb-2 text-[15px] font-semibold text-slate-900">Active orders</h2>
          {!d && table.loading && <TableSkeleton head={ACTIVE_ORDER_HEAD} rows={4} />}
          {d && d.active.length === 0 && <EmptyState title="No active orders">Accept a bid on one of your <Link href="/rfqs" className="underline">RFQs</Link> or buy from the <Link href="/catalog" className="underline">catalog</Link> to start an order.</EmptyState>}
          {d && d.active.length > 0 && <ActiveOrdersTable orders={d.active} escrow={d.escrow} />}
        </section>
      </div>
    </div>
  );
}
