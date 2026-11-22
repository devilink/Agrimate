import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getCommodities, getPartyMap, partyLabel } from '@/lib/data';
import { dateTimeIN, kg, rupees } from '@/lib/money';
import { priceIn } from '@/lib/units';
import { Badge, Card, Empty, FilterPills, PageHeader, Table, Td, statusTone } from '@/components/ui';
import { IconHandshake } from '@/components/icons';
import type { Offer } from '@/lib/types';

export const metadata = { title: 'Offers' };

const STATUSES = ['pending', 'accepted', 'rejected', 'withdrawn'] as const;

export default async function AdminOffersPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireAdmin();
  const { status } = await searchParams;
  const filter = STATUSES.find((s) => s === status) ?? (status === 'all' ? undefined : 'pending');
  const supabase = await createClient();
  let q = supabase.from('offers').select('*').order('created_at', { ascending: false }).limit(200);
  if (filter) q = q.eq('status', filter);
  const { data } = await q;
  const offers = (data ?? []) as Offer[];

  const listingIds = offers.map((o) => o.listing_id).filter(Boolean) as string[];
  const reqIds = offers.map((o) => o.requirement_id).filter(Boolean) as string[];
  const [{ data: ls }, { data: rs }, commodities] = await Promise.all([
    listingIds.length ? supabase.from('listings').select('id, code, farmer_id, commodity_id, price_paise_per_kg').in('id', listingIds) : Promise.resolve({ data: [] }),
    reqIds.length ? supabase.from('requirements').select('id, code, buyer_id, commodity_id, target_price_paise_per_kg').in('id', reqIds) : Promise.resolve({ data: [] }),
    getCommodities(true),
  ]);
  type PostRow = { id: string; code: string; owner: string; commodity_id: string; ask: number | null };
  const posts = new Map<string, PostRow>();
  (ls ?? []).forEach((l) => posts.set(l.id, { id: l.id, code: l.code, owner: l.farmer_id, commodity_id: l.commodity_id, ask: Number(l.price_paise_per_kg) }));
  (rs ?? []).forEach((r) => posts.set(r.id, { id: r.id, code: r.code, owner: r.buyer_id, commodity_id: r.commodity_id, ask: r.target_price_paise_per_kg ? Number(r.target_price_paise_per_kg) : null }));
  const parties = await getPartyMap([...offers.map((o) => o.party_id), ...[...posts.values()].map((p) => p.owner)]);
  const cname = new Map(commodities.map((c) => [c.id, c.name]));

  return (
    <>
      <PageHeader title="Offers" subtitle="Every negotiation on the market. Open a post to accept, counter or decline on someone's behalf." />
      <FilterPills label="Filter by status" items={[
        ...STATUSES.map((s) => ({ href: `/admin/offers?status=${s}`, label: s[0].toUpperCase() + s.slice(1), active: filter === s })),
        { href: '/admin/offers?status=all', label: 'All', active: !filter },
      ]} />
      <Card padded={false}>
        {offers.length === 0 ? <div className="p-6"><Empty icon={<IconHandshake />}>No {filter ?? ''} offers.</Empty></div> : (
          <div className="px-5 sm:px-6">
            <Table head={['Post', 'From', 'To', 'Current terms', 'Value', 'Rounds', 'Waiting on', 'Status', 'Made']}>
              {offers.map((o) => {
                const post = posts.get(o.listing_id ?? o.requirement_id ?? '');
                const href = o.listing_id ? `/listings/${o.listing_id}` : `/requirements/${o.requirement_id}`;
                const awaited = post ? (o.last_by === o.party_id ? post.owner : o.party_id) : null;
                return (
                  <tr key={o.id}>
                    <Td>
                      <Link href={href} className="font-semibold text-stone-900 hover:text-brand-700 hover:underline">{cname.get(post?.commodity_id ?? '') ?? '—'}</Link>
                      <div className="text-xs text-stone-500"><span className="font-mono">{post?.code}</span> · {o.listing_id ? 'listing' : 'requirement'}</div>
                    </Td>
                    <Td className="max-w-[11rem] truncate">{partyLabel(parties.get(o.party_id))}</Td>
                    <Td className="max-w-[11rem] truncate">{partyLabel(parties.get(post?.owner ?? ''))}</Td>
                    <Td className="tabular-nums">{kg(o.quantity_kg)} @ {priceIn(o.price_paise_per_kg, 'qtl')}</Td>
                    <Td className="font-medium tabular-nums">{rupees(o.quantity_kg * Number(o.price_paise_per_kg))}</Td>
                    <Td className="tabular-nums">{o.counters + 1}</Td>
                    <Td className="max-w-[10rem] truncate">{o.status === 'pending' && awaited ? parties.get(awaited)?.name : '—'}</Td>
                    <Td><Badge tone={statusTone(o.status)}>{o.status}</Badge></Td>
                    <Td className="text-stone-500">{dateTimeIN(o.created_at)}</Td>
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
