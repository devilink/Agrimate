'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { actorLabel, canTrade, requireViewer, type Viewer } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { check, date, fail, optionalUuid, pct, pin, run, text, uuid, type ActionState } from '@/lib/action';
import { toPaise } from '@/lib/money';
import { parseUnit, UNITS } from '@/lib/units';
import type { PartyType } from '@/lib/types';

/** Who a post or offer is for: the viewer's own party, or (admins only) a party chosen in the form. */
async function actingParty(viewer: Viewer, form: FormData, type: PartyType): Promise<string> {
  const db = adminClient();
  if (viewer.isAdmin) {
    const id = optionalUuid(form, 'party_id') ?? fail(`Choose the ${type}.`);
    const { data } = await db.from('parties').select('id, type, active').eq('id', id).maybeSingle();
    if (!data || data.type !== type || !data.active) fail(`That party is not an active ${type}.`);
    return id;
  }
  if (viewer.party?.type !== type) fail(`Only a ${type} can do this.`);
  if (!canTrade(viewer)) fail('Your account is waiting for verification by our team.');
  return viewer.party.id;
}

async function commodityAndGrade(form: FormData): Promise<{ commodity_id: string; grade: string | null }> {
  const commodity_id = uuid(form, 'commodity_id');
  const { data } = await adminClient().from('commodities').select('grades, active').eq('id', commodity_id).maybeSingle();
  if (!data?.active) fail('Choose a commodity.');
  const grade = text(form, 'grade', 60);
  if (grade && data.grades.length > 0 && !data.grades.includes(grade)) fail('Choose a grade from the list.');
  return { commodity_id, grade };
}

const kgPer = (form: FormData, field: string) => UNITS.find((u) => u.id === parseUnit(form.get(field) as string | null))!.kg;

/** A quantity typed in kg, quintals or tonnes (chosen in `<name>_unit`), returned as whole kg. */
function quantityKg(form: FormData, name: string, label: string, { required = true } = {}): number | null {
  const raw = form.get(name);
  const clean = typeof raw === 'string' ? raw.replace(/[,\s]/g, '') : '';
  if (!clean) return required ? fail(`${label} is required.`) : null;
  if (!/^\d{1,9}(\.\d{1,3})?$/.test(clean)) fail(`${label} must be a number.`);
  const exact = Number(clean) * kgPer(form, `${name}_unit`);
  const kg = Math.round(exact);
  // Stored in whole kg: refuse rather than silently change what was typed (tolerance only for float noise).
  if (Math.abs(exact - kg) > 1e-6) fail(`${label} must come to a whole number of kg.`);
  if (kg < 1 || kg > 100_000_000) fail(`${label} must be between 1 kg and 100,000 tonnes.`);
  return kg;
}

const rs = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/**
 * A price typed per kg, quintal or tonne (chosen in `<name>_unit`), returned as paise per kg. Prices are stored in
 * whole paise per kg, so a price that doesn't divide exactly is refused with the two nearest prices that do.
 */
function pricePerKg(form: FormData, name: string): number | null {
  const paise = toPaise(form.get(name));
  if (paise === null) return null;
  const per = kgPer(form, `${name}_unit`);
  if (paise % per !== 0) {
    const unit = UNITS.find((u) => u.kg === per)!.short;
    const lo = Math.floor(paise / per) * per, hi = lo + per;
    fail(`Prices are kept to the paisa per kg. Use ${lo > 0 ? `${rs(lo)} or ` : ''}${rs(hi)} per ${unit}.`);
  }
  return paise / per;
}

function listingTerms(form: FormData, quantity: number) {
  const min_order_kg = quantityKg(form, 'min_order', 'Minimum order', { required: false });
  if (min_order_kg !== null && min_order_kg > quantity) fail('The minimum order cannot be more than the quantity listed.');
  return { min_order_kg };
}

export async function createListing(_: ActionState, form: FormData): Promise<ActionState> {
  let id = '';
  const result = await run(async () => {
    const viewer = await requireViewer();
    const farmer_id = await actingParty(viewer, form, 'farmer');
    const quantity_kg = quantityKg(form, 'quantity', 'Quantity')!;
    const price = pricePerKg(form, 'price') ?? fail('Enter the price in rupees, e.g. 2450');
    const row = check(await adminClient().from('listings').insert({
      farmer_id,
      ...(await commodityAndGrade(form)),
      quantity_kg,
      price_paise_per_kg: price,
      ...listingTerms(form, quantity_kg),
      location: text(form, 'location', 200),
      pin: pin(form, 'pin'),
      available_from: date(form, 'available_from'),
      packaging: text(form, 'packaging', 80),
      harvest: text(form, 'harvest', 60),
      moisture_pct: pct(form, 'moisture_pct', 'Moisture'),
      foreign_matter_pct: pct(form, 'foreign_matter_pct', 'Foreign matter'),
      broken_pct: pct(form, 'broken_pct', 'Broken / damaged'),
      purity_pct: pct(form, 'purity_pct', 'Purity'),
      negotiable: form.get('fixed_price') !== 'on',
      notes: text(form, 'notes', 1000),
      created_by: viewer.userId,
    }).select('id').single());
    id = row.id;
  });
  if (result?.error) return result;
  revalidatePath('/market');
  revalidatePath('/listings');
  redirect(`/listings/${id}`);
}

export async function createRequirement(_: ActionState, form: FormData): Promise<ActionState> {
  let id = '';
  const result = await run(async () => {
    const viewer = await requireViewer();
    const buyer_id = await actingParty(viewer, form, 'buyer');
    const target = form.get('price') ? pricePerKg(form, 'price') ?? fail('Enter a valid target price.') : null;
    const row = check(await adminClient().from('requirements').insert({
      buyer_id,
      ...(await commodityAndGrade(form)),
      quantity_kg: quantityKg(form, 'quantity', 'Quantity'),
      target_price_paise_per_kg: target,
      delivery_location: text(form, 'delivery_location', 200),
      pin: pin(form, 'pin'),
      needed_by: date(form, 'needed_by'),
      notes: text(form, 'notes', 1000),
      created_by: viewer.userId,
    }).select('id').single());
    id = row.id;
  });
  if (result?.error) return result;
  revalidatePath('/market');
  revalidatePath('/requirements');
  redirect(`/requirements/${id}`);
}

type PostKind = 'listing' | 'requirement';
function postKind(form: FormData): PostKind {
  const k = form.get('kind');
  if (k !== 'listing' && k !== 'requirement') fail('Invalid request.');
  return k;
}

interface Post {
  kind: PostKind; id: string; owner: string; status: string; qty: number;
  price: number | null; moq: number | null; negotiable: boolean; paused: boolean;
}

async function loadPost(kind: PostKind, id: string): Promise<Post | null> {
  const db = adminClient();
  if (kind === 'listing') {
    const { data } = await db.from('listings')
      .select('id, farmer_id, status, quantity_kg, price_paise_per_kg, min_order_kg, negotiable, paused').eq('id', id).maybeSingle();
    return data ? {
      kind, id: data.id, owner: data.farmer_id, status: data.status, qty: data.quantity_kg,
      price: Number(data.price_paise_per_kg), moq: data.min_order_kg, negotiable: data.negotiable, paused: data.paused,
    } : null;
  }
  const { data } = await db.from('requirements')
    .select('id, buyer_id, status, quantity_kg, target_price_paise_per_kg').eq('id', id).maybeSingle();
  return data ? {
    kind, id: data.id, owner: data.buyer_id, status: data.status, qty: data.quantity_kg,
    price: data.target_price_paise_per_kg === null ? null : Number(data.target_price_paise_per_kg),
    moq: null, negotiable: true, paused: false,
  } : null;
}

function revalidatePost(post: Pick<Post, 'kind' | 'id'>) {
  revalidatePath(`/${post.kind}s/${post.id}`);
  revalidatePath(`/${post.kind}s`);
  revalidatePath('/market');
  revalidatePath('/dashboard');
}

async function ownedPost(viewer: Viewer, form: FormData): Promise<Post> {
  const post = await loadPost(postKind(form), uuid(form, 'id')) ?? fail('Not found.');
  if (!viewer.isAdmin && post.owner !== viewer.party?.id) fail('Not allowed.');
  return post;
}

export async function closePost(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const viewer = await requireViewer();
    const post = await ownedPost(viewer, form);
    const db = adminClient();
    check(await db.from(post.kind === 'listing' ? 'listings' : 'requirements').update({ status: 'closed' }).eq('id', post.id));
    const { data: declined } = await db.from('offers').update({ status: 'rejected', responded_at: new Date().toISOString() })
      .eq(post.kind === 'listing' ? 'listing_id' : 'requirement_id', post.id).eq('status', 'pending').select('id');
    if (declined?.length) {
      check(await db.from('offer_messages').insert(declined.map((o) => ({
        offer_id: o.id, party_id: post.owner, kind: 'reject', message: `The ${post.kind} was closed.`, actor_id: viewer.userId,
      }))));
    }
    revalidatePost(post);
    return 'Closed. Pending offers were declined.';
  });
}

/** Owner edits price, quantity and (listings) minimum order of an open post. Live offers keep their own terms. */
export async function updatePost(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const viewer = await requireViewer();
    const post = await ownedPost(viewer, form);
    if (post.status !== 'open') fail('Only open posts can be edited.');
    const quantity_kg = quantityKg(form, 'quantity', 'Quantity')!;
    const db = adminClient();
    if (post.kind === 'listing') {
      const price = pricePerKg(form, 'price') ?? fail('Enter the price.');
      check(await db.from('listings').update({
        quantity_kg, price_paise_per_kg: price, ...listingTerms(form, quantity_kg),
      }).eq('id', post.id));
    } else {
      const target = form.get('price') ? pricePerKg(form, 'price') ?? fail('Enter a valid target price.') : null;
      check(await db.from('requirements').update({ quantity_kg, target_price_paise_per_kg: target }).eq('id', post.id));
    }
    revalidatePost(post);
    return 'Saved.';
  });
}

/** Pause hides a listing from the market without closing it; pending offers wait until it is resumed. */
export async function setListingPaused(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const viewer = await requireViewer();
    const post = await ownedPost(viewer, form);
    if (post.kind !== 'listing' || post.status !== 'open') fail('Only open listings can be paused.');
    const paused = form.get('paused') === 'true';
    check(await adminClient().from('listings').update({ paused }).eq('id', post.id));
    revalidatePost(post);
    return paused ? 'Paused. It is hidden from the market until you resume it.' : 'Resumed. It is back on the market.';
  });
}

function checkQuantity(post: Post, quantity_kg: number) {
  if (quantity_kg > post.qty) fail(`Only ${post.qty.toLocaleString('en-IN')} kg is ${post.kind === 'listing' ? 'available' : 'needed'}.`);
  if (post.moq && quantity_kg < post.moq && quantity_kg !== post.qty) {
    fail(`The minimum order is ${post.moq.toLocaleString('en-IN')} kg.`);
  }
}

export async function makeOffer(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const viewer = await requireViewer();
    const kind = postKind(form);
    const post = await loadPost(kind, uuid(form, 'id')) ?? fail('Not found.');
    if (post.status !== 'open' || post.paused) fail('This is no longer open.');
    // Buyers answer listings; farmers answer requirements.
    const party_id = await actingParty(viewer, form, kind === 'listing' ? 'buyer' : 'farmer');
    if (party_id === post.owner) fail('You cannot make an offer on your own post.');
    const quantity_kg = quantityKg(form, 'quantity', 'Quantity')!;
    checkQuantity(post, quantity_kg);
    const price = post.negotiable
      ? pricePerKg(form, 'price') ?? fail('Enter your price in rupees.')
      : post.price!; // fixed-price listings: the buyer takes the asking price
    const { data: open } = await adminClient().from('offers').select('id')
      .eq(kind === 'listing' ? 'listing_id' : 'requirement_id', post.id).eq('party_id', party_id).eq('status', 'pending').limit(1);
    if (open?.length) fail('You already have an open offer here. Counter or withdraw it instead.');
    check(await adminClient().from('offers').insert({
      [kind === 'listing' ? 'listing_id' : 'requirement_id']: post.id,
      party_id,
      quantity_kg,
      price_paise_per_kg: price,
      message: text(form, 'message', 1000),
      created_by: viewer.userId,
    }));
    revalidatePost(post);
    return 'Offer sent. You will see the response here.';
  });
}

/**
 * The two sides of an offer take turns: whoever did NOT set the current terms may accept, counter or decline.
 * Returns the party the viewer acts for. Admins act for the side whose turn it is.
 */
async function negotiation(viewer: Viewer, offerId: string) {
  const db = adminClient();
  const { data: offer } = await db.from('offers').select('*').eq('id', offerId).maybeSingle();
  if (!offer) fail('Offer not found.');
  if (offer.status !== 'pending') fail('This offer is no longer open.');
  const kind: PostKind = offer.listing_id ? 'listing' : 'requirement';
  const post = await loadPost(kind, offer.listing_id ?? offer.requirement_id) ?? fail('Not found.');
  const awaited = offer.last_by === offer.party_id ? post.owner : offer.party_id;
  if (!viewer.isAdmin) {
    const me = viewer.party?.id;
    if (me !== post.owner && me !== offer.party_id) fail('Offer not found.');
    if (me !== awaited) fail('Waiting for the other side to respond.');
    if (!canTrade(viewer)) fail('Your account is waiting for verification by our team.');
  }
  return { offer, post, actingFor: awaited as string };
}

export async function respondToOffer(_: ActionState, form: FormData): Promise<ActionState> {
  let orderId = '';
  const result = await run(async () => {
    const viewer = await requireViewer();
    const decision = form.get('decision');
    if (decision !== 'accept' && decision !== 'reject') fail('Invalid request.');
    const { offer, post, actingFor } = await negotiation(viewer, uuid(form, 'offer_id'));
    const db = adminClient();

    if (decision === 'reject') {
      const { data: changed } = await db.from('offers').update({ status: 'rejected', responded_at: new Date().toISOString() })
        .eq('id', offer.id).eq('status', 'pending').select('id');
      if (changed?.length) {
        check(await db.from('offer_messages').insert({
          offer_id: offer.id, party_id: actingFor, kind: 'reject', message: text(form, 'message', 1000), actor_id: viewer.userId,
        }));
      }
      revalidatePost(post);
      return 'Offer declined.';
    }
    // The number of counters the person saw: if someone countered since, accept_offer refuses instead of locking in
    // terms they never saw.
    const seen = Number(form.get('counters'));
    orderId = check(await db.rpc('accept_offer', {
      p_offer: offer.id, p_actor: viewer.userId, p_actor_label: actorLabel(viewer),
      p_counters: Number.isInteger(seen) && seen >= 0 ? seen : offer.counters,
    })) as string;
    revalidatePost(post);
  });
  if (result?.error || !orderId) return result;
  revalidatePath('/orders');
  redirect(`/orders/${orderId}`);
}

export async function counterOffer(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const viewer = await requireViewer();
    const { offer, post, actingFor } = await negotiation(viewer, uuid(form, 'offer_id'));
    if (!post.negotiable) fail('This listing is at a fixed price, so it cannot be countered.');
    const quantity_kg = quantityKg(form, 'quantity', 'Quantity')!;
    checkQuantity(post, quantity_kg);
    const price = pricePerKg(form, 'price') ?? fail('Enter your price in rupees.');
    if (quantity_kg === offer.quantity_kg && price === Number(offer.price_paise_per_kg)) {
      fail('These are the same terms. Accept the offer instead.');
    }
    check(await adminClient().rpc('counter_offer', {
      p_offer: offer.id, p_party: actingFor, p_qty: quantity_kg, p_price: price,
      p_message: text(form, 'message', 1000), p_actor: viewer.userId,
    }));
    revalidatePost(post);
    return 'Counter-offer sent.';
  });
}

export async function withdrawOffer(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const viewer = await requireViewer();
    const db = adminClient();
    const { data: offer } = await db.from('offers').select('id, party_id, listing_id, requirement_id').eq('id', uuid(form, 'offer_id')).maybeSingle();
    if (!offer) fail('Offer not found.');
    if (!viewer.isAdmin && offer.party_id !== viewer.party?.id) fail('Not allowed.');
    const { data: changed } = await db.from('offers').update({ status: 'withdrawn', responded_at: new Date().toISOString() })
      .eq('id', offer.id).eq('status', 'pending').select('id');
    if (changed?.length) {
      check(await db.from('offer_messages').insert({ offer_id: offer.id, party_id: offer.party_id, kind: 'withdraw', actor_id: viewer.userId }));
    }
    revalidatePost({ kind: offer.listing_id ? 'listing' : 'requirement', id: offer.listing_id ?? offer.requirement_id });
    return 'Offer withdrawn.';
  });
}
