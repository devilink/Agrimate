import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { getPartyMap, partyLabel } from '@/lib/data';
import { dateIN, rupees } from '@/lib/money';
import { STATUS_LABEL, STATUS_ORDER } from '@/lib/orders';
import { ButtonLink, buttonClass, Card, Empty, Notice, PageHeader, StatCard, Table, Td, Badge, statusTone } from '@/components/ui';
import { IconAlert, IconClock, IconPackage, IconRupee, IconShield, IconWallet } from '@/components/icons';
import type { OrderStatus } from '@/lib/types';

export const metadata = { title: 'Overview' };

interface Summary {
  money_in: number; money_out: number; gmv_completed: number; fees_earned: number; fees_pipeline: number;
  receivable: number; farmer_payable_due: number; overpaid_orders: number; stale_orders: number; active_orders: number;
  orders_by_status: Partial<Record<OrderStatus, number>>;
}
interface Due {
  order_id: string; code: string; status: OrderStatus; payee_party_id: string; payee_role: 'farmer' | 'transporter';
  owed: number; paid: number; due: number; updated_at: string;
}

const compact = (paise: number) => {
  const r = Number(paise) / 100;
  if (r >= 1e7) return `₹${(r / 1e7).toFixed(2)} Cr`;
  if (r >= 1e5) return `₹${(r / 1e5).toFixed(2)} L`;
  return rupees(paise);
};

export default async function AdminOverview() {
  await requireAdmin();
  // Finance functions are server-only (secret key); the admin check above is what authorises this.
  const db = adminClient();
  const supabase = await createClient();
  const [{ data: summary, error }, { data: dueRows }, unverified, pendingOffers] = await Promise.all([
    db.rpc('finance_summary'),
    db.rpc('payouts_due', { p_limit: 100 }),
    supabase.from('parties').select('id', { count: 'exact', head: true }).eq('verified', false).eq('active', true),
    supabase.from('offers').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
  ]);
  if (error) {
    console.error('[admin overview]', error);
    return (
      <>
        <PageHeader title="Overview" />
        <Notice tone="red">The finance figures could not be loaded. Has <code>supabase/migrations/0002_marketplace_depth.sql</code> been run?</Notice>
      </>
    );
  }
  const s = summary as Summary;
  const due = (dueRows ?? []) as Due[];
  const parties = await getPartyMap(due.map((d) => d.payee_party_id));
  const held = Number(s.money_in) - Number(s.money_out);

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Overview"
        subtitle="Money held, owed and earned across every order, and who is waiting to be paid."
        action={<><ButtonLink href="/admin/payments" variant="secondary"><IconWallet />Payments ledger</ButtonLink><a href="/admin/payments/export" className={buttonClass('primary')}>Export payments CSV</a></>}
      />
      {Number(s.overpaid_orders) > 0 && (
        <Notice tone="red"><span className="font-semibold">{s.overpaid_orders} order{s.overpaid_orders === 1 ? ' has' : 's have'} been overpaid.</span> Look for &quot;OVERPAID&quot; in the order timelines and refund the excess.</Notice>
      )}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Money held" value={compact(held)} icon={<IconWallet />} hint={`${compact(s.money_in)} in · ${compact(s.money_out)} paid out`} />
        <StatCard label="Buyers still owe" value={compact(s.receivable)} icon={<IconRupee />} tone="amber" hint="Goods + freight, not yet received" />
        <StatCard label="Farmer payouts due" value={compact(s.farmer_payable_due)} icon={<IconPackage />} tone="red" hint="Delivered or completed orders" />
        <StatCard label="Platform fees earned" value={compact(s.fees_earned)} icon={<IconShield />} tone="blue" hint={`${compact(s.fees_pipeline)} more on open orders`} />
      </div>
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Completed trade value" value={compact(s.gmv_completed)} icon={<IconRupee />} />
        <StatCard label="Active orders" value={s.active_orders} href="/orders" icon={<IconPackage />} />
        <StatCard label="No update for 7+ days" value={s.stale_orders} href="/orders" icon={<IconClock />} tone="amber" hint="Active orders to chase" />
        <StatCard label="Waiting for you" value={(unverified.count ?? 0) + (pendingOffers.count ?? 0)} icon={<IconAlert />} tone="red"
          hint={`${unverified.count ?? 0} to verify · ${pendingOffers.count ?? 0} open offers`} href="/admin/offers" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Payouts queue" description="Oldest first. Pay by bank or UPI, then record the payout with its UTR on the order." icon={<IconWallet />} padded={false}>
          {due.length === 0 ? <div className="px-6 pb-6"><Empty>Nobody is waiting to be paid.</Empty></div> : (
            <div className="px-5 sm:px-6">
              <Table head={['Order', 'Pay', 'Role', 'Owed', 'Paid', 'Due', 'Since']}>
                {due.map((d) => (
                  <tr key={`${d.order_id}-${d.payee_role}`}>
                    <Td><Link href={`/orders/${d.order_id}`} className="font-mono text-[0.8125rem] font-semibold text-brand-700 hover:underline">{d.code}</Link><div><Badge tone={statusTone(d.status)}>{STATUS_LABEL[d.status]}</Badge></div></Td>
                    <Td className="max-w-[12rem] truncate"><Link href={`/admin/parties/${d.payee_party_id}`} className="hover:text-brand-700 hover:underline">{partyLabel(parties.get(d.payee_party_id))}</Link></Td>
                    <Td className="capitalize">{d.payee_role}</Td>
                    <Td className="tabular-nums">{rupees(d.owed)}</Td>
                    <Td className="tabular-nums text-stone-500">{rupees(d.paid)}</Td>
                    <Td className="font-semibold tabular-nums text-stone-900">{rupees(d.due)}</Td>
                    <Td className="text-stone-500">{dateIN(d.updated_at)}</Td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
        </Card>
        <Card title="Orders by status" icon={<IconPackage />}>
          <ul className="space-y-2 text-sm">
            {STATUS_ORDER.map((st) => (
              <li key={st}>
                <Link href={`/orders?status=${st}`} className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-stone-50">
                  <Badge tone={statusTone(st)} dot>{STATUS_LABEL[st]}</Badge>
                  <span className="font-semibold tabular-nums text-stone-900">{s.orders_by_status?.[st] ?? 0}</span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-stone-500">Farmers are listed until paid in full. Transporters are listed with the freight charged to the buyer until their first payout is recorded, since what you pay them may differ.</p>
        </Card>
      </div>
    </>
  );
}
