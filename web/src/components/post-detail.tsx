import { notFound } from 'next/navigation';
import { canTrade, requireViewer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getCommodities, getPartiesOfType, getPartyMap, partyLabel } from '@/lib/data';
import { dateIN, dateTimeIN, kg, rupees } from '@/lib/money';
import { closePost, makeOffer, respondToOffer, withdrawOffer } from '@/app/actions/market';
import { ActionForm, Submit } from '@/components/action-form';
import { PartySelect } from '@/components/party-select';
import { Badge, Card, Dl, Empty, Field, Input, Notice, PageHeader, Table, Td, Textarea, statusTone } from '@/components/ui';
import { IconHandshake, IconLeaf, IconSend, IconX } from '@/components/icons';
import type { Listing, Offer, Requirement } from '@/lib/types';

export async function PostDetail({ kind, id }: { kind: 'listing' | 'requirement'; id: string }) {
  const viewer = await requireViewer();
  const supabase = await createClient();
  const table = kind === 'listing' ? 'listings' : 'requirements';
  const { data } = await supabase.from(table).select('*').eq('id', id).maybeSingle();
  if (!data) notFound();

  const post = data as Listing & Requirement;
  const ownerId = kind === 'listing' ? post.farmer_id : post.buyer_id;
  const isOwner = viewer.party?.id === ownerId;
  const offerFromType = kind === 'listing' ? 'buyer' : 'farmer';

  const [{ data: offerRows }, commodities] = await Promise.all([
    supabase.from('offers').select('*').eq(kind === 'listing' ? 'listing_id' : 'requirement_id', id).order('created_at', { ascending: false }),
    getCommodities(true),
  ]);
  const offers = (offerRows ?? []) as Offer[];
  const parties = await getPartyMap([ownerId, ...offers.map((o) => o.party_id)]);
  const commodity = commodities.find((c) => c.id === post.commodity_id)?.name ?? '';
  const canRespond = (isOwner || viewer.isAdmin) && post.status === 'open';
  const canOffer = post.status === 'open' && !isOwner && (viewer.isAdmin || viewer.party?.type === offerFromType);
  const offerParties = viewer.isAdmin ? (await getPartiesOfType(offerFromType)).filter((p) => p.id !== ownerId) : [];

  return (
    <>
      <PageHeader
        back={{ href: '/market', label: 'Market' }}
        eyebrow={kind === 'listing' ? 'Produce for sale' : 'Buyer requirement'}
        title={`${commodity}${post.grade ? ` · ${post.grade}` : ''}`}
        subtitle={<><Badge tone={statusTone(post.status)} dot>{post.status}</Badge><span className="font-mono text-xs">{post.code}</span></>}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Details" icon={<IconLeaf />}>
            <Dl items={kind === 'listing' ? [
              ['Farmer / FPO', partyLabel(parties.get(ownerId))],
              ['Quantity available', kg(post.quantity_kg)],
              ['Price per kg', rupees(post.price_paise_per_kg)],
              ['Pickup location', [post.location, post.pin].filter(Boolean).join(' – ') || '—'],
              ['Available from', dateIN(post.available_from)],
              ['Listed on', dateIN(post.created_at)],
            ] : [
              ['Buyer', partyLabel(parties.get(ownerId))],
              ['Quantity still needed', kg(post.quantity_kg)],
              ['Target price per kg', post.target_price_paise_per_kg ? rupees(post.target_price_paise_per_kg) : 'Open to offers'],
              ['Delivery', [post.delivery_location, post.pin].filter(Boolean).join(' – ') || '—'],
              ['Needed by', dateIN(post.needed_by)],
              ['Posted on', dateIN(post.created_at)],
            ]} />
            {post.notes && <p className="mt-5 whitespace-pre-line rounded-xl border border-stone-100 bg-stone-50 p-4 text-sm leading-relaxed text-stone-700">{post.notes}</p>}
          </Card>

          <Card title={isOwner || viewer.isAdmin ? `Offers received (${offers.length})` : 'Your offers'} icon={<IconHandshake />}>
            {offers.length === 0 ? <Empty icon={<IconHandshake />}>No offers yet.</Empty> : (
              <Table head={['From', 'Quantity', 'Price / kg', 'Value', 'Status', '']}>
                {offers.map((o) => (
                  <tr key={o.id} className="align-top">
                    <Td>
                      {partyLabel(parties.get(o.party_id))}
                      <div className="text-xs text-stone-500">{dateTimeIN(o.created_at)}</div>
                      {o.message && <div className="mt-1 max-w-xs whitespace-normal text-xs text-stone-600">“{o.message}”</div>}
                    </Td>
                    <Td>{kg(o.quantity_kg)}</Td>
                    <Td>{rupees(o.price_paise_per_kg)}</Td>
                    <Td className="font-semibold tabular-nums text-stone-900">{rupees(o.quantity_kg * o.price_paise_per_kg)}</Td>
                    <Td><Badge tone={statusTone(o.status)}>{o.status}</Badge></Td>
                    <Td>
                      {o.status === 'pending' && canRespond && (
                        <ActionForm action={respondToOffer} hidden={{ offer_id: o.id }} className="flex gap-2 space-y-0">
                          <Submit small name="decision" value="accept">Accept</Submit>
                          <Submit small variant="secondary" name="decision" value="reject">Decline</Submit>
                        </ActionForm>
                      )}
                      {o.status === 'pending' && (o.party_id === viewer.party?.id || (viewer.isAdmin && !canRespond)) && (
                        <ActionForm action={withdrawOffer} hidden={{ offer_id: o.id }}>
                          <Submit small variant="secondary">Withdraw</Submit>
                        </ActionForm>
                      )}
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
            {canRespond && offers.some((o) => o.status === 'pending') && (
              <p className="mt-3 text-xs text-stone-500">Accepting creates an order at the offered price and quantity. The rest stays open for other offers.</p>
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
                  <Field label="Quantity (kg)"><Input name="quantity_kg" type="number" min={1} max={post.quantity_kg} defaultValue={post.quantity_kg} required /></Field>
                  <Field label="Your price per kg (₹)">
                    <Input name="price" inputMode="decimal" required
                      defaultValue={((kind === 'listing' ? post.price_paise_per_kg : post.target_price_paise_per_kg ?? 0) / 100) || ''} />
                  </Field>
                  <Field label="Message" hint="Optional: terms, timing, quality questions"><Textarea name="message" maxLength={1000} /></Field>
                  <Submit>Send offer</Submit>
                </ActionForm>
              )}
            </Card>
          )}
          {(isOwner || viewer.isAdmin) && post.status === 'open' && (
            <Card title={`Close this ${kind}`} icon={<IconX />}>
              <p className="mb-3 text-sm text-stone-600">Removes it from the market and declines pending offers.</p>
              <ActionForm action={closePost} hidden={{ kind, id }}>
                <Submit variant="secondary">Close {kind}</Submit>
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
