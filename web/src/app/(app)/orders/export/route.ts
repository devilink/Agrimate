import { type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { csvResponse, toCsv } from '@/lib/csv';
import { STATUS_LABEL, STATUS_ORDER } from '@/lib/orders';
import type { Order, OrderStatus } from '@/lib/types';

export const dynamic = 'force-dynamic';

const CHUNK = 1000;
const MAX_ROWS = 50_000;

/** CSV of orders (optionally one status). Admins only. */
export async function GET(req: NextRequest) {
  await requireAdmin();
  const status = req.nextUrl.searchParams.get('status');
  const supabase = await createClient();

  const orders: Order[] = [];
  for (let from = 0; from < MAX_ROWS; from += CHUNK) {
    let q = supabase.from('orders').select('*').order('created_at', { ascending: false });
    if (STATUS_ORDER.includes(status as OrderStatus)) q = q.eq('status', status);
    const { data, error } = await q.range(from, from + CHUNK - 1);
    if (error) return new Response('Could not export orders.', { status: 500 });
    orders.push(...((data ?? []) as Order[]));
    if (!data || data.length < CHUNK) break;
  }

  const ids = [...new Set(orders.flatMap((o) => [o.buyer_id, o.farmer_id, o.transporter_id].filter(Boolean) as string[]))];
  const names = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from('parties').select('id, name, company').in('id', ids.slice(i, i + 200));
    (data ?? []).forEach((p) => names.set(p.id, p.company || p.name));
  }
  const { data: comm } = await supabase.from('commodities').select('id, name');
  const cname = new Map((comm ?? []).map((c) => [c.id, c.name]));
  const inr = (paise: number) => (Number(paise) / 100).toFixed(2);

  const csv = toCsv(
    ['Order', 'Created', 'Status', 'Commodity', 'Grade', 'Quantity (kg)', 'Price (INR/kg)', 'Goods (INR)', 'Platform fee %',
      'Freight (INR)', 'Buyer', 'Farmer', 'Transporter', 'Pickup', 'Delivery', 'Expected date', 'Received (kg)'],
    orders.map((o) => [
      o.code, o.created_at.slice(0, 10), STATUS_LABEL[o.status], cname.get(o.commodity_id) ?? '', o.grade, o.quantity_kg,
      inr(o.price_paise_per_kg), inr(o.goods_paise), (o.commission_bps / 100).toFixed(2), inr(o.freight_paise),
      names.get(o.buyer_id), names.get(o.farmer_id), o.transporter_id ? names.get(o.transporter_id) : '',
      o.pickup_location, o.delivery_location, o.expected_date, o.received_qty_kg,
    ]),
  );
  const stamp = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  return csvResponse(`agrimate-orders-${stamp}.csv`, csv);
}
