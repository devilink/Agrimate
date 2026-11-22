import { notFound } from 'next/navigation';
import { canTrade, requireViewer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';
import { getCommodities, getPartiesOfType, getPartyMap, partyLabel } from '@/lib/data';
import { getBenchmark } from '@/lib/prices';
import { dateIN, kg, rupees } from '@/lib/money';
import { priceIn } from '@/lib/units';
import { closePost, makeOffer, setListingPaused, updatePost } from '@/app/actions/market';
import { ActionForm, Submit } from '@/components/action-form';
import { BenchmarkCard } from '@/components/benchmark-card';
import { OfferThread } from '@/components/offer-thread';
import { PartySelect } from '@/components/party-select';
import { TrustBadges } from '@/components/trust';
import { PriceField, QuantityField } from '@/components/unit-fields';
import { Badge, Card, Dl, Empty, Field, Notice, PageHeader, Textarea, statusTone } from '@/components/ui';
import { IconClipboardCheck, IconHandshake, IconLeaf, IconSend, IconSliders } from '@/components/icons';
import type { Listing, Offer, OfferMessage, Requirement } from '@/lib/types';

const UUID = /^[0-9a-f-]{36}$/i;
const pctText = (v: number | null) => (v === null ? null : `${Number(v)}%`);

export async function PostDetail({ kind, id }: { kind: 'listing' | 'requirement'; id: string }) {
  if (!UUID.test(id)) notFound();
  const viewer = await requireViewer();
  const supabase = await createClient();
  const table = kind === 'listing' ? 'listings' : 'requirements';
  let { data } = await supabase.from(table).select('*').eq('id', id).maybeSingle();
  // Paused and closed posts are hidden from everyone but the owner. Someone with an offer on one still needs to read
  // the thread and withdraw, so after confirming (through RLS) that they made an offer here, load the post itself.
  let offererOnly = false;
  if (!data && viewer.party) {
    const { data: mine } = await supabase.from('offers').select('id')
      .eq(kind === 'listing' ? 'listing_id' : 'requirement_id', id).eq('party_id', viewer.party.id).limit(1);
    if (mine?.length) {
      ({ data } = await adminClient().from(table).select('*').eq('id', id).maybeSingle());
      offererOnly = true;
    }
  }
  if (!data) notFound();

  const post = data as Listing & Requirement;
  const isListing = kind === 'listing';
  const ownerId = isListing ? post.farmer_id : post.buyer_id;
  const isOwner = viewer.party?.id === ownerId;
  const manage = isOwner || viewer.isAdmin;
  const offerFromType = isListing ? 'buyer' : 'farmer';
  const askPrice = isListing ? Number(post.price_paise_per_kg) : post.target_price_paise_per_kg ? Number(post.target_price_paise_per_kg) : null;
  const negotiable = isListing ? post.negotiable : true;
  const paused = isListing && post.paused;

  const [{ data: offerRows }, commodities, benchmark] = await Promise.all([
    supabase.from('offers').select('*').eq(isListing ? 'listing_id' : 'requirement_id', id).order('created_at', { ascending: false }),
    getCommodities(true),
    getBenchmark(post.commodity_id),
  ]);
  const offers = (offerRows ?? []) as Offer[];
  const { data: msgRows } = offers.length
    ? await supabase.from('offer_messages').select('*').in('offer_id', offers.map((o) => o.id)).order('id')
    : { data: [] };
  const messages = (msgRows ?? []) as OfferMessage[];
  const parties = await getPartyMap([ownerId, ...offers.map((o) => o.party_id)]);
  const owner = parties.get(ownerId);
  const commodity = commodities.find((c) => c.id === post.commodity_id)?.name ?? '';
  const open = post.status === 'open';
  const myOpenOffer = offers.some((o) => o.status === 'pending' && o.party_id === viewer.party?.id);
  const canOffer = open && !paused && !isOwner && !myOpenOffer && (viewer.isAdmin || viewer.party?.type === offerFromType);
  const offerParties = viewer.isAdmin && canOffer ? (await getPartiesOfType(offerFromType)).filter((p) => p.id !== ownerId) : [];
  const pendingCount = offers.filter((o) => o.status === 'pending').length;

  const specs: [string, string | null][] = isListing ? [
    ['Moisture', pctText(post.moisture_pct)],
    ['Foreign matter', pctText(post.foreign_matter_pct)],
    ['Broken / damaged', pctText(post.broken_pct)],
    ['Purity', pctText(post.purity_pct)],
    ['Packaging', post.packaging],
    ['Harvest', post.harvest],
  ] : [];
  const hasSpecs = specs.some(([, v]) => v);

  return (
    <>
      <PageHeader
        back={{ href: '/market', label: 'Market' }}
        eyebrow={isListing ? 'Produce for sale' : 'Buyer requirement'}
        title={`${commodity}${post.grade ? ` · ${post.grade}` : ''}`}
        subtitle={<>
          <Badge tone={paused ? 'gray' : statusTone(post.status)} dot>{paused ? 'paused' : post.status}</Badge>
          {isListing && !post.negotiable && <Badge tone="blue">fixed price</Badge>}
          <span className="font-mono text-xs">{post.code}</span>
        </>}
      />
      {paused && manage && <Notice tone="blue">This listing is paused: it is hidden from the market and offers can&apos;t be accepted until you resume it.</Notice>}
      {offererOnly && (
        <Notice tone="blue">
          This {kind} is {paused ? 'paused by its owner' : 'closed'}, so it is no longer on the market. You can still read your offer below{paused ? ', and withdraw it if you no longer want to wait' : ''}.
        </Notice>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Details" icon={<IconLeaf />}>
            <div className="mb-5 flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold text-stone-900">{partyLabel(owner)}</span>
              <TrustBadges party={owner} />
              {owner && owner.completed_trades > 0 && <span className="text-xs text-stone-500">{owner.completed_trades} completed trades</span>}
            </div>
            <Dl items={isListing ? [
              ['Quantity available', kg(post.quantity_kg)],
              ['Price', <>{priceIn(post.price_paise_per_kg, 'kg')} <span className="text-stone-500">· {priceIn(post.price_paise_per_kg, 'qtl')}</span></>],
              ['Minimum order', post.min_order_kg ? kg(post.min_order_kg) : 'None'],
              ['Pickup location', [post.location, post.pin].filter(Boolean).join(' – ') || '—'],
              ['Available from', dateIN(post.available_from)],
              ['Listed on', dateIN(post.created_at)],
            ] : [
              ['Quantity still needed', kg(post.quantity_kg)],
              ['Target price', post.target_price_paise_per_kg
                ? <>{priceIn(post.target_price_paise_per_kg, 'kg')} <span className="text-stone-500">· {priceIn(post.target_price_paise_per_kg, 'qtl')}</span></>
                : 'Open to offers'],
              ['Delivery', [post.delivery_location, post.pin].filter(Boolean).join(' – ') || '—'],
              ['Needed by', dateIN(post.needed_by)],
              ['Posted on', dateIN(post.created_at)],
            ]} />
            {post.notes && <p className="mt-5 whitespace-pre-line rounded-xl border border-stone-100 bg-stone-50 p-4 text-sm leading-relaxed text-stone-700">{post.notes}</p>}
          </Card>

          {hasSpecs && (
            <Card title="Quality" icon={<IconClipboardCheck />} description="As declared by the seller. Checked by an inspector once an order is placed, if the team assigns one.">
              <Dl cols={3} items={specs.filter(([, v]) => v).map(([k, v]) => [k, v]) as [string, string][]} />
            </Card>
          )}

          <Card title={manage ? `Offers (${offers.length})` : 'Your offers'} icon={<IconHandshake />}
            description={manage && pendingCount ? `${pendingCount} open. Accepting creates an order at the current terms; the rest of the quantity stays open.` : undefined}>
            {offers.length === 0 ? <Empty icon={<IconHandshake />}>No offers yet.</Empty> : (
              <div className="space-y-4">
                {offers.map((o) => (
                  <OfferThread
                    key={o.id}
                    offer={o}
                    messages={messages.filter((m) => m.offer_id === o.id)}
                    parties={parties}
                    viewer={viewer}
                    ownerId={ownerId}
                    reference={askPrice}
                    referenceLabel={isListing ? 'asking' : 'target'}
                    negotiable={negotiable}
                  />
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          {canOffer && (
            <Card title="Make an offer" icon={<IconSend />} className="ring-2 ring-brand-600/10">
              {!canTrade(viewer) ? (
                <Notice>Your account is waiting for verification. You can make offers once our team has verified you.</Notice>
              ) : (
                <ActionForm action={makeOffer} hidden={{ kind, id }} resetOnSuccess>
                  {viewer.isAdmin && <PartySelect parties={offerParties} label={`On behalf of (${offerFromType})`} />}
                  <QuantityField label="Quantity" defaultKg={post.quantity_kg}
                    hint={isListing && post.min_order_kg ? `Minimum ${kg(post.min_order_kg)} (or all that is left)` : undefined} />
                  {negotiable ? (
                    <PriceField label="Your price" defaultPaisePerKg={askPrice} />
                  ) : (
                    <p className="rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-900">Fixed price: {priceIn(askPrice, 'kg')}. Your offer is at this price.</p>
                  )}
                  <Field label="Message" hint="Optional: terms, timing, quality questions"><Textarea name="message" maxLength={1000} /></Field>
                  <Submit>Send offer</Submit>
                </ActionForm>
              )}
            </Card>
          )}

          {manage && open && (
            <Card title={`Manage this ${kind}`} icon={<IconSliders />}>
              <ActionForm action={updatePost} hidden={{ kind, id }}>
                <QuantityField label={isListing ? 'Quantity available' : 'Quantity needed'} defaultKg={post.quantity_kg} />
                <PriceField label={isListing ? 'Price' : 'Target price'} defaultPaisePerKg={askPrice} required={isListing} />
                {isListing && <QuantityField name="min_order" label="Minimum order" defaultKg={post.min_order_kg} required={false} />}
                <Submit small variant="secondary">Save changes</Submit>
              </ActionForm>
              <div className="mt-5 flex flex-wrap gap-2 border-t border-stone-100 pt-5">
                {isListing && (
                  <ActionForm action={setListingPaused} hidden={{ kind, id, paused: String(!paused) }} className="space-y-0">
                    <Submit small variant="secondary">{paused ? 'Resume listing' : 'Pause listing'}</Submit>
                  </ActionForm>
                )}
                <ActionForm action={closePost} hidden={{ kind, id }} className="space-y-0">
                  <Submit small variant="danger">Close {kind}</Submit>
                </ActionForm>
              </div>
              <p className="mt-3 text-xs text-stone-500">Closing removes it from the market for good and declines open offers.{isListing ? ' Pausing hides it until you resume.' : ''}</p>
            </Card>
          )}

          <BenchmarkCard benchmark={benchmark} price={askPrice} commodityId={post.commodity_id}
            priceLabel={isListing ? 'This listing' : 'Target price'} />

          {manage && offers.length > 0 && (
            <p className="px-1 text-xs text-stone-500">Total value of open offers: {rupees(offers.filter((o) => o.status === 'pending').reduce((s, o) => s + o.quantity_kg * Number(o.price_paise_per_kg), 0))}</p>
          )}
        </div>
      </div>
    </>
  );
}
