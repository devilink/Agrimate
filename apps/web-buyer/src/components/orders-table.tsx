'use client';
import type { OrderListItem } from '@agrimate/api-client';
import { formatIST, formatTonnes } from '@agrimate/shared';
import { Badge, Countdown, Money, StateBadge, Table, Td } from '@agrimate/ui';
import Link from 'next/link';
import { isActiveOrder, nextStep, outstandingPaise } from '@/lib/order-state';

/** The SLA only runs until delivery, so a countdown would mislead after that. */
const PAST_SLA = ['DELIVERED', 'DISPUTE_WINDOW', 'DISPUTED', 'RESOLVED'];

export const ACTIVE_ORDER_HEAD = ['Order', 'Produce', 'Quantity', 'Value', 'In escrow', 'Due now', 'SLA ends in', 'State', 'Next step'];

export function OrderCode({ order }: { order: Pick<OrderListItem, 'id' | 'code'> }) {
  return <Link href={`/orders/${order.id}`} className="font-medium text-emerald-800 underline-offset-2 hover:underline">{order.code}</Link>;
}

export const Produce = ({ o }: { o: OrderListItem }) => (
  <span className="inline-flex flex-wrap items-center gap-1.5">
    {o.commodity}, {o.grade}
    {o.isOrganic && <Badge tone="green">Organic</Badge>}
  </span>
);

/** Live orders with money and SLA. `escrow` maps order id to its escrow balance; a missing entry shows as a dash. */
export function ActiveOrdersTable({ orders, escrow }: { orders: OrderListItem[]; escrow: Record<string, string | undefined> }) {
  return (
    <Table head={ACTIVE_ORDER_HEAD}>
      {orders.map((o) => (
        <tr key={o.id}>
          <Td><OrderCode order={o} /></Td>
          <Td><Produce o={o} /></Td>
          <Td className="tabular-nums whitespace-nowrap">{formatTonnes(o.quantityKg)}</Td>
          <Td className="whitespace-nowrap"><Money paise={o.gmvPaise} /></Td>
          <Td className="whitespace-nowrap"><Money paise={escrow[o.id]} /></Td>
          <Td className="whitespace-nowrap"><Money paise={outstandingPaise(o)} /></Td>
          <Td className="whitespace-nowrap">{PAST_SLA.includes(o.state) ? 'Delivered' : <Countdown to={o.slaDeadlineAt} />}</Td>
          <Td><StateBadge state={o.state} /></Td>
          <Td className="text-slate-700">{nextStep(o)}</Td>
        </tr>
      ))}
    </Table>
  );
}

export const HISTORY_HEAD = ['Order', 'Produce', 'Flow', 'Quantity', 'Value', 'Placed', 'SLA ends in', 'State'];

export function OrderHistoryTable({ orders }: { orders: OrderListItem[] }) {
  return (
    <Table head={HISTORY_HEAD}>
      {orders.map((o) => (
        <tr key={o.id}>
          <Td><OrderCode order={o} /></Td>
          <Td><Produce o={o} /></Td>
          <Td>{o.flow === 'RFQ' ? 'RFQ' : 'Catalog'}</Td>
          <Td className="tabular-nums whitespace-nowrap">{formatTonnes(o.quantityKg)}</Td>
          <Td className="whitespace-nowrap"><Money paise={o.gmvPaise} /></Td>
          <Td className="whitespace-nowrap">{formatIST(o.createdAt)}</Td>
          <Td className="whitespace-nowrap">{!isActiveOrder(o.state) ? 'Closed' : PAST_SLA.includes(o.state) ? 'Delivered' : <Countdown to={o.slaDeadlineAt} />}</Td>
          <Td><StateBadge state={o.state} /></Td>
        </tr>
      ))}
    </Table>
  );
}
