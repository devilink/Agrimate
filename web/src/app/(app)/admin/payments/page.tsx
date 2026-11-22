import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getPartyMap, partyLabel } from '@/lib/data';
import { dateIN, rupees } from '@/lib/money';
import { PAYMENT_METHOD_LABEL } from '@/lib/orders';
import { filterLedger, parseLedgerFilters } from '@/lib/ledger';
import { Badge, Card, Empty, Input, PageHeader, Select, Table, Td, buttonClass, cx } from '@/components/ui';
import { IconWallet } from '@/components/icons';
import type { Payment } from '@/lib/types';

export const metadata = { title: 'Payments' };

const PAGE = 50;

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const f = parseLedgerFilters(sp);
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);
  const supabase = await createClient();
  const { data, count } = await filterLedger(supabase.from('payments').select('*', { count: 'exact' }), f)
    .range((page - 1) * PAGE, page * PAGE - 1);
  const payments = (data ?? []) as Payment[];
  const orderIds = [...new Set(payments.map((p) => p.order_id))];
  const [{ data: orderRows }, parties] = await Promise.all([
    orderIds.length ? supabase.from('orders').select('id, code, buyer_id').in('id', orderIds) : Promise.resolve({ data: [] as { id: string; code: string; buyer_id: string }[] }),
    getPartyMap(payments.map((p) => p.payee_party_id)),
  ]);
  const orders = new Map((orderRows ?? []).map((o) => [o.id, o]));
  const buyers = await getPartyMap([...orders.values()].map((o) => o.buyer_id));
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const pageIn = payments.filter((p) => p.status === 'confirmed' && p.direction === 'in').reduce((s, p) => s + Number(p.amount_paise), 0);
  const pageOut = payments.filter((p) => p.status === 'confirmed' && p.direction === 'out').reduce((s, p) => s + Number(p.amount_paise), 0);

  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    Object.entries({ ...f, ...patch }).forEach(([k, v]) => { if (v) p.set(k, String(v)); });
    return p.toString();
  };

  return (
    <>
      <PageHeader
        title="Payments"
        subtitle="Every payment in and payout out, online and offline. Match these to your bank statement by UTR."
        back={{ href: '/admin', label: 'Overview' }}
        action={<a href={`/admin/payments/export?${qs({})}`} className={buttonClass('secondary')}>Export CSV</a>}
      />
      <form className="mb-6 grid gap-2 rounded-2xl border border-stone-200/80 bg-white p-3 shadow-card sm:grid-cols-3 lg:grid-cols-[1fr_1fr_1fr_1fr_1fr_1.3fr_auto]">
        <Select name="direction" defaultValue={f.direction ?? ''} aria-label="Direction">
          <option value="">In and out</option>
          <option value="in">Received from buyers</option>
          <option value="out">Paid out</option>
        </Select>
        <Select name="method" defaultValue={f.method ?? ''} aria-label="Method">
          <option value="">Any method</option>
          {Object.entries(PAYMENT_METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select name="status" defaultValue={f.status ?? ''} aria-label="Status">
          <option value="">Confirmed and void</option>
          <option value="confirmed">Confirmed</option>
          <option value="void">Void</option>
        </Select>
        <Input name="from" type="date" defaultValue={f.from ?? ''} aria-label="From date" />
        <Input name="to" type="date" defaultValue={f.to ?? ''} aria-label="To date" />
        <Input name="ref" defaultValue={f.ref ?? ''} placeholder="UTR / reference" aria-label="Reference" />
        <button className={buttonClass('primary')}>Filter</button>
      </form>

      <Card padded={false} title={`${total.toLocaleString('en-IN')} payment${total === 1 ? '' : 's'}`} icon={<IconWallet />}
        description={payments.length ? `On this page: ${rupees(pageIn)} in · ${rupees(pageOut)} out (confirmed only)` : undefined}>
        {payments.length === 0 ? <div className="px-6 pb-6"><Empty>No payments match these filters.</Empty></div> : (
          <div className="px-5 sm:px-6">
            <Table head={['Date', 'Order', 'Direction', 'Party', 'Method', 'Reference', 'Amount', 'Status']}>
              {payments.map((p) => {
                const o = orders.get(p.order_id);
                return (
                  <tr key={p.id} className={cx(p.status === 'void' && 'opacity-60')}>
                    <Td>{dateIN(p.paid_on)}</Td>
                    <Td>{o ? <Link href={`/orders/${o.id}`} className="font-mono text-[0.8125rem] font-semibold text-brand-700 hover:underline">{o.code}</Link> : '—'}</Td>
                    <Td>{p.direction === 'in' ? <Badge tone="green">in</Badge> : <Badge tone="blue">out</Badge>}</Td>
                    <Td className="max-w-[12rem] truncate">{p.direction === 'in' ? partyLabel(buyers.get(o?.buyer_id ?? '')) : partyLabel(parties.get(p.payee_party_id ?? ''))}</Td>
                    <Td>{PAYMENT_METHOD_LABEL[p.method]}</Td>
                    <Td className="max-w-[10rem] truncate font-mono text-xs">{p.reference ?? '—'}</Td>
                    <Td className={cx('font-semibold tabular-nums', p.status === 'void' ? 'line-through' : 'text-stone-900')}>{p.direction === 'out' ? '− ' : ''}{rupees(p.amount_paise)}</Td>
                    <Td><Badge tone={p.status === 'void' ? 'red' : 'green'}>{p.status}</Badge></Td>
                  </tr>
                );
              })}
            </Table>
          </div>
        )}
      </Card>
      {pages > 1 && (
        <nav aria-label="Pages" className="mt-6 flex items-center justify-between text-sm">
          {page > 1 ? <Link className={buttonClass('secondary', true)} href={`/admin/payments?${qs({ page: String(page - 1) })}`}>← Previous</Link> : <span />}
          <span className="text-stone-500">Page {page} of {pages}</span>
          {page < pages ? <Link className={buttonClass('secondary', true)} href={`/admin/payments?${qs({ page: String(page + 1) })}`}>Next →</Link> : <span />}
        </nav>
      )}
    </>
  );
}
