import Link from 'next/link';
import { requireViewer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getCommodities, partyLabel } from '@/lib/data';
import { dateIN } from '@/lib/money';
import { INDIAN_STATES } from '@/lib/india';
import { parseUnit, priceIn, qtyIn, UNITS, type Unit } from '@/lib/units';
import { TrustBadges } from '@/components/trust';
import { ButtonLink, Empty, FilterPills, Input, PageHeader, Select, buttonClass, cx } from '@/components/ui';
import { IconCalendar, IconChevronRight, IconMapPin, IconPlus, IconSearch, IconSprout, IconStore } from '@/components/icons';
import type { Listing, Party, Requirement } from '@/lib/types';

export const metadata = { title: 'Market' };

const PAGE = 24;
const SORTS = { new: 'Newest first', price_asc: 'Price: low to high', price_desc: 'Price: high to low', qty: 'Largest quantity' } as const;
type Sort = keyof typeof SORTS;

type Params = { tab?: string; c?: string; state?: string; grade?: string; max?: string; verified?: string; sort?: string; q?: string; u?: string; page?: string };

/** Characters with meaning in PostgREST filter syntax are stripped from free text. */
const clean = (s: string | undefined, max = 60) => (s ?? '').replace(/[%,().*\\:"']/g, ' ').trim().slice(0, max);

export default async function MarketPage({ searchParams }: { searchParams: Promise<Params> }) {
  const viewer = await requireViewer();
  const sp = await searchParams;
  const supabase = await createClient();
  const commodities = await getCommodities();
  const type = viewer.party?.type;

  const tab: 'sale' | 'wanted' = sp.tab === 'wanted' || (sp.tab !== 'sale' && type === 'farmer') ? 'wanted' : 'sale';
  const unit: Unit = parseUnit(sp.u);
  const commodity = commodities.find((x) => x.id === sp.c);
  const state = INDIAN_STATES.find((s) => s === sp.state);
  const grade = commodity?.grades.includes(sp.grade ?? '') ? sp.grade : undefined;
  const sort: Sort = sp.sort && sp.sort in SORTS ? (sp.sort as Sort) : 'new';
  const verifiedOnly = sp.verified === '1';
  const q = clean(sp.q);
  const page = Math.max(1, Math.min(500, Number.parseInt(sp.page ?? '1', 10) || 1));
  const maxRupees = Number(sp.max);
  const kgPerUnit = UNITS.find((x) => x.id === unit)!.kg;
  const maxPaisePerKg = Number.isFinite(maxRupees) && maxRupees > 0 ? Math.floor((maxRupees * 100) / kgPerUnit) : null;

  // One query shape for both tabs; the owner's party is joined (inner) only when we filter on it.
  const isSale = tab === 'sale';
  const table = isSale ? 'listings' : 'requirements';
  const priceCol = isSale ? 'price_paise_per_kg' : 'target_price_paise_per_kg';
  const joinOwner = Boolean(state || verifiedOnly);
  let query = supabase.from(table)
    .select(joinOwner ? '*, parties!inner(state, verified)' : '*', { count: 'exact' })
    .eq('status', 'open');
  if (isSale) query = query.eq('paused', false);
  if (commodity) query = query.eq('commodity_id', commodity.id);
  if (grade) query = query.eq('grade', grade);
  if (maxPaisePerKg) query = query.lte(priceCol, maxPaisePerKg);
  if (state) query = query.ilike('parties.state', state);
  if (verifiedOnly) query = query.eq('parties.verified', true);
  if (q) {
    const ids = commodities.filter((x) => x.name.toLowerCase().includes(q.toLowerCase())).map((x) => x.id);
    const place = isSale ? 'location' : 'delivery_location';
    query = query.or([`${place}.ilike.%${q}%`, `notes.ilike.%${q}%`, `code.ilike.%${q}%`, `grade.ilike.%${q}%`,
      ...(ids.length ? [`commodity_id.in.(${ids.join(',')})`] : [])].join(','));
  }
  query = sort === 'price_asc' ? query.order(priceCol, { ascending: true, nullsFirst: false })
    : sort === 'price_desc' ? query.order(priceCol, { ascending: false, nullsFirst: false })
    : sort === 'qty' ? query.order('quantity_kg', { ascending: false })
    : query.order('created_at', { ascending: false });
  const { data, count } = await query.range((page - 1) * PAGE, page * PAGE - 1);
  const rows = (data ?? []) as unknown as (Listing & Requirement)[];

  const ownerIds = [...new Set(rows.map((r) => (isSale ? r.farmer_id : r.buyer_id)))];
  const { data: ownerRows } = ownerIds.length ? await supabase.from('parties').select('*').in('id', ownerIds) : { data: [] };
  const owners = new Map(((ownerRows ?? []) as Party[]).map((p) => [p.id, p]));
  const cname = new Map(commodities.map((x) => [x.id, x.name]));
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  // Links keep every other filter.
  const current: Record<string, string | undefined> = {
    tab, c: commodity?.id, state, grade, max: maxPaisePerKg ? String(maxRupees) : undefined,
    verified: verifiedOnly ? '1' : undefined, sort: sort === 'new' ? undefined : sort, q: q || undefined, u: unit === 'kg' ? undefined : unit,
  };
  const href = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    Object.entries({ ...current, page: undefined, ...patch }).forEach(([k, v]) => { if (v) p.set(k, v); });
    return `/market?${p.toString()}`;
  };
  const filtered = Boolean(commodity || state || grade || maxPaisePerKg || verifiedOnly || q);

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

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Market side" className="inline-flex rounded-xl bg-stone-200/60 p-1">
          {([['sale', 'Produce for sale', <IconSprout key="s" />], ['wanted', 'Buyer requirements', <IconStore key="w" />]] as const).map(([k, label, icon]) => (
            <Link key={k} role="tab" aria-selected={tab === k} href={href({ tab: k, grade: undefined, sort: undefined })}
              className={cx('inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-sm font-semibold transition-colors [&>svg]:size-4',
                tab === k ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600 hover:text-stone-900')}>
              {icon}{label}
            </Link>
          ))}
        </div>
        <div className="inline-flex items-center gap-1 text-sm" aria-label="Show quantities and prices in">
          <span className="mr-1 text-stone-500">Show in</span>
          {UNITS.map((x) => (
            <Link key={x.id} href={href({ u: x.id === 'kg' ? undefined : x.id })} aria-current={unit === x.id ? 'true' : undefined}
              className={cx('rounded-lg px-2.5 py-1 font-medium', unit === x.id ? 'bg-brand-700 text-white' : 'text-stone-600 hover:bg-stone-200/60')}>
              {x.short}
            </Link>
          ))}
        </div>
      </div>

      <form role="search" action="/market" className="mb-4 grid gap-2 rounded-2xl border border-stone-200/80 bg-white p-3 shadow-card sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]">
        <input type="hidden" name="tab" value={tab} />
        {unit !== 'kg' && <input type="hidden" name="u" value={unit} />}
        <div className="relative sm:col-span-2 lg:col-span-1">
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" />
          <Input name="q" type="search" defaultValue={q} placeholder="Search commodity, place, code" aria-label="Search" className="pl-9" />
        </div>
        <Select name="c" defaultValue={commodity?.id ?? ''} aria-label="Commodity">
          <option value="">All commodities</option>
          {commodities.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </Select>
        <Select name="grade" defaultValue={grade ?? ''} aria-label="Grade" disabled={!commodity?.grades.length}>
          <option value="">{commodity ? 'Any grade' : 'Grade (pick a commodity)'}</option>
          {commodity?.grades.map((g) => <option key={g} value={g}>{g}</option>)}
        </Select>
        <Select name="state" defaultValue={state ?? ''} aria-label="State">
          <option value="">All states</option>
          {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
        <Input name="max" inputMode="decimal" defaultValue={maxPaisePerKg ? String(maxRupees) : ''} placeholder={`Max ₹ / ${unit}`} aria-label={`Maximum price per ${unit}`} />
        <button className={buttonClass('primary')}>Apply</button>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:col-span-2 lg:col-span-6">
          <label className="inline-flex items-center gap-2 text-sm text-stone-700">
            <input type="checkbox" name="verified" value="1" defaultChecked={verifiedOnly} className="size-4 rounded" />
            Verified {isSale ? 'sellers' : 'buyers'} only
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-stone-700">
            Sort
            <Select name="sort" defaultValue={sort} className="h-9 w-auto py-1.5" aria-label="Sort">
              {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </label>
          {filtered && <Link href={href({ c: undefined, state: undefined, grade: undefined, max: undefined, verified: undefined, q: undefined })} className="text-sm font-medium text-brand-700 hover:underline">Clear filters</Link>}
        </div>
      </form>

      <FilterPills
        label="Quick filter by commodity"
        items={[
          { href: href({ c: undefined, grade: undefined }), label: 'All', active: !commodity },
          ...commodities.map((x) => ({ href: href({ c: x.id, grade: undefined }), label: x.name, active: commodity?.id === x.id })),
        ]}
      />

      <p className="mb-4 text-sm text-stone-500">{total.toLocaleString('en-IN')} {isSale ? 'listing' : 'requirement'}{total === 1 ? '' : 's'}{filtered ? ' match your filters' : ' open'}</p>

      {rows.length === 0 ? (
        <Empty icon={isSale ? <IconSprout /> : <IconStore />}>
          {filtered ? 'Nothing matches these filters. Try widening them.' : `No open ${isSale ? 'listings' : 'requirements'} right now.`}
        </Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((r) => (
            <PostCard
              key={r.id}
              href={`/${isSale ? 'listings' : 'requirements'}/${r.id}`}
              code={r.code}
              commodity={cname.get(r.commodity_id)}
              grade={r.grade}
              price={isSale ? priceIn(r.price_paise_per_kg, unit) : r.target_price_paise_per_kg ? priceIn(r.target_price_paise_per_kg, unit) : 'Open to offers'}
              priceLabel={isSale ? (r.negotiable ? 'asking' : 'fixed price') : r.target_price_paise_per_kg ? 'target' : ''}
              quantity={qtyIn(r.quantity_kg, unit)}
              moq={isSale && r.min_order_kg ? qtyIn(r.min_order_kg, unit) : null}
              party={owners.get(isSale ? r.farmer_id : r.buyer_id)}
              place={isSale ? r.location : r.delivery_location}
              dateLabel={isSale ? 'Available' : 'Needed by'}
              date={isSale ? (r.available_from ? dateIN(r.available_from) : 'Now') : (r.needed_by ? dateIN(r.needed_by) : 'Flexible')}
              wanted={!isSale}
            />
          ))}
        </div>
      )}

      {pages > 1 && (
        <nav aria-label="Pages" className="mt-8 flex items-center justify-between gap-3 text-sm">
          {page > 1 ? <Link className={buttonClass('secondary', true)} href={href({ page: String(page - 1) })}>← Previous</Link> : <span />}
          <span className="text-stone-500">Page {page} of {pages}</span>
          {page < pages ? <Link className={buttonClass('secondary', true)} href={href({ page: String(page + 1) })}>Next →</Link> : <span />}
        </nav>
      )}
    </>
  );
}

function PostCard(props: {
  href: string; code: string; commodity?: string; grade: string | null; price: string; priceLabel: string; quantity: string;
  moq: string | null; party?: Party; place: string | null; dateLabel: string; date: string; wanted?: boolean;
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
          <div className="font-display text-lg font-semibold tabular-nums text-stone-900">{props.price}</div>
          {props.priceLabel && <div className="text-xs text-stone-500">{props.priceLabel}</div>}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <span className="inline-flex items-baseline gap-1.5 rounded-lg bg-stone-100 px-2.5 py-1">
          <span className="text-sm font-semibold tabular-nums text-stone-900">{props.quantity}</span>
          <span className="text-xs text-stone-500">{props.wanted ? 'needed' : 'available'}</span>
        </span>
        {props.moq && <span className="inline-flex items-baseline gap-1 rounded-lg bg-stone-50 px-2.5 py-1 text-xs text-stone-600 ring-1 ring-inset ring-stone-200">min {props.moq}</span>}
      </div>

      <div className="flex-1" />
      <div className="mt-4 space-y-1.5 border-t border-stone-100 pt-4 text-sm text-stone-600 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-stone-400">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium text-stone-800">{partyLabel(props.party)}</span>
          <TrustBadges party={props.party} />
        </div>
        {props.place && <div className="flex items-center gap-2"><IconMapPin /><span className="truncate">{props.place}</span></div>}
        <div className="flex items-center gap-2"><IconCalendar />{props.dateLabel} {props.date}<IconChevronRight className="ml-auto !text-stone-300 transition-transform group-hover:translate-x-0.5" /></div>
      </div>
    </Link>
  );
}
