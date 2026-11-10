'use client';
import type { BuyerOrder, OrderEventView } from '@agrimate/api-client';
import { ApiError } from '@agrimate/api-client';
import { formatTonnes } from '@agrimate/shared';
import { Alert, Badge, Button, Field, StateBadge, Textarea } from '@agrimate/ui';
import { use, useState } from 'react';
import { CardSkeleton, ErrorState, FormError, LinkButton, Modal } from '@/components/common';
import { api } from '@/lib/api';
import { useAction, useResource } from '@/lib/hooks';
import { isActiveOrder, nextStep } from '@/lib/order-state';
import { DeliveryCard } from './delivery-card';
import { DisputeCard } from './dispute-card';
import { InspectionCard } from './inspection-card';
import { LogisticsCard } from './logistics-card';
import { PaymentCard } from './payment-card';
import { ContractCard, InvoicesCard, OrderFactsCard, PartiesCard } from './rail-cards';
import { SpotTestCard } from './spot-test-card';
import { Timeline } from './timeline';

interface Loaded { order: BuyerOrder; events: OrderEventView[] | null }

const CANCELLABLE = ['MATCHED', 'AWAITING_ADVANCE'];

function CancelOrder({ order, onDone }: { order: BuyerOrder; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const { busy, error, run } = useAction();
  const submit = () => void run(async () => {
    await api.post(`/orders/${order.id}/cancel`, { reason: reason.trim() });
    setOpen(false);
    onDone();
  });
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>Cancel order</Button>
      <Modal open={open} title={`Cancel ${order.code}?`} onClose={() => setOpen(false)}>
        <div className="space-y-3">
          <Field label="Reason"><Textarea value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)} /></Field>
          <FormError message={error} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>Keep order</Button>
            <Button variant="danger" disabled={busy || reason.trim().length < 3} onClick={submit}>{busy ? 'Cancelling' : 'Cancel order'}</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const r = useResource<Loaded>(async () => {
    const [order, events] = await Promise.all([
      api.get<BuyerOrder>(`/orders/${id}`),
      // The timeline falls back to the current state if the event log cannot be read.
      api.get<OrderEventView[]>(`/orders/${id}/events`).catch((e) => { if (e instanceof ApiError && e.status >= 500) return null; throw e; }),
    ]);
    return { order, events };
  }, [id], { pollMs: 30_000 });

  if (r.loading && !r.data) {
    return (
      <div className="grid gap-5 xl:grid-cols-[1fr_21rem]" aria-busy="true">
        <div className="space-y-4"><CardSkeleton lines={2} /><CardSkeleton lines={5} /><CardSkeleton lines={5} /></div>
        <CardSkeleton lines={10} />
      </div>
    );
  }
  if (!r.data) {
    return (
      <div className="space-y-4">
        <ErrorState message={r.error ?? 'This order could not be loaded.'} onRetry={() => void r.reload()} />
        <LinkButton href="/orders" variant="secondary">Back to orders</LinkButton>
      </div>
    );
  }

  const { order, events } = r.data;
  const reload = () => r.reload();
  const active = isActiveOrder(order.state);
  const qualityVisible = !!order.inspection || !!order.selfCert || order.selfCertRequired;
  const deliveryVisible = ['INSPECTED', 'SELF_CERTIFIED', 'IN_TRANSIT', 'DELIVERED', 'DISPUTE_WINDOW', 'DISPUTED', 'RESOLVED', 'SETTLED', 'REFUNDED'].includes(order.state) && !!order.logisticsMode;
  const disputeVisible = !!order.deliveredAt || !!order.disputeDeadlineAt || order.disputes.length > 0;
  const spotVisible = order.isOrganic && (disputeVisible || order.spotTests.length > 0);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-slate-900">{order.code}</h1>
            <StateBadge state={order.state} />
            {order.isOrganic && <Badge tone="green">Organic</Badge>}
            {order.selfCertifiedBadge && <Badge tone="amber">Self-certified</Badge>}
          </div>
          <p className="mt-1 text-sm text-slate-600">{order.commodity.name}, {order.grade.name} · {formatTonnes(order.quantityKg)} · {order.flow === 'RFQ' ? 'From RFQ' : 'From catalog'}</p>
        </div>
        {CANCELLABLE.includes(order.state) && <CancelOrder order={order} onDone={() => void reload()} />}
      </header>

      {r.error && <ErrorState message={`Showing the last loaded data. ${r.error}`} onRetry={() => void reload()} />}
      {active && <Alert tone="blue"><strong className="font-medium">Next step:</strong> {nextStep(order)}.</Alert>}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="min-w-0 space-y-4">
          <PaymentCard order={order} onChanged={reload} />
          <LogisticsCard order={order} onChanged={reload} />
          {qualityVisible && <InspectionCard order={order} onChanged={reload} />}
          {deliveryVisible && <DeliveryCard order={order} events={events} onChanged={reload} />}
          {disputeVisible && <DisputeCard order={order} onChanged={reload} />}
          {spotVisible && <SpotTestCard order={order} onChanged={reload} />}
        </div>
        <div className="min-w-0 space-y-4">
          <Timeline order={order} events={events} />
          <PartiesCard order={order} />
          <OrderFactsCard order={order} />
          <InvoicesCard order={order} />
          <ContractCard order={order} />
        </div>
      </div>
    </div>
  );
}
