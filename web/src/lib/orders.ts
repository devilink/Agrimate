import type { Order, OrderStatus, Payment } from '@/lib/types';

export const STATUS_LABEL: Record<OrderStatus, string> = {
  confirmed: 'Confirmed',
  quality_check: 'Quality check',
  ready: 'Ready for dispatch',
  in_transit: 'In transit',
  delivered: 'Delivered',
  completed: 'Completed',
  disputed: 'Disputed',
  cancelled: 'Cancelled',
};

export const STATUS_ORDER: OrderStatus[] = [
  'confirmed', 'quality_check', 'ready', 'in_transit', 'delivered', 'completed', 'disputed', 'cancelled',
];

export const PAYMENT_METHOD_LABEL = {
  razorpay: 'Razorpay (online)',
  bank_transfer: 'Bank transfer (NEFT/RTGS/IMPS)',
  upi: 'UPI',
  cheque: 'Cheque',
  cash: 'Cash',
  other: 'Other',
} as const;

export const DOC_KIND_LABEL = {
  invoice: 'Invoice',
  eway_bill: 'E-way bill',
  weighbridge_slip: 'Weighbridge slip',
  quality_report: 'Quality report',
  photo: 'Photo',
  proof_of_delivery: 'Proof of delivery',
  other: 'Other',
} as const;

export interface Totals {
  goods: number;
  commission: number;
  freight: number;
  buyerTotal: number;     // what the buyer owes: goods + freight
  receivedIn: number;     // confirmed money in from the buyer
  buyerBalance: number;
  farmerPayable: number;  // goods minus platform commission
  paidToFarmer: number;
  paidToTransporter: number;
}

export function orderTotals(order: Order, payments: Payment[]): Totals {
  const live = payments.filter((p) => p.status === 'confirmed');
  const goods = Number(order.goods_paise);
  const commission = Math.round((goods * order.commission_bps) / 10_000);
  const freight = Number(order.freight_paise);
  const receivedIn = sum(live.filter((p) => p.direction === 'in'));
  const paidToFarmer = sum(live.filter((p) => p.direction === 'out' && p.payee_party_id === order.farmer_id));
  const paidToTransporter = sum(
    live.filter((p) => p.direction === 'out' && order.transporter_id && p.payee_party_id === order.transporter_id),
  );
  return {
    goods, commission, freight,
    buyerTotal: goods + freight,
    receivedIn,
    buyerBalance: goods + freight - receivedIn,
    farmerPayable: goods - commission,
    paidToFarmer,
    paidToTransporter,
  };
}

function sum(list: Payment[]): number {
  return list.reduce((acc, p) => acc + Number(p.amount_paise), 0);
}

export type OrderRole = 'admin' | 'buyer' | 'farmer' | 'transporter' | 'inspector';

/** Every role this viewer holds on this order (a party can only be one side, but keep it general). */
export function rolesOn(order: Order, partyId: string | null, isAdmin: boolean): OrderRole[] {
  const roles: OrderRole[] = [];
  if (isAdmin) roles.push('admin');
  if (!partyId) return roles;
  if (order.buyer_id === partyId) roles.push('buyer');
  if (order.farmer_id === partyId) roles.push('farmer');
  if (order.transporter_id === partyId) roles.push('transporter');
  if (order.inspector_id === partyId) roles.push('inspector');
  return roles;
}

export interface Transition { to: OrderStatus; label: string; needsNote?: boolean }

/**
 * The status buttons a party sees. Admins can move an order to any status (real trade has exceptions), always with
 * a note on the timeline. Inspectors move orders through the inspection form instead.
 */
export function transitionsFor(order: Order, roles: OrderRole[]): Transition[] {
  if (roles.includes('admin')) {
    return STATUS_ORDER.filter((s) => s !== order.status).map((s) => ({ to: s, label: STATUS_LABEL[s], needsNote: true }));
  }
  const out: Transition[] = [];
  const s = order.status;
  if (roles.includes('farmer')) {
    const inspectionOk = !order.inspector_id || order.inspection_result === 'pass';
    if (s === 'confirmed' && inspectionOk) out.push({ to: 'ready', label: 'Produce is ready for pickup' });
    if (s === 'ready' && !order.transporter_id) out.push({ to: 'in_transit', label: 'Dispatched (own / buyer transport)' });
  }
  if (roles.includes('transporter')) {
    if (s === 'ready') out.push({ to: 'in_transit', label: 'Picked up' });
    if (s === 'in_transit') out.push({ to: 'delivered', label: 'Delivered' });
  }
  if (roles.includes('buyer')) {
    if (s === 'in_transit') out.push({ to: 'delivered', label: 'Goods received' });
    if (s === 'delivered') {
      out.push({ to: 'completed', label: 'Accept delivery' });
      out.push({ to: 'disputed', label: 'Raise a dispute', needsNote: true });
    }
  }
  // De-duplicate if someone holds two roles.
  return out.filter((t, i) => out.findIndex((u) => u.to === t.to) === i);
}
