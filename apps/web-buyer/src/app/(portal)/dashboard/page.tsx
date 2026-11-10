'use client';
import type { BuyerOrder, OrderListItem, RfqView } from '@agrimate/api-client';
import { formatINR } from '@agrimate/shared';
import { Card, EmptyState, Skeleton } from '@agrimate/ui';
import Link from 'next/link';
import { ErrorState, KybBlockedNotice, LinkButton, PageHeader, TableSkeleton } from '@/components/common';
import { ACTIVE_ORDER_HEAD, ActiveOrdersTable } from '@/components/orders-table';
import { api, mapLimit } from '@/lib/api';
import { useResource } from '@/lib/hooks';
import { isActiveOrder, outstandingPaise } from '@/lib/order-state';

/** Escrow balances exist only on the order detail response, so the dashboard reads them one by one, up to this many orders. */
const ESCROW_LOOKUP_LIMIT = 40;

interface DashboardData { active: OrderListItem[]; escrow: Record<string, string | undefined>; escrowPartial: boolean; rfqsWithBids: number; openRfqs: number }

async function loadDashboard(): Promise<DashboardData> {
  const [orders, rfqs] = await Promise.all([api.get<OrderListItem[]>('/orders'), api.get<RfqView[]>('/rfqs')]);
  const active = orders.filter((o) => isActiveOrder(o.state));
  const lookups = active.slice(0, ESCROW_LOOKUP_LIMIT);
  const rows = await mapLimit(lookups, 6, async (o) => [o.id, (await api.get<BuyerOrder>(`/orders/${o.id}`)).escrowPaise] as const);
  const open = rfqs.filter((r) => r.state === 'RFQ_OPEN' || r.state === 'BIDDING');
  return { active, escrow: Object.fromEntries(rows), escrowPartial: active.length > lookups.length, rfqsWithBids: open.filter((r) => r.bidCount > 0).length, openRfqs: open.length };
}

function Tile({ label, value, note, loading }: { label: string; value: string; note?: string; loading: boolean }) {
  return (
    <Card className="p-4">
      <p className="text-sm text-slate-600">{label}</p>
      {loading ? <Skeleton className="mt-2 h-7 w-28" /> : <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>}
      {note && !loading && <p className="mt-1 text-xs text-slate-500">{note}</p>}
    </Card>
  );
}

export default function DashboardPage() {
  const r = useResource(loadDashboard, [], { pollMs: 60_000 });
  const d = r.data;
  const escrowTotal = d ? Object.values(d.escrow).reduce((s, v) => s + BigInt(v ?? '0'), 0n) : 0n;
  const dueTotal = d ? d.active.reduce((s, o) => s + outstandingPaise(o), 0n) : 0n;
  const loading = !d && r.loading;

  return (
    <>
      <PageHeader title="Dashboard" actions={<><LinkButton href="/catalog" variant="secondary">Browse catalog</LinkButton><LinkButton href="/rfqs/new">Post RFQ</LinkButton></>} />
      <div className="space-y-5">
        <KybBlockedNotice action="post RFQs or accept offers" />
        {r.error && <ErrorState message={r.error} onRetry={() => void r.reload()} />}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile label="Money in escrow" value={formatINR(escrowTotal)} note={d?.escrowPartial ? `Across the latest ${ESCROW_LOOKUP_LIMIT} active orders` : 'Held until settlement'} loading={loading} />
          <Tile label="Due from you now" value={formatINR(dueTotal)} note="Unpaid tranches on active orders" loading={loading} />
          <Tile label="Active orders" value={String(d?.active.length ?? 0)} loading={loading} />
          <Tile label="Open RFQs" value={String(d?.openRfqs ?? 0)} note={d ? `${d.rfqsWithBids} with bids to review` : undefined} loading={loading} />
        </div>
        <section aria-labelledby="active-orders">
          <h2 id="active-orders" className="mb-2 text-base font-semibold text-slate-900">Active orders</h2>
          {loading && <TableSkeleton head={ACTIVE_ORDER_HEAD} rows={4} />}
          {d && d.active.length === 0 && (
            <EmptyState title="No active orders">Accept a bid on one of your <Link href="/rfqs" className="underline">RFQs</Link> or buy from the <Link href="/catalog" className="underline">catalog</Link> to start an order.</EmptyState>
          )}
          {d && d.active.length > 0 && <ActiveOrdersTable orders={d.active} escrow={d.escrow} />}
        </section>
      </div>
    </>
  );
}
