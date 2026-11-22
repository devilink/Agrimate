import Link from 'next/link';
import { requireViewer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getCommodities } from '@/lib/data';
import { dateIN, kg, rupees } from '@/lib/money';
import { STATUS_LABEL } from '@/lib/orders';
import { Badge, ButtonLink, Card, Empty, Notice, PageHeader, StatCard, statusTone } from '@/components/ui';
import { IconAlert, IconArrowRight, IconChevronRight, IconHandshake, IconPackage, IconPlus, IconShield, IconStore, IconTruck } from '@/components/icons';
import type { Offer, Order } from '@/lib/types';

export const metadata = { title: 'Dashboard' };

const ACTIVE = ['confirmed', 'quality_check', 'ready', 'in_transit', 'delivered', 'disputed'];

export default async function Dashboard() {
  const viewer = await requireViewer();
  const supabase = await createClient();
  const type = viewer.party?.type;

  const [{ data: active, count: activeCount }, commodities, { data: pendingOffers }] = await Promise.all([
    supabase.from('orders').select('*', { count: 'exact' }).in('status', ACTIVE).order('updated_at', { ascending: false }).limit(10),
    getCommodities(true),
    // RLS limits this to offers the viewer made or received (admins: all).
    viewer.party
      ? supabase.from('offers').select('*').eq('status', 'pending').neq('last_by', viewer.party.id).order('created_at', { ascending: false }).limit(50)
      : Promise.resolve({ data: [] as Offer[] }),
  ]);
  const orders = (active ?? []) as Order[];
  const cname = new Map(commodities.map((c) => [c.id, c.name]));
  const toAnswer = (pendingOffers ?? []) as Offer[];

  // Small counters that tell each role what needs attention.
  type Stat = { label: string; value: number; href?: string; icon: React.ReactNode; tone?: 'green' | 'amber' | 'red' | 'blue'; hint?: string };
  const stats: Stat[] = [{ label: 'Active orders', value: activeCount ?? orders.length, href: '/orders', icon: <IconPackage /> }];
  if (viewer.isAdmin) {
    const [unverified, disputed, openOffers] = await Promise.all([
      supabase.from('parties').select('id', { count: 'exact', head: true }).eq('verified', false).eq('active', true),
      supabase.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'disputed'),
      supabase.from('offers').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    ]);
    stats.push(
      { label: 'Accounts to verify', value: unverified.count ?? 0, href: '/admin/parties?verified=no', icon: <IconShield />, tone: 'amber' },
      { label: 'Disputes', value: disputed.count ?? 0, href: '/orders?status=disputed', icon: <IconAlert />, tone: 'red' },
      { label: 'Open offers', value: openOffers.count ?? 0, href: '/admin/offers', icon: <IconHandshake />, tone: 'blue' },
    );
  } else if (type === 'farmer' || type === 'buyer') {
    const table = type === 'farmer' ? 'listings' : 'requirements';
    const owner = type === 'farmer' ? 'farmer_id' : 'buyer_id';
    const { count } = await supabase.from(table).select('id', { count: 'exact', head: true })
      .eq(owner, viewer.party!.id).eq('status', 'open');
    stats.push(
      { label: type === 'farmer' ? 'Open listings' : 'Open requirements', value: count ?? 0, href: type === 'farmer' ? '/listings' : '/requirements', icon: <IconStore />, tone: 'amber' },
      { label: 'Offers to answer', value: toAnswer.length, href: type === 'farmer' ? '/listings' : '/requirements', icon: <IconHandshake />, tone: toAnswer.length ? 'red' : 'blue', hint: 'Waiting for your reply' },
    );
  }

  const hour = Number(new Date().toLocaleString('en-IN', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Kolkata' }));
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const showMoney = viewer.isAdmin || type === 'buyer' || type === 'farmer';

  return (
    <>
      <PageHeader
        eyebrow={new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' })}
        title={`${greeting}${viewer.party ? `, ${viewer.party.name.split(' ')[0]}` : ''}`}
        subtitle={viewer.isAdmin ? 'Here is what needs the team’s attention.' : 'Here is where your trades stand today.'}
        action={
          <>
            {(viewer.isAdmin || type === 'farmer') && <ButtonLink href="/listings/new"><IconPlus />List produce</ButtonLink>}
            {(viewer.isAdmin || type === 'buyer') && <ButtonLink href="/requirements/new" variant="secondary"><IconPlus />Post a requirement</ButtonLink>}
          </>
        }
      />
      {viewer.party && !viewer.party.verified && (
        <Notice>
          <span className="font-semibold">Our team is verifying your account.</span> Meanwhile, add your GSTIN/PAN and bank details on your{' '}
          <Link href="/account" className="font-medium underline underline-offset-2">account page</Link> to speed it up.
        </Notice>
      )}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((st) => <StatCard key={st.label} label={st.label} value={st.value} href={st.href} icon={st.icon} tone={st.tone} hint={st.hint} />)}
      </div>
      {toAnswer.length > 0 && (
        <Card title="Offers waiting for your reply" icon={<IconHandshake />} className="mb-8 ring-2 ring-harvest-400/30"
          description="Accept, counter or decline. The other side is waiting on you.">
          <ul className="-mx-5 divide-y divide-stone-100 sm:-mx-6">
            {toAnswer.slice(0, 6).map((o) => (
              <li key={o.id}>
                <Link href={o.listing_id ? `/listings/${o.listing_id}` : `/requirements/${o.requirement_id}`}
                  className="group flex items-center gap-4 px-5 py-3 transition-colors hover:bg-stone-50 sm:px-6">
                  <div className="min-w-0 flex-1 text-sm">
                    <div className="font-semibold text-stone-900">{o.counters > 0 ? 'Counter-offer' : 'New offer'}: {kg(o.quantity_kg)} at {rupees(o.price_paise_per_kg)}/kg</div>
                    <div className="text-stone-500">Worth {rupees(o.quantity_kg * Number(o.price_paise_per_kg))} · {dateIN(o.created_at)}</div>
                  </div>
                  <IconChevronRight className="size-4 shrink-0 text-stone-300 group-hover:text-stone-500" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card
        title="Orders in progress"
        description={orders.length ? 'Most recently updated first' : undefined}
        icon={type === 'transporter' ? <IconTruck /> : <IconPackage />}
        action={orders.length ? <Link href="/orders" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:text-brand-900">All orders <IconArrowRight className="size-4" /></Link> : undefined}
      >
        {orders.length === 0 ? (
          <Empty
            icon={type === 'transporter' || type === 'inspector' ? <IconTruck /> : <IconStore />}
            action={type === 'transporter' || type === 'inspector' ? undefined : <ButtonLink href="/market" variant="secondary" small>Browse the market</ButtonLink>}
          >
            {type === 'transporter' || type === 'inspector'
              ? 'No jobs assigned to you right now. New jobs show up here as soon as the team assigns them.'
              : 'Nothing in progress yet. Find produce or buyers on the market to start a deal.'}
          </Empty>
        ) : (
          <ul className="-mx-5 divide-y divide-stone-100 sm:-mx-6">
            {orders.map((o) => (
              <li key={o.id}>
                <Link href={`/orders/${o.id}`} className="group flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-stone-50 sm:px-6">
                  <span className="hidden size-10 shrink-0 place-items-center rounded-xl bg-brand-50 font-display text-sm font-semibold text-brand-700 sm:grid">
                    {(cname.get(o.commodity_id) ?? '?').slice(0, 2)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-semibold text-stone-900">{cname.get(o.commodity_id)}</span>
                      <span className="font-mono text-xs text-stone-500">{o.code}</span>
                    </div>
                    <div className="mt-0.5 text-sm text-stone-600">
                      {kg(o.quantity_kg)}
                      {showMoney && <> · <span className="tabular-nums">{rupees(o.goods_paise)}</span></>}
                      <span className="text-stone-400"> · {dateIN(o.expected_date ?? o.created_at)}</span>
                    </div>
                  </div>
                  <Badge tone={statusTone(o.status)} dot>{STATUS_LABEL[o.status]}</Badge>
                  <IconChevronRight className="size-4 shrink-0 text-stone-300 transition-transform group-hover:translate-x-0.5 group-hover:text-stone-500" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
