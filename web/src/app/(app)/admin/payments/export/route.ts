import { type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { csvResponse, toCsv } from '@/lib/csv';
import { filterLedger, parseLedgerFilters } from '@/lib/ledger';
import { PAYMENT_METHOD_LABEL } from '@/lib/orders';
import type { Payment } from '@/lib/types';

export const dynamic = 'force-dynamic';

const CHUNK = 1000;   // the Data API's default row cap per request
const MAX_ROWS = 50_000;

/** CSV of the payments ledger with the same filters as the page. Admins only. */
export async function GET(req: NextRequest) {
  await requireAdmin();
  const f = parseLedgerFilters(Object.fromEntries(req.nextUrl.searchParams));
  const supabase = await createClient();

  const payments: Payment[] = [];
  for (let from = 0; from < MAX_ROWS; from += CHUNK) {
    const { data, error } = await filterLedger(supabase.from('payments').select('*'), f).range(from, from + CHUNK - 1);
    if (error) return new Response('Could not export payments.', { status: 500 });
    payments.push(...((data ?? []) as Payment[]));
    if (!data || data.length < CHUNK) break;
  }

  const orderIds = [...new Set(payments.map((p) => p.order_id))];
  const partyIds = new Set<string>();
  const orders = new Map<string, { code: string; buyer_id: string }>();
  for (let i = 0; i < orderIds.length; i += 200) {
    const { data } = await supabase.from('orders').select('id, code, buyer_id').in('id', orderIds.slice(i, i + 200));
    (data ?? []).forEach((o) => { orders.set(o.id, o); partyIds.add(o.buyer_id); });
  }
  payments.forEach((p) => { if (p.payee_party_id) partyIds.add(p.payee_party_id); });
  const names = new Map<string, string>();
  const ids = [...partyIds];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from('parties').select('id, name, company').in('id', ids.slice(i, i + 200));
    (data ?? []).forEach((p) => names.set(p.id, p.company || p.name));
  }

  const csv = toCsv(
    ['Date', 'Order', 'Direction', 'Party', 'Method', 'Reference', 'Amount (INR)', 'Status', 'Note', 'Recorded at'],
    payments.map((p) => {
      const o = orders.get(p.order_id);
      return [
        p.paid_on, o?.code ?? p.order_id, p.direction === 'in' ? 'Received' : 'Paid out',
        names.get(p.direction === 'in' ? o?.buyer_id ?? '' : p.payee_party_id ?? '') ?? '',
        PAYMENT_METHOD_LABEL[p.method], p.reference, (Number(p.amount_paise) / 100).toFixed(2), p.status, p.note, p.created_at,
      ];
    }),
  );
  const stamp = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  return csvResponse(`agrimate-payments-${stamp}.csv`, csv);
}
