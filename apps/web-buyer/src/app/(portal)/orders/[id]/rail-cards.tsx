'use client';
/** The right-hand column of the order screen: who, what, and the paperwork. */
import type { BuyerOrder, InvoiceRef, Party } from '@agrimate/api-client';
import { formatINR, formatIST, formatTonnes } from '@agrimate/shared';
import { Button, Card, CardTitle, Countdown, CopyButton, humanise, Money } from '@agrimate/ui';
import { Fact } from '@/components/common';
import { downloadWithAuth } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { formatISTDate } from '@/lib/units';

function PartyRow({ title, party }: { title: string; party: Party }) {
  return (
    <div className="py-2 text-sm first:pt-0 last:pb-0">
      <p className="text-xs text-slate-600">{title}</p>
      <p className="font-medium text-slate-900">{party.name}</p>
      {(party.district || party.state) && <p className="text-xs text-slate-600">{[party.district, party.state].filter(Boolean).join(', ')}</p>}
      <div className="mt-1 flex items-center justify-between gap-2">
        {party.phoneUnlocked ? <a href={`tel:${party.phone}`} className="font-medium text-emerald-800 tabular-nums underline-offset-2 hover:underline">{party.phone}</a> : <span className="text-slate-600 tabular-nums">{party.phone} (locked)</span>}
        {party.phoneUnlocked && <CopyButton value={party.phone} />}
      </div>
    </div>
  );
}

export function PartiesCard({ order }: { order: BuyerOrder }) {
  return (
    <Card className="p-4">
      <CardTitle>Contacts</CardTitle>
      <div className="divide-y divide-slate-100">
        <PartyRow title="Farmer" party={order.farmer} />
        <PartyRow title="Your business" party={order.buyer} />
      </div>
    </Card>
  );
}

export function OrderFactsCard({ order }: { order: BuyerOrder }) {
  return (
    <Card className="p-4">
      <CardTitle>Order</CardTitle>
      <dl className="divide-y divide-slate-100">
        <Fact label="Quantity">{formatTonnes(order.quantityKg)}</Fact>
        <Fact label="Price"><span className="tabular-nums">{formatINR(order.pricePaisePerKg)}/kg</span></Fact>
        <Fact label="Order value"><Money paise={order.gmvPaise} /></Fact>
        <Fact label="Advance share"><span className="tabular-nums">{order.advanceBps / 100}%</span></Fact>
        <Fact label="Inspection fee"><Money paise={order.inspectionFeePaise} /> <span className="font-normal text-slate-600">paid by {humanise(order.inspectionFeePayer).toLowerCase()}</span></Fact>
        <Fact label="Pickup PIN"><span className="tabular-nums">{order.pickupPin}</span></Fact>
        <Fact label="Delivery PIN"><span className="tabular-nums">{order.deliveryPin}</span></Fact>
        <Fact label="Placed">{formatIST(order.createdAt)}</Fact>
        {order.inspectionDayAt && <Fact label="Inspection day">{formatISTDate(order.inspectionDayAt)}</Fact>}
        <Fact label="SLA deadline">{order.slaDeadlineAt ? formatIST(order.slaDeadlineAt) : `${order.slaDays} days from advance`}</Fact>
        {order.slaDeadlineAt && !order.deliveredAt && !['CANCELLED', 'REFUNDED', 'SETTLED'].includes(order.state) && <Fact label="SLA ends in"><Countdown to={order.slaDeadlineAt} /></Fact>}
        {order.settledAt && <Fact label="Settled">{formatIST(order.settledAt)}</Fact>}
      </dl>
    </Card>
  );
}

function InvoiceRow({ invoice }: { invoice: InvoiceRef }) {
  const { busy, error, run } = useAction();
  return (
    <li className="py-2 text-sm first:pt-0 last:pb-0">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-900">{invoice.number}</p>
          <p className="text-xs text-slate-600">{humanise(invoice.type)} · {formatISTDate(invoice.createdAt)}</p>
        </div>
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => void run(() => downloadWithAuth(`/invoices/${invoice.id}/pdf`, `${invoice.number}.pdf`))}>{busy ? 'Downloading' : 'PDF'}</Button>
      </div>
      {error && <p role="alert" className="mt-1 text-xs text-red-700">{error}</p>}
    </li>
  );
}

export function InvoicesCard({ order }: { order: BuyerOrder }) {
  return (
    <Card className="p-4">
      <CardTitle>Invoices</CardTitle>
      {order.invoices.length === 0 ? <p className="text-sm text-slate-600">Invoices appear after settlement.</p> : (
        <ul className="divide-y divide-slate-100">{order.invoices.map((i) => <InvoiceRow key={i.id} invoice={i} />)}</ul>
      )}
    </Card>
  );
}

export function ContractCard({ order }: { order: BuyerOrder }) {
  return (
    <Card className="p-4">
      <CardTitle>Contract</CardTitle>
      <p className="text-sm text-slate-700">Version {order.contract.version}{order.contract.acceptedAt ? `, accepted ${formatIST(order.contract.acceptedAt)}` : ''}.</p>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer font-medium text-slate-700">Read the terms</summary>
        <div tabIndex={0} className="mt-2 max-h-72 overflow-y-auto rounded-md bg-slate-50 p-2.5 text-xs leading-relaxed whitespace-pre-wrap text-slate-800">{order.contract.body}</div>
      </details>
    </Card>
  );
}
