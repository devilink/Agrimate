'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { actorLabel, canTrade, requireViewer, type Viewer } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { check, date, fail, int, optionalUuid, pin, run, text, uuid, type ActionState } from '@/lib/action';
import { toPaise } from '@/lib/money';
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

export async function createListing(_: ActionState, form: FormData): Promise<ActionState> {
  let id = '';
  const result = await run(async () => {
    const viewer = await requireViewer();
    const farmer_id = await actingParty(viewer, form, 'farmer');
    const price = toPaise(form.get('price')) ?? fail('Enter the price per kg in rupees, e.g. 24.50');
    const row = check(await adminClient().from('listings').insert({
      farmer_id,
      ...(await commodityAndGrade(form)),
      quantity_kg: int(form, 'quantity_kg', 'Quantity (kg)'),
      price_paise_per_kg: price,
      location: text(form, 'location', 200),
      pin: pin(form, 'pin'),
      available_from: date(form, 'available_from'),
      notes: text(form, 'notes', 1000),
      created_by: viewer.userId,
    }).select('id').single());
    id = row.id;
  });
  if (result?.error) return result;
  revalidatePath('/market');
  redirect(`/listings/${id}`);
}

export async function createRequirement(_: ActionState, form: FormData): Promise<ActionState> {
  let id = '';
  const result = await run(async () => {
    const viewer = await requireViewer();
    const buyer_id = await actingParty(viewer, form, 'buyer');
    const target = form.get('target_price') ? toPaise(form.get('target_price')) ?? fail('Enter a valid target price.') : null;
    const row = check(await adminClient().from('requirements').insert({
      buyer_id,
      ...(await commodityAndGrade(form)),
      quantity_kg: int(form, 'quantity_kg', 'Quantity (kg)'),
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
  redirect(`/requirements/${id}`);
}

type PostKind = 'listing' | 'requirement';
function postKind(form: FormData): PostKind {
  const k = form.get('kind');
  if (k !== 'listing' && k !== 'requirement') fail('Invalid request.');
  return k;
}

async function loadPost(kind: PostKind, id: string) {
  const db = adminClient();
  if (kind === 'listing') {
    const { data } = await db.from('listings').select('id, farmer_id, status, quantity_kg').eq('id', id).maybeSingle();
    return data ? { id: data.id, owner: data.farmer_id as string, status: data.status as string, qty: data.quantity_kg as number } : null;
  }
  const { data } = await db.from('requirements').select('id, buyer_id, status, quantity_kg').eq('id', id).maybeSingle();
  return data ? { id: data.id, owner: data.buyer_id as string, status: data.status as string, qty: data.quantity_kg as number } : null;
}

export async function closePost(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const viewer = await requireViewer();
    const kind = postKind(form);
    const post = await loadPost(kind, uuid(form, 'id')) ?? fail('Not found.');
    if (!viewer.isAdmin && post.owner !== viewer.party?.id) fail('Not allowed.');
    const db = adminClient();
    check(await db.from(kind === 'listing' ? 'listings' : 'requirements').update({ status: 'closed' }).eq('id', post.id));
    check(await db.from('offers').update({ status: 'rejected', responded_at: new Date().toISOString() })
      .eq(kind === 'listing' ? 'listing_id' : 'requirement_id', post.id).eq('status', 'pending'));
    revalidatePath(`/${kind}s/${post.id}`);
    revalidatePath('/market');
    return 'Closed. Pending offers were declined.';
  });
}

export async function makeOffer(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const viewer = await requireViewer();
    const kind = postKind(form);
    const post = await loadPost(kind, uuid(form, 'id')) ?? fail('Not found.');
    if (post.status !== 'open') fail('This is no longer open.');
    // Buyers answer listings; farmers answer requirements.
    const party_id = await actingParty(viewer, form, kind === 'listing' ? 'buyer' : 'farmer');
    if (party_id === post.owner) fail('You cannot make an offer on your own post.');
    const quantity_kg = int(form, 'quantity_kg', 'Quantity (kg)');
    if (quantity_kg > post.qty) fail(`Only ${post.qty} kg is ${kind === 'listing' ? 'available' : 'needed'}.`);
    const price = toPaise(form.get('price')) ?? fail('Enter your price per kg in rupees.');
    check(await adminClient().from('offers').insert({
      [kind === 'listing' ? 'listing_id' : 'requirement_id']: post.id,
      party_id,
      quantity_kg,
      price_paise_per_kg: price,
      message: text(form, 'message', 1000),
      created_by: viewer.userId,
    }));
    revalidatePath(`/${kind}s/${post.id}`);
    return 'Offer sent. You will see the response here.';
  });
}

export async function respondToOffer(_: ActionState, form: FormData): Promise<ActionState> {
  let orderId = '';
  const result = await run(async () => {
    const viewer = await requireViewer();
    const decision = form.get('decision');
    if (decision !== 'accept' && decision !== 'reject') fail('Invalid request.');
    const db = adminClient();
    const { data: offer } = await db.from('offers').select('*').eq('id', uuid(form, 'offer_id')).maybeSingle();
    if (!offer) fail('Offer not found.');
    const kind: PostKind = offer.listing_id ? 'listing' : 'requirement';
    const post = await loadPost(kind, offer.listing_id ?? offer.requirement_id) ?? fail('Not found.');
    if (!viewer.isAdmin && post.owner !== viewer.party?.id) fail('Only the owner of this post can respond.');
    if (!canTrade(viewer)) fail('Your account is waiting for verification by our team.');

    if (decision === 'reject') {
      check(await db.from('offers').update({ status: 'rejected', responded_at: new Date().toISOString() })
        .eq('id', offer.id).eq('status', 'pending'));
      revalidatePath(`/${kind}s/${post.id}`);
      return 'Offer declined.';
    }
    orderId = check(await db.rpc('accept_offer', {
      p_offer: offer.id, p_actor: viewer.userId, p_actor_label: actorLabel(viewer),
    })) as string;
  });
  if (result?.error || !orderId) return result;
  revalidatePath('/orders');
  redirect(`/orders/${orderId}`);
}

export async function withdrawOffer(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const viewer = await requireViewer();
    const db = adminClient();
    const { data: offer } = await db.from('offers').select('id, party_id, listing_id, requirement_id').eq('id', uuid(form, 'offer_id')).maybeSingle();
    if (!offer) fail('Offer not found.');
    if (!viewer.isAdmin && offer.party_id !== viewer.party?.id) fail('Not allowed.');
    check(await db.from('offers').update({ status: 'withdrawn', responded_at: new Date().toISOString() })
      .eq('id', offer.id).eq('status', 'pending'));
    revalidatePath(offer.listing_id ? `/listings/${offer.listing_id}` : `/requirements/${offer.requirement_id}`);
    return 'Offer withdrawn.';
  });
}
