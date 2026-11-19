import Link from 'next/link';
import { requireViewer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getCommodities, getPartyMap, partyLabel } from '@/lib/data';
import { dateIN, kg, rupees } from '@/lib/money';
import { ButtonLink, Empty, FilterPills, PageHeader } from '@/components/ui';
import { IconCalendar, IconCheckCircle, IconMapPin, IconPlus, IconSprout, IconStore } from '@/components/icons';
import type { Party } from '@/lib/types';
import type { Listing, Requirement } from '@/lib/types';

export const metadata = { title: 'Market' };

export default async function MarketPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const viewer = await requireViewer();
  const { c } = await searchParams;
  const supabase = await createClient();
  const commodities = await getCommodities();
  const commodityName = new Map(commodities.map((x) => [x.id, x.name]));
  const filter = commodities.some((x) => x.id === c) ? c : undefined;

  let lq = supabase.from('listings').select('*').eq('status', 'open').order('created_at', { ascending: false }).limit(100);
  let rq = supabase.from('requirements').select('*').eq('status', 'open').order('created_at', { ascending: false }).limit(100);
  if (filter) { lq = lq.eq('commodity_id', filter); rq = rq.eq('commodity_id', filter); }
  const [{ data: listings }, { data: requirements }] = await Promise.all([lq, rq]);
  const L = (listings ?? []) as Listing[];
  const R = (requirements ?? []) as Requirement[];
  const parties = await getPartyMap([...L.map((l) => l.farmer_id), ...R.map((r) => r.buyer_id)]);
  const type = viewer.party?.type;

  const href = (id?: string) => (id ? `/market?c=${id}` : '/market');

  return (
    <>
      <PageHeader
        title="Market"
        subtitle="Produce on offer from farmers, and what buyers are looking for."
        action={
          <>
            {(viewer.isAdmin || type === 'farmer') && <ButtonLink href="/listings/new"><IconPlus />List produce</ButtonLink>}
            {(viewer.isAdmin || type === 'buyer') && <ButtonLink href="/requirements/new" variant="secondary"><IconPlus />Post a requirement</ButtonLink>}
          </>
        }
      />
      <FilterPills
        label="Filter by commodity"
        items={[
          { href: href(), label: 'All produce', active: !filter },
          ...commodities.map((x) => ({ href: href(x.id), label: x.name, active: filter === x.id })),
        ]}
      />

      <div className="space-y-12">
        <section>
          <SectionTitle icon={<IconSprout />} title="Produce for sale" count={L.length} />
          {L.length === 0 ? <Empty icon={<IconSprout />}>No open listings{filter ? ' for this commodity' : ''} right now.</Empty> : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {L.map((l) => (
                <PostCard
                  key={l.id}
                  href={`/listings/${l.id}`}
                  code={l.code}
                  commodity={commodityName.get(l.commodity_id)}
                  grade={l.grade}
                  priceLabel="per kg"
                  price={rupees(l.price_paise_per_kg)}
                  quantity={kg(l.quantity_kg)}
                  party={parties.get(l.farmer_id)}
                  place={l.location}
                  dateLabel="Available"
                  date={l.available_from ? dateIN(l.available_from) : 'Now'}
                />
              ))}
            </div>
          )}
        </section>

        <section>
          <SectionTitle icon={<IconStore />} title="Buyer requirements" count={R.length} />
          {R.length === 0 ? <Empty icon={<IconStore />}>No open requirements{filter ? ' for this commodity' : ''} right now.</Empty> : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {R.map((r) => (
                <PostCard
                  key={r.id}
                  href={`/requirements/${r.id}`}
                  code={r.code}
                  commodity={commodityName.get(r.commodity_id)}
                  grade={r.grade}
                  priceLabel={r.target_price_paise_per_kg ? 'target / kg' : 'price'}
                  price={r.target_price_paise_per_kg ? rupees(r.target_price_paise_per_kg) : 'Open'}
                  quantity={kg(r.quantity_kg)}
                  party={parties.get(r.buyer_id)}
                  place={r.delivery_location}
                  dateLabel="Needed by"
                  date={r.needed_by ? dateIN(r.needed_by) : 'Flexible'}
                  wanted
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function SectionTitle({ icon, title, count }: { icon: React.ReactNode; title: string; count: number }) {
  return (
    <div className="mb-4 flex items-center gap-2.5">
      <span className="text-brand-600 [&>svg]:size-5">{icon}</span>
      <h2 className="text-lg font-semibold text-stone-900">{title}</h2>
      <span className="rounded-full bg-stone-200/70 px-2 py-0.5 text-xs font-semibold tabular-nums text-stone-600">{count}</span>
    </div>
  );
}

function PostCard(props: {
  href: string; code: string; commodity?: string; grade: string | null; price: string; priceLabel: string; quantity: string;
  party?: Party; place: string | null; dateLabel: string; date: string; wanted?: boolean;
}) {
  return (
    <Link
      href={props.href}
      className="group flex flex-col rounded-2xl border border-stone-200/80 bg-white p-5 shadow-card transition-all hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-lift"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={props.wanted ? 'rounded-md bg-harvest-50 px-1.5 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider text-harvest-700' : 'rounded-md bg-brand-50 px-1.5 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider text-brand-700'}>
              {props.wanted ? 'Wanted' : 'For sale'}
            </span>
            <span className="font-mono text-xs text-stone-400">{props.code}</span>
          </div>
          <h3 className="mt-2 truncate font-display text-xl font-semibold text-stone-900 group-hover:text-brand-800">{props.commodity}</h3>
          {props.grade && <div className="text-sm text-stone-500">{props.grade}</div>}
        </div>
        <div className="text-right">
          <div className="font-display text-xl font-semibold tabular-nums text-stone-900">{props.price}</div>
          <div className="text-xs text-stone-500">{props.priceLabel}</div>
        </div>
      </div>

      <div className="mt-4 inline-flex w-fit items-baseline gap-1.5 rounded-lg bg-stone-100 px-2.5 py-1">
        <span className="text-sm font-semibold tabular-nums text-stone-900">{props.quantity}</span>
        <span className="text-xs text-stone-500">{props.wanted ? 'needed' : 'available'}</span>
      </div>

      <div className="flex-1" />
      <div className="mt-4 space-y-1.5 border-t border-stone-100 pt-4 text-sm text-stone-600 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-stone-400">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-stone-800">{partyLabel(props.party)}</span>
          {props.party?.verified && <span title="Verified"><IconCheckCircle className="!text-brand-600" /><span className="sr-only">Verified</span></span>}
        </div>
        {props.place && <div className="flex items-center gap-2"><IconMapPin /><span className="truncate">{props.place}</span></div>}
        <div className="flex items-center gap-2"><IconCalendar />{props.dateLabel} {props.date}</div>
      </div>
    </Link>
  );
}
