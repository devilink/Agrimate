'use client';
import type { BidView, BuyerOrder, RfqView } from '@agrimate/api-client';
import { formatINR, formatTonnes } from '@agrimate/shared';
import { Badge, Button, Card, cn, EmptyState, Money, StateBadge, Table, Td } from '@agrimate/ui';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { CardSkeleton, ErrorState, Fact, FormError, GradeSpecTable, KybBlockedNotice, LinkButton, Modal, PageHeader, TableSkeleton } from '@/components/common';
import { ContractDialog } from '@/components/contract-dialog';
import { api } from '@/lib/api';
import { useAction, useResource } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { formatISTDate, lineTotalPaise } from '@/lib/units';

const BID_HEAD = ['Farmer', 'Location', 'Phone', 'Bid price', 'Against target', 'Order value', 'State', ''];

function vsTarget(bid: string, target: string): string {
  const diff = BigInt(target) - BigInt(bid);
  if (diff === 0n) return 'At target';
  return diff > 0n ? `${formatINR(diff)}/kg below` : `${formatINR(-diff)}/kg above`;
}

function RfqDetail({ rfq, onChanged }: { rfq: RfqView; onChanged: () => void }) {
  const router = useRouter();
  const { kybVerified } = useSession();
  const bids = useResource(() => api.get<BidView[]>(`/rfqs/${rfq.id}/bids`), [rfq.id, rfq.bidCount, rfq.state], { pollMs: 30_000 });
  const [accepting, setAccepting] = useState<BidView | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const accept = useAction();
  const cancel = useAction();
  const biddingOpen = rfq.state === 'RFQ_OPEN' || rfq.state === 'BIDDING';

  const confirmAccept = () => {
    if (!accepting) return;
    void accept.run(async () => {
      const order = await api.post<BuyerOrder>(`/bids/${accepting.id}/accept`, { acceptContract: true });
      router.push(`/orders/${order.id}`);
    });
  };
  const confirmCancel = () => {
    void cancel.run(async () => {
      await api.post(`/rfqs/${rfq.id}/cancel`);
      setCancelling(false);
      onChanged();
    });
  };

  return (
    <div className="min-w-0 space-y-4">
      <Card>
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{rfq.code}: {rfq.commodity.name}, {rfq.grade.name}</h2>
            <div className="mt-1 flex items-center gap-2"><StateBadge state={rfq.state} />{rfq.organicRequired && <Badge tone="green">Organic required</Badge>}</div>
          </div>
          {rfq.order && <LinkButton href={`/orders/${rfq.order.id}`} variant="secondary" size="sm">Open order {rfq.order.code}</LinkButton>}
          {biddingOpen && <Button variant="secondary" size="sm" onClick={() => setCancelling(true)}>Cancel RFQ</Button>}
        </div>
        <dl className="grid gap-x-8 sm:grid-cols-2">
          <Fact label="Volume">{formatTonnes(rfq.quantityKg)}</Fact>
          <Fact label="Locked target price"><span className="tabular-nums">{formatINR(rfq.targetPricePaisePerKg)}/kg</span></Fact>
          <Fact label="Delivery PIN"><span className="tabular-nums">{rfq.deliveryPin}</span></Fact>
          <Fact label="Market average when posted"><span className="tabular-nums">{rfq.suggestedPricePaisePerKg ? `${formatINR(rfq.suggestedPricePaisePerKg)}/kg` : '—'}</span></Fact>
          <Fact label="Needed by">{formatISTDate(rfq.neededBy)}</Fact>
          <Fact label="Posted">{formatISTDate(rfq.createdAt)}</Fact>
        </dl>
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer font-medium text-slate-700">Grade parameters</summary>
          <div className="mt-2"><GradeSpecTable parameters={rfq.grade.parameters} /></div>
        </details>
      </Card>

      <section aria-labelledby="bids-heading" className="space-y-2">
        <h3 id="bids-heading" className="text-sm font-semibold text-slate-900">Bids</h3>
        {biddingOpen && <KybBlockedNotice action="accept a bid" />}
        {bids.error && <ErrorState message={bids.error} onRetry={() => void bids.reload()} />}
        {bids.loading && !bids.data && <TableSkeleton head={BID_HEAD} rows={2} />}
        {bids.data?.length === 0 && <EmptyState title="No bids yet">{biddingOpen ? 'Farmers can see this RFQ now. New bids appear here.' : 'This RFQ closed without bids.'}</EmptyState>}
        {!!bids.data?.length && (
          <Table head={BID_HEAD}>
            {bids.data.map((b) => (
              <tr key={b.id}>
                <Td>{b.farmer.name}{b.farmer.fpoName && <span className="block text-xs text-slate-500">{b.farmer.fpoName}</span>}</Td>
                <Td>{[b.farmer.district, b.farmer.state].filter(Boolean).join(', ') || '—'}</Td>
                <Td className="tabular-nums whitespace-nowrap" title="Unlocks on the order after you accept">{b.farmer.phoneMasked}</Td>
                <Td className="tabular-nums whitespace-nowrap font-medium">{formatINR(b.pricePaisePerKg)}/kg</Td>
                <Td className="whitespace-nowrap text-slate-600">{vsTarget(b.pricePaisePerKg, rfq.targetPricePaisePerKg)}</Td>
                <Td className="whitespace-nowrap"><Money paise={lineTotalPaise(b.quantityKg, b.pricePaisePerKg)} /></Td>
                <Td><StateBadge state={b.state} /></Td>
                <Td className="text-right">
                  {b.state === 'SUBMITTED' && rfq.state === 'BIDDING' && (
                    <Button size="sm" disabled={!kybVerified} onClick={() => { accept.clearError(); setAccepting(b); }}>Accept</Button>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
        <p className="text-xs text-slate-500">Farmer phone numbers stay masked until you accept a bid and the order is created.</p>
      </section>

      <ContractDialog open={!!accepting} title="Accept bid" confirmLabel="Accept bid and create order" busy={accept.busy} error={accept.error} onConfirm={confirmAccept} onClose={() => setAccepting(null)}>
        {accepting && (
          <dl className="grid gap-x-8 rounded-md border border-slate-200 px-3 py-1 sm:grid-cols-2">
            <Fact label="Farmer">{accepting.farmer.name}</Fact>
            <Fact label="Produce">{rfq.commodity.name}, {rfq.grade.name}</Fact>
            <Fact label="Volume">{formatTonnes(accepting.quantityKg)}</Fact>
            <Fact label="Price"><span className="tabular-nums">{formatINR(accepting.pricePaisePerKg)}/kg</span></Fact>
            <Fact label="Order value"><Money paise={lineTotalPaise(accepting.quantityKg, accepting.pricePaisePerKg)} /></Fact>
            <Fact label="Delivery PIN"><span className="tabular-nums">{rfq.deliveryPin}</span></Fact>
          </dl>
        )}
      </ContractDialog>

      <Modal open={cancelling} title={`Cancel ${rfq.code}?`} onClose={() => setCancelling(false)}>
        <p className="mb-3 text-sm text-slate-700">Farmers can no longer bid and any bids on it close. This cannot be undone.</p>
        <FormError message={cancel.error} />
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="secondary" disabled={cancel.busy} onClick={() => setCancelling(false)}>Keep RFQ</Button>
          <Button variant="danger" disabled={cancel.busy} onClick={confirmCancel}>{cancel.busy ? 'Cancelling' : 'Cancel RFQ'}</Button>
        </div>
      </Modal>
    </div>
  );
}

function Inbox() {
  const params = useSearchParams();
  const router = useRouter();
  const rfqs = useResource(() => api.get<RfqView[]>('/rfqs'), [], { pollMs: 30_000 });
  const selectedId = params.get('rfq') ?? rfqs.data?.[0]?.id;
  const selected = rfqs.data?.find((r) => r.id === selectedId);

  return (
    <>
      <PageHeader title="RFQs and bids" actions={<LinkButton href="/rfqs/new">Post RFQ</LinkButton>} />
      {rfqs.error && <div className="mb-4"><ErrorState message={rfqs.error} onRetry={() => void rfqs.reload()} /></div>}
      {rfqs.loading && !rfqs.data && <div className="grid gap-5 lg:grid-cols-[20rem_1fr]"><CardSkeleton lines={6} /><CardSkeleton lines={6} /></div>}
      {rfqs.data?.length === 0 && <EmptyState title="You have not posted any RFQs">Post an RFQ to start getting bids from farmers.</EmptyState>}
      {!!rfqs.data?.length && (
        <div className="grid items-start gap-5 lg:grid-cols-[20rem_1fr]">
          <nav aria-label="Your RFQs" className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white">
            {rfqs.data.map((r) => (
              <button
                key={r.id}
                type="button"
                aria-current={r.id === selectedId ? 'true' : undefined}
                onClick={() => router.replace(`/rfqs?rfq=${r.id}`, { scroll: false })}
                className={cn('block w-full px-3 py-2.5 text-left text-sm hover:bg-slate-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-emerald-700', r.id === selectedId && 'bg-emerald-50 hover:bg-emerald-50')}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-medium text-slate-900">{r.commodity.name}, {r.grade.name}</span>
                  <StateBadge state={r.state} />
                </span>
                <span className="mt-0.5 flex items-center justify-between gap-2 text-xs text-slate-600">
                  <span>{r.code} · {formatTonnes(r.quantityKg)}</span>
                  <span>{r.bidCount === 1 ? '1 bid' : `${r.bidCount} bids`}</span>
                </span>
              </button>
            ))}
          </nav>
          {selected ? <RfqDetail key={selected.id} rfq={selected} onChanged={() => void rfqs.reload()} /> : <EmptyState title="RFQ not found">Choose an RFQ from the list.</EmptyState>}
        </div>
      )}
    </>
  );
}

export default function RfqsPage() {
  return <Suspense fallback={<CardSkeleton lines={6} />}><Inbox /></Suspense>;
}
