import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireViewer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getCommodities, getPartyMap, partyLabel } from '@/lib/data';
import { dateIN, kg } from '@/lib/money';
import { priceIn } from '@/lib/units';
import { setListingPaused } from '@/app/actions/market';
import { ActionForm, Submit } from '@/components/action-form';
import { Badge, ButtonLink, Card, Empty, FilterPills, PageHeader, Table, Td, statusTone } from '@/components/ui';
import { IconPlus, IconSprout, IconStore } from '@/components/icons';
import type { Listing, Offer, Requirement } from '@/lib/types';

const FILTERS = ['open', 'paused', 'closed'] as const;

/** A farmer's listings or a buyer's requirements, with what needs a reply. Admins see everyone's. */
export async function MyPosts({ kind, status }: { kind: 'listing' | 'requirement'; status?: string }) {
  const viewer = await requireViewer();
  const isListing = kind === 'listing';
  const ownerType = isListing ? 'farmer' : 'buyer';
  if (!viewer.isAdmin && viewer.party?.type !== ownerType) redirect('/market');

  const supabase = await createClient();
  const filter = FILTERS.find((f) => f === status) ?? (status === 'all' ? undefined : 'open');
  let q = supabase.from(isListing ? 'listings' : 'requirements').select('*').order('created_at', { ascending: false }).limit(200);
  if (!viewer.isAdmin) q = q.eq(isListing ? 'farmer_id' : 'buyer_id', viewer.party!.id);
  if (filter === 'closed') q = q.eq('status', 'closed');
  else if (filter === 'open') q = isListing ? q.eq('status', 'open').eq('paused', false) : q.eq('status', 'open');
  else if (filter === 'paused') q = q.eq('status', 'open').eq('paused', true);
  const { data } = await q;
  const posts = (data ?? []) as (Listing & Requirement)[];

  const [commodities, { data: offerRows }] = await Promise.all([
    getCommodities(true),
    posts.length
      ? supabase.from('offers').select('id, listing_id, requirement_id, party_id, last_by, status')
          .in(isListing ? 'listing_id' : 'requirement_id', posts.map((p) => p.id)).eq('status', 'pending')
      : Promise.resolve({ data: [] as Offer[] }),
  ]);
  const offers = (offerRows ?? []) as Offer[];
  const owners = viewer.isAdmin ? await getPartyMap(posts.map((p) => (isListing ? p.farmer_id : p.buyer_id))) : new Map();
  const cname = new Map(commodities.map((c) => [c.id, c.name]));
  const base = isListing ? '/listings' : '/requirements';
  const title = viewer.isAdmin ? (isListing ? 'All listings' : 'All requirements') : (isListing ? 'My listings' : 'My requirements');

  return (
    <>
      <PageHeader
        title={title}
        subtitle={isListing ? 'Edit prices and quantities, pause or close lots, and answer offers.' : 'What you are buying, and the offers farmers have made.'}
        action={<ButtonLink href={`${base}/new`}><IconPlus />{isListing ? 'List produce' : 'Post a requirement'}</ButtonLink>}
      />
      <FilterPills
        label="Filter by status"
        items={[
          ...FILTERS.filter((f) => isListing || f !== 'paused').map((f) => ({ href: `${base}?status=${f}`, label: f[0].toUpperCase() + f.slice(1), active: filter === f })),
          { href: `${base}?status=all`, label: 'All', active: !filter },
        ]}
      />
      <Card padded={false}>
        {posts.length === 0 ? (
          <div className="p-6">
            <Empty icon={isListing ? <IconSprout /> : <IconStore />} action={<ButtonLink href={`${base}/new`} small variant="secondary"><IconPlus />Create one</ButtonLink>}>
              Nothing here{filter ? ` that is ${filter}` : ''}.
            </Empty>
          </div>
        ) : (
          <div className="px-5 sm:px-6">
            <Table head={[isListing ? 'Lot' : 'Requirement', ...(viewer.isAdmin ? [isListing ? 'Farmer' : 'Buyer'] : []), 'Quantity', isListing ? 'Price' : 'Target', 'Offers', 'Status', 'Posted', '']}>
              {posts.map((p) => {
                const mine = offers.filter((o) => (isListing ? o.listing_id : o.requirement_id) === p.id);
                const owner = isListing ? p.farmer_id : p.buyer_id;
                const needReply = mine.filter((o) => o.last_by !== owner).length;
                const paused = isListing && p.paused;
                return (
                  <tr key={p.id}>
                    <Td>
                      <Link href={`${base}/${p.id}`} className="font-semibold text-stone-900 hover:text-brand-700 hover:underline">{cname.get(p.commodity_id)}</Link>
                      <div className="text-xs text-stone-500"><span className="font-mono">{p.code}</span>{p.grade ? ` · ${p.grade}` : ''}</div>
                    </Td>
                    {viewer.isAdmin && <Td className="max-w-[12rem] truncate">{partyLabel(owners.get(owner))}</Td>}
                    <Td className="tabular-nums">{kg(p.quantity_kg)}{isListing && p.min_order_kg ? <div className="text-xs text-stone-500">min {kg(p.min_order_kg)}</div> : null}</Td>
                    <Td className="tabular-nums">{isListing ? priceIn(p.price_paise_per_kg, 'qtl') : p.target_price_paise_per_kg ? priceIn(p.target_price_paise_per_kg, 'qtl') : 'Open'}</Td>
                    <Td>
                      {mine.length === 0 ? <span className="text-stone-400">—</span> : (
                        <Link href={`${base}/${p.id}`} className="font-medium text-brand-700 hover:underline">
                          <span className="inline-flex items-center gap-2">{mine.length} open{needReply ? <Badge tone="amber">{needReply} to answer</Badge> : null}</span>
                        </Link>
                      )}
                    </Td>
                    <Td><Badge tone={paused ? 'gray' : statusTone(p.status)} dot>{paused ? 'paused' : p.status}</Badge></Td>
                    <Td className="text-stone-500">{dateIN(p.created_at)}</Td>
                    <Td>
                      {isListing && p.status === 'open' && (
                        <ActionForm action={setListingPaused} hidden={{ kind, id: p.id, paused: String(!paused) }} className="space-y-1">
                          <Submit small variant="secondary">{paused ? 'Resume' : 'Pause'}</Submit>
                        </ActionForm>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </Table>
          </div>
        )}
      </Card>
    </>
  );
}
