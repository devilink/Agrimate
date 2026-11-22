'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdmin, type Viewer } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { check, date, fail, pin, required, run, text, uuid, type ActionState } from '@/lib/action';
import { toPaise } from '@/lib/money';
import type { PartyType } from '@/lib/types';
import { privateFields } from '@/lib/party-fields';

const TYPES: PartyType[] = ['buyer', 'farmer', 'transporter', 'inspector'];

async function audit(viewer: Viewer, action: string, entity: string, entity_id: string | null, data: object = {}) {
  await adminClient().from('audit_log').insert({ actor_id: viewer.userId, action, entity, entity_id, data });
}

function publicFields(form: FormData) {
  return {
    name: required(form, 'name', 'Name', 120),
    company: text(form, 'company', 160),
    district: text(form, 'district', 80),
    state: text(form, 'state', 80),
    pin: pin(form, 'pin'),
  };
}

export async function createParty(_: ActionState, form: FormData): Promise<ActionState> {
  let id = '';
  const result = await run(async () => {
    const viewer = await requireAdmin();
    const type = form.get('type') as PartyType;
    if (!TYPES.includes(type)) fail('Choose a type.');
    const priv = privateFields(form);
    const db = adminClient();
    const row = check(await db.from('parties').insert({
      type, ...publicFields(form), verified: form.get('verified') === 'on', created_by: viewer.userId,
    }).select('id').single());
    id = row.id;
    check(await db.from('party_private').insert({ party_id: id, ...priv, admin_notes: text(form, 'admin_notes', 2000) }));
    await audit(viewer, 'party.create', 'party', id, { type });
  });
  if (result?.error) return result;
  revalidatePath('/admin/parties');
  redirect(`/admin/parties/${id}`);
}

export async function updateParty(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const viewer = await requireAdmin();
    const id = uuid(form, 'party_id');
    const priv = privateFields(form);
    const db = adminClient();
    const { data: before } = await db.from('parties').select('verified, active').eq('id', id).maybeSingle();
    if (!before) fail('Not found.');
    const changes = {
      ...publicFields(form),
      verified: form.get('verified') === 'on',
      active: form.get('active') === 'on',
      kyc_verified: form.get('kyc_verified') === 'on',
      gst_verified: form.get('gst_verified') === 'on',
      bank_verified: form.get('bank_verified') === 'on',
      is_fpo: form.get('is_fpo') === 'on',
    };
    check(await db.from('parties').update(changes).eq('id', id));
    check(await db.from('party_private').upsert({
      party_id: id, ...priv, admin_notes: text(form, 'admin_notes', 2000), updated_at: new Date().toISOString(),
    }));
    await audit(viewer, 'party.update', 'party', id, {
      verified: before.verified !== changes.verified ? changes.verified : undefined,
      active: before.active !== changes.active ? changes.active : undefined,
      checklist: { kyc: changes.kyc_verified, gst: changes.gst_verified, bank: changes.bank_verified, fpo: changes.is_fpo },
    });
    revalidatePath(`/admin/parties/${id}`);
    revalidatePath('/admin/parties');
    return 'Saved.';
  });
}

/** Links the new login explicitly, rather than relying on app_metadata reaching the signup trigger. */
async function linkLogin(userId: string, partyId: string | null, isAdmin: boolean) {
  const db = adminClient();
  const { error } = await db.rpc('link_login', { p_user: userId, p_party: partyId, p_admin: isAdmin });
  if (error) {
    await db.auth.admin.deleteUser(userId); // don't leave a half-set-up login behind
    throw error;
  }
}

function newPassword(form: FormData): string {
  const v = form.get('password');
  if (typeof v !== 'string' || v.length < 8 || v.length > 72) fail('Temporary password must be 8 to 72 characters.');
  return v;
}

function loginEmail(form: FormData): string {
  const v = required(form, 'login_email', 'Email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) fail('Enter a valid email.');
  return v;
}

/** Give an existing (possibly offline) party a login. They should change the password after first sign-in. */
export async function createLoginForParty(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const viewer = await requireAdmin();
    const id = uuid(form, 'party_id');
    const db = adminClient();
    const { data: party } = await db.from('parties').select('user_id').eq('id', id).maybeSingle();
    if (!party) fail('Not found.');
    if (party.user_id) fail('This party already has a login.');
    const { data, error } = await db.auth.admin.createUser({
      email: loginEmail(form), password: newPassword(form), email_confirm: true,
      app_metadata: { party_id: id }, // only the secret key can set app_metadata
    });
    if (error || !data.user) fail(error?.code === 'email_exists' ? 'That email already has an account.' : 'Could not create the login.');
    await linkLogin(data.user.id, id, false);
    await audit(viewer, 'party.create_login', 'party', id);
    revalidatePath(`/admin/parties/${id}`);
    return 'Login created. Share the email and temporary password with them privately.';
  });
}

export async function createAdmin(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const viewer = await requireAdmin();
    const { data, error } = await adminClient().auth.admin.createUser({
      email: loginEmail(form), password: newPassword(form), email_confirm: true, app_metadata: { is_admin: true },
    });
    if (error || !data.user) fail(error?.code === 'email_exists' ? 'That email already has an account.' : 'Could not create the admin.');
    await linkLogin(data.user.id, null, true);
    await audit(viewer, 'admin.create', 'user', data.user.id);
    return 'Admin created.';
  });
}

export async function updateSettings(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const viewer = await requireAdmin();
    const pct = Number(form.get('commission_pct'));
    const bps = Math.round(pct * 100);
    if (!Number.isFinite(pct) || bps < 0 || bps > 2000) fail('Platform fee must be between 0 and 20%.');
    check(await adminClient().from('settings').update({ commission_bps: bps, updated_at: new Date().toISOString() }).eq('id', 1));
    await audit(viewer, 'settings.update', 'settings', '1', { commission_bps: bps });
    revalidatePath('/admin/settings');
    return 'Saved. New orders use this fee; existing orders keep theirs.';
  });
}

export async function saveCommodity(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const viewer = await requireAdmin();
    const idRaw = form.get('id');
    const grades = (text(form, 'grades', 1000) ?? '')
      .split(',').map((g) => g.trim()).filter(Boolean).slice(0, 30);
    if (grades.some((g) => g.length > 60)) fail('Each grade must be 60 characters or fewer.');
    const row = { name: required(form, 'name', 'Name', 80), grades, active: form.get('active') !== 'off' };
    const db = adminClient();
    if (typeof idRaw === 'string' && idRaw) {
      check(await db.from('commodities').update(row).eq('id', uuid(form, 'id')));
    } else {
      const { error } = await db.from('commodities').insert(row);
      if (error?.code === '23505') fail('That commodity already exists.');
      if (error) throw error;
    }
    await audit(viewer, 'commodity.save', 'commodity', typeof idRaw === 'string' ? idRaw || null : null, row);
    revalidatePath('/admin/settings');
    return 'Saved.';
  });
}

// ---- Reference market prices --------------------------------------------------------------------------------------

/** Rupees per quintal as typed (mandis quote this unit) -> paise per kg, which is the same number. */
function perQuintal(form: FormData, name: string, label: string, isRequired: boolean): number | null {
  const raw = form.get(name);
  if (!isRequired && (raw === null || raw === '')) return null;
  const paise = toPaise(raw) ?? fail(`${label} must be a price in rupees per quintal.`);
  if (paise % 100 !== 0) fail(`${label}: enter whole rupees per quintal.`); // stored as paise per kg
  return paise / 100;
}

export async function saveMarketPrice(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const viewer = await requireAdmin();
    const commodity_id = uuid(form, 'commodity_id');
    const price_date = date(form, 'price_date') ?? fail('Enter the date of the price.');
    if (price_date > new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })) fail('The price date cannot be in the future.');
    const row = {
      commodity_id,
      market: required(form, 'market', 'Market / mandi', 120),
      state: text(form, 'state', 80),
      price_date,
      min_paise_per_kg: perQuintal(form, 'min', 'Minimum', false),
      modal_paise_per_kg: perQuintal(form, 'modal', 'Modal price', true)!,
      max_paise_per_kg: perQuintal(form, 'max', 'Maximum', false),
      source: text(form, 'source', 120),
      created_by: viewer.userId,
    };
    if (row.min_paise_per_kg !== null && row.min_paise_per_kg > row.modal_paise_per_kg) fail('Minimum cannot be above the modal price.');
    if (row.max_paise_per_kg !== null && row.max_paise_per_kg < row.modal_paise_per_kg) fail('Maximum cannot be below the modal price.');
    // One price per commodity, market and day: entering it again corrects it.
    check(await adminClient().from('market_prices').upsert(row, { onConflict: 'commodity_id,market,price_date' }));
    await audit(viewer, 'price.save', 'market_price', null, { commodity_id, market: row.market, price_date, modal: row.modal_paise_per_kg });
    revalidatePath('/admin/prices');
    revalidatePath('/prices');
    return 'Price saved.';
  });
}

export async function deleteMarketPrice(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const viewer = await requireAdmin();
    const id = uuid(form, 'id');
    check(await adminClient().from('market_prices').delete().eq('id', id));
    await audit(viewer, 'price.delete', 'market_price', id);
    revalidatePath('/admin/prices');
    revalidatePath('/prices');
    return 'Deleted.';
  });
}

// ---- Freight rate card --------------------------------------------------------------------------------------------

export async function saveVehicleRate(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const viewer = await requireAdmin();
    const capacityT = Number(form.get('capacity_t'));
    if (!Number.isFinite(capacityT) || capacityT <= 0 || capacityT > 60) fail('Capacity must be between 0 and 60 tonnes.');
    const row = {
      name: required(form, 'name', 'Vehicle', 80),
      capacity_kg: Math.round(capacityT * 1000),
      rate_paise_per_km: toPaise(form.get('rate_per_km')) ?? fail('Enter the rate per km in rupees.'),
      min_charge_paise: form.get('min_charge') ? toPaise(form.get('min_charge')) ?? fail('Enter the minimum charge in rupees.') : 0,
      active: form.get('active') !== 'off',
    };
    const db = adminClient();
    const idRaw = form.get('id');
    const { error } = typeof idRaw === 'string' && idRaw
      ? await db.from('vehicle_rates').update(row).eq('id', uuid(form, 'id'))
      : await db.from('vehicle_rates').insert(row);
    if (error?.code === '23505') fail('A vehicle with that name already exists.');
    if (error) throw error;
    await audit(viewer, 'vehicle_rate.save', 'vehicle_rate', typeof idRaw === 'string' ? idRaw || null : null, row);
    revalidatePath('/admin/settings');
    return 'Saved.';
  });
}
