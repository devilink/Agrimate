import Link from 'next/link';
import { requireViewer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getCommodities, getPartyMap, partyLabel } from '@/lib/data';
import { dateIN, kg, rupees } from '@/lib/money';
import { STATUS_LABEL, STATUS_ORDER } from '@/lib/orders';
import { Badge, ButtonLink, Card, Empty, FilterPills, PageHeader, Table, Td, statusTone } from '@/components/ui';
import { IconChevronRight, IconPackage, IconPlus, IconTruck } from '@/components/icons';
import type { Order, OrderStatus } from '@/lib/types';

export const metadata = { title: 'Orders' };

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const viewer = await requireViewer();
  const { status } = await searchParams;
  const supabase = await createClient();
  // Row-level security already limits this to orders the viewer is part of (admins see all).
  let q = supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(200);
  if (STATUS_ORDER.includes(status as OrderStatus)) q = q.eq('status', status);
  const { data } = await q;
  const orders = (data ?? []) as Order[];
  const [parties, commodities] = await Promise.all([
    getPartyMap(orders.flatMap((o) => [o.buyer_id, o.farmer_id])),
    getCommodities(true),
  ]);
  const cname = new Map(commodities.map((c) => [c.id, c.name]));
  const jobsOnly = !viewer.isAdmin && (viewer.party?.type === 'transporter' || viewer.party?.type === 'inspector');

  const active = STATUS_ORDER.includes(status as OrderStatus) ? status : undefined;

  return (
    <>
      <PageHeader
        title={jobsOnly ? 'My jobs' : 'Orders'}
        subtitle={jobsOnly ? `Orders where you are the assigned ${viewer.party?.type}.` : 'Every deal, from confirmation to completion.'}
        action={viewer.isAdmin ? <ButtonLink href="/admin/orders/new"><IconPlus />Enter an offline order</ButtonLink> : undefined}
      />
      <FilterPills
        label="Filter by status"
        items={[
          { href: '/orders', label: 'All', active: !active },
          ...STATUS_ORDER.map((s) => ({ href: `/orders?status=${s}`, label: STATUS_LABEL[s], active: active === s })),
        ]}
      />
      {orders.length === 0 ? (
        <Empty icon={jobsOnly ? <IconTruck /> : <IconPackage />}>
          {active ? `No orders are “${STATUS_LABEL[active as OrderStatus]}” right now.` : jobsOnly ? 'No jobs assigned to you yet.' : 'No orders yet. Accepted offers show up here.'}
        </Empty>
      ) : (
        <>
          {/* Phones: one card per order */}
          <ul className="space-y-3 md:hidden">
            {orders.map((o) => (
              <li key={o.id}>
                <Link href={`/orders/${o.id}`} className="block rounded-2xl border border-stone-200/80 bg-white p-4 shadow-card active:bg-stone-50">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-stone-900">{cname.get(o.commodity_id)}{o.grade && <span className="font-normal text-stone-500"> · {o.grade}</span>}</div>
                      <div className="font-mono text-xs text-stone-500">{o.code}</div>
                    </div>
                    <Badge tone={statusTone(o.status)} dot>{STATUS_LABEL[o.status]}</Badge>
                  </div>
                  <div className="mt-3 flex items-end justify-between gap-3 text-sm">
                    <div className="min-w-0 text-stone-600">
                      <div className="truncate">{partyLabel(parties.get(o.buyer_id))}</div>
                      <div className="truncate text-stone-500">from {partyLabel(parties.get(o.farmer_id))}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      {!jobsOnly && <div className="font-semibold tabular-nums text-stone-900">{rupees(o.goods_paise)}</div>}
                      <div className="text-xs text-stone-500">{kg(o.quantity_kg)} · {dateIN(o.created_at)}</div>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          {/* Larger screens: a table */}
          <Card className="hidden md:block" padded={false}>
            <div className="px-5 sm:px-6">
              {/* Transporters and inspectors don't see deal prices (same rule as the order page). */}
              <Table head={['Order', 'Commodity', 'Quantity', ...(jobsOnly ? [] : ['Value']), 'Buyer', 'Farmer', 'Status', 'Date', '']}>
                {orders.map((o) => (
                  <tr key={o.id} className="group">
                    <Td><Link href={`/orders/${o.id}`} className="font-mono text-[0.8125rem] font-semibold text-brand-700 hover:text-brand-900 hover:underline">{o.code}</Link></Td>
                    <Td><span className="font-medium text-stone-900">{cname.get(o.commodity_id)}</span>{o.grade && <span className="text-stone-500"> · {o.grade}</span>}</Td>
                    <Td className="tabular-nums">{kg(o.quantity_kg)}</Td>
                    {!jobsOnly && <Td className="font-medium tabular-nums text-stone-900">{rupees(o.goods_paise)}</Td>}
                    <Td className="max-w-[12rem] truncate">{partyLabel(parties.get(o.buyer_id))}</Td>
                    <Td className="max-w-[12rem] truncate">{partyLabel(parties.get(o.farmer_id))}</Td>
                    <Td><Badge tone={statusTone(o.status)} dot>{STATUS_LABEL[o.status]}</Badge></Td>
                    <Td className="text-stone-500">{dateIN(o.created_at)}</Td>
                    <Td><Link href={`/orders/${o.id}`} aria-label={`Open ${o.code}`} className="text-stone-300 group-hover:text-brand-700"><IconChevronRight className="size-4" /></Link></Td>
                  </tr>
                ))}
              </Table>
            </div>
          </Card>
        </>
      )}
    </>
  );
}
