#!/usr/bin/env node
// Demo logins for every role, plus test data so every section of the app has something to show.
//
//   node scripts/demo-accounts.mjs                 set passwords (random, or DEMO_PASSWORD) + seed test data
//   node scripts/demo-accounts.mjs --no-seed       passwords only
//   node scripts/demo-accounts.mjs --seed-only     test data only, passwords untouched
//   node scripts/demo-accounts.mjs --remove-data   delete all [demo] test data again (accounts are kept)
//
// Reads NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY from .env.local.
// Accounts: override the emails with DEMO_ADMIN_EMAIL, DEMO_FARMER_EMAIL, DEMO_BUYER_EMAIL, DEMO_TRANSPORTER_EMAIL,
// DEMO_INSPECTOR_EMAIL. Missing accounts are created (confirmed, verified, linked to a new party of that role).
//
// Test data, all tagged [demo] so --remove-data finds it: open listings (with quality specs and minimum orders),
// requirements, pending offers (one mid-negotiation), sample reference prices; two
// offline parties (one waiting for verification); and orders in every status. Each order follows the real flow
// (offer accepted, inspector assigned, inspection, transport, payments, delivery, payouts) with a backdated
// timeline and PDF documents, so every role has jobs, money and history to look at.
import { createClient } from '@supabase/supabase-js';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const TAG = '[demo]';
const args = new Set(process.argv.slice(2));

function loadEnv() {
  const file = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '.env.local');
  const env = { ...process.env };
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && env[m[1]] === undefined) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
    if (!env[k]) throw new Error(`${k} is not set (in .env.local or the environment).`);
  }
  return env;
}

const env = loadEnv();
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const ACCOUNTS = [
  { role: 'admin', email: env.DEMO_ADMIN_EMAIL ?? 'admin@yourdomain.com', name: 'Agrimate Admin' },
  { role: 'farmer', email: env.DEMO_FARMER_EMAIL ?? 'farmer@yourdomain.com', name: 'Farmer Ramesh' },
  { role: 'buyer', email: env.DEMO_BUYER_EMAIL ?? 'buyer@yourdomain.com', name: 'Deccan Agro Foods' },
  { role: 'transporter', email: env.DEMO_TRANSPORTER_EMAIL ?? 'transporter@yourdomain.com', name: 'Kamrup Logistics' },
  { role: 'inspector', email: env.DEMO_INSPECTOR_EMAIL ?? 'inspector@yourdomain.com', name: 'Dr. Ramesh Baruah' },
];

function check(res) { if (res?.error) throw new Error(res.error.message); return res; }

/** 16 characters with upper, lower, digit and symbol, no look-alike characters. */
function makePassword() {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '@#%+='];
  const all = sets.join('');
  const bytes = randomBytes(32);
  const chars = sets.map((s, i) => s[bytes[i] % s.length]);
  for (let i = 4; i < 16; i++) chars.push(all[bytes[i] % all.length]);
  for (let i = chars.length - 1; i > 0; i--) { const j = bytes[16 + (i % 16)] % (i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join('');
}

async function findUser(email) {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const u = data.users.find((x) => x.email?.toLowerCase() === email.toLowerCase());
    if (u) return u;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function ensureAccount(acc, password) {
  let user = await findUser(acc.email);
  if (user) {
    const { error } = await admin.auth.admin.updateUserById(user.id, { password, email_confirm: true });
    if (error) throw new Error(`${acc.email}: ${error.message}`);
  } else {
    const meta = acc.role === 'admin' ? {} : { party_type: acc.role === 'inspector' ? 'buyer' : acc.role, name: acc.name };
    const { data, error } = await admin.auth.admin.createUser({ email: acc.email, password, email_confirm: true, user_metadata: meta });
    if (error) throw new Error(`${acc.email}: ${error.message}`);
    user = data.user;
  }

  // Make sure the profile matches the role: admins have no party; others own a verified, active party of that type.
  const { data: profile } = await admin.from('profiles').select('user_id, is_admin, party_id').eq('user_id', user.id).maybeSingle();
  if (acc.role === 'admin') {
    if (profile) check(await admin.from('profiles').update({ is_admin: true, party_id: null }).eq('user_id', user.id));
    else check(await admin.from('profiles').insert({ user_id: user.id, is_admin: true, party_id: null }));
  } else {
    let partyId = profile?.party_id ?? null;
    if (!partyId) {
      const { data: p, error } = await admin.from('parties').insert({ type: acc.role, name: acc.name, user_id: user.id, created_by: user.id, verified: true, active: true }).select('id').single();
      if (error) throw new Error(`${acc.email}: ${error.message}`);
      partyId = p.id;
      check(await admin.from('party_private').upsert({ party_id: partyId, email: acc.email }));
      if (profile) check(await admin.from('profiles').update({ party_id: partyId, is_admin: false }).eq('user_id', user.id));
      else check(await admin.from('profiles').insert({ user_id: user.id, party_id: partyId, is_admin: false }));
    }
    check(await admin.from('parties').update({ type: acc.role, verified: true, active: true }).eq('id', partyId));
  }
  return user.id;
}

/** Signs in with the public key, as the browser does, and reads back the role the app will see. */
async function verifyLogin(acc, password) {
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await anon.auth.signInWithPassword({ email: acc.email, password });
  if (error) return `sign-in FAILED: ${error.message}`;
  const { data: prof } = await anon.from('profiles').select('is_admin, party:parties(type, verified, active)').eq('user_id', data.user.id).maybeSingle();
  await anon.auth.signOut();
  const role = prof?.is_admin ? 'admin' : prof?.party?.type;
  if (role !== acc.role) return `signed in, but the app sees role "${role ?? 'none'}"`;
  return 'ok';
}

async function partyOf(userId) {
  const { data } = await admin.from('profiles').select('party_id').eq('user_id', userId).single();
  return data.party_id;
}

// ---------------------------------------------------------------------------------------------------------------
// Removal
// ---------------------------------------------------------------------------------------------------------------
async function removeDemoData() {
  // Orders first: their documents (and stored files) and payments, then the order itself. Its timeline goes with
  // it: the append-only trigger allows the cascade from an order delete.
  const { data: evs } = await admin.from('order_events').select('order_id').like('message', `${TAG}%`);
  const orderIds = [...new Set((evs ?? []).map((e) => e.order_id))];
  for (const id of orderIds) {
    // Leave "completed" first, so the completed-trades counter on the parties is taken back by its trigger.
    check(await admin.from('orders').update({ status: 'cancelled' }).eq('id', id).eq('status', 'completed'));
    const { data: docs } = await admin.from('documents').select('storage_path').eq('order_id', id);
    if (docs?.length) await admin.storage.from('documents').remove(docs.map((d) => d.storage_path));
    for (const t of ['documents', 'payments', 'razorpay_orders']) check(await admin.from(t).delete().eq('order_id', id));
    check(await admin.from('orders').delete().eq('id', id));
  }

  const { data: offline } = await admin.from('party_private').select('party_id').like('admin_notes', `${TAG}%`);
  const offIds = (offline ?? []).map((x) => x.party_id);

  const { data: ls } = await admin.from('listings').select('id').like('notes', `${TAG}%`);
  const { data: rs } = await admin.from('requirements').select('id').like('notes', `${TAG}%`);
  const lIds = (ls ?? []).map((x) => x.id);
  const rIds = (rs ?? []).map((x) => x.id);
  if (lIds.length) check(await admin.from('offers').delete().in('listing_id', lIds));
  if (rIds.length) check(await admin.from('offers').delete().in('requirement_id', rIds));
  if (offIds.length) check(await admin.from('offers').delete().in('party_id', offIds));
  for (const [table, ids] of [['listings', lIds], ['requirements', rIds]]) {
    for (const id of ids) {
      const { error } = await admin.from(table).delete().eq('id', id);
      if (error) {
        // Used by a real order someone made from a demo post: close it instead of breaking that order.
        check(await admin.from(table).update({ status: 'closed' }).eq('id', id));
        console.log(`  kept ${table} ${id} (a non-demo order uses it), closed it instead`);
      }
    }
  }
  // Offer threads (offer_messages) go with their offers through the foreign key cascade.
  const { count: priceCount } = check(await admin.from('market_prices').delete({ count: 'exact' }).like('source', `${TAG}%`));
  for (const id of offIds) {
    const { error } = await admin.from('parties').delete().eq('id', id).is('user_id', null);
    if (error) console.log(`  kept offline party ${id}: ${error.message}`);
  }
  console.log(`Removed: ${orderIds.length} orders, ${lIds.length} listings, ${rIds.length} requirements, ${offIds.length} offline parties, ${priceCount ?? 0} reference prices, and their offers.`);
}

// ---------------------------------------------------------------------------------------------------------------
// Marketplace: open posts and pending offers
// ---------------------------------------------------------------------------------------------------------------
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const gradeOf = (c, i = 0) => c.grades?.[i % Math.max(c.grades.length, 1)] ?? null;

async function seedMarket(ids, commodities) {
  const { count } = await admin.from('listings').select('id', { count: 'exact', head: true }).like('notes', `${TAG}%`).eq('status', 'open');
  if (count) { console.log(`Open demo listings already present (${count}); skipping the market.`); return; }
  const pick = (i) => commodities[i % commodities.length];
  const farmer = await partyOf(ids.farmer);
  const buyer = await partyOf(ids.buyer);

  const listings = [
    { c: pick(0), qty: 5000, price: 3200, loc: 'Nagaon, Assam', pin: '782001', from: day(2), note: 'Freshly harvested, cleaned and bagged.',
      moq: 1000, packaging: '50 kg PP bags', harvest: 'Kharif 2026', moisture: 12, fm: 1, broken: 2, purity: 98, negotiable: true },
    { c: pick(1), qty: 12000, price: 2450, loc: 'Barpeta, Assam', pin: '781301', from: day(5), note: 'FPO aggregate.',
      moq: 2000, packaging: 'Loose', harvest: 'Rabi 2026', moisture: 11.5, fm: 0.5, broken: null, purity: 99, negotiable: true },
    { c: pick(2), qty: 3000, price: 5800, loc: 'Jorhat, Assam', pin: '785001', from: day(1), note: 'Sorted, ready for pickup from the farm gate.',
      moq: null, packaging: '25 kg bags', harvest: null, moisture: null, fm: null, broken: null, purity: null, negotiable: false },
  ];
  const { data: L } = check(await admin.from('listings').insert(listings.map((l, i) => ({
    farmer_id: farmer, commodity_id: l.c.id, grade: gradeOf(l.c, i), quantity_kg: l.qty, price_paise_per_kg: l.price,
    location: l.loc, pin: l.pin, available_from: l.from, notes: `${TAG} ${l.note}`, created_by: ids.farmer,
    min_order_kg: l.moq, packaging: l.packaging, harvest: l.harvest, moisture_pct: l.moisture, foreign_matter_pct: l.fm,
    broken_pct: l.broken, purity_pct: l.purity, negotiable: l.negotiable,
  }))).select('id, code'));

  const reqs = [
    { c: pick(1), qty: 8000, price: 2400, loc: 'Hyderabad, Telangana', pin: '500032', by: day(14), note: 'Need weekly supply for our processing unit.' },
    { c: pick(3), qty: 4000, price: 4100, loc: 'Guwahati, Assam', pin: '781001', by: day(10), note: 'Grade A only. Quality inspection required before dispatch.' },
  ];
  const { data: R } = check(await admin.from('requirements').insert(reqs.map((r, i) => ({
    buyer_id: buyer, commodity_id: r.c.id, grade: gradeOf(r.c, i), quantity_kg: r.qty, target_price_paise_per_kg: r.price,
    delivery_location: r.loc, pin: r.pin, needed_by: r.by, notes: `${TAG} ${r.note}`, created_by: ids.buyer,
  }))).select('id, code'));

  const { data: O } = check(await admin.from('offers').insert([
    { listing_id: L[0].id, party_id: buyer, quantity_kg: 2000, price_paise_per_kg: 3000, message: 'Can collect within a week. Open to inspection at pickup.', created_by: ids.buyer },
    { listing_id: L[2].id, party_id: buyer, quantity_kg: 1500, price_paise_per_kg: 5800, message: 'Regular buyer, can repeat monthly.', created_by: ids.buyer },
    { requirement_id: R[0].id, party_id: farmer, quantity_kg: 5000, price_paise_per_kg: 2450, message: 'Can supply 5 tonnes now and the rest next month.', created_by: ids.farmer },
  ]).select('id'));
  // A negotiation in progress: the farmer countered the buyer's first offer, so it is the buyer's turn.
  check(await admin.rpc('counter_offer', {
    p_offer: O[0].id, p_party: farmer, p_qty: 2500, p_price: 3150, p_message: 'Can do 3,150 if you take 2.5 tonnes.', p_actor: ids.farmer,
  }));
  console.log(`Seeded ${L.length} listings, ${R.length} requirements and 3 pending offers (one mid-negotiation).`);
}

/** Sample reference prices, labelled as such in their source, so the Prices page and benchmarks have data. */
async function seedPrices(commodities) {
  const { count } = await admin.from('market_prices').select('id', { count: 'exact', head: true }).like('source', `${TAG}%`);
  if (count) { console.log(`Demo reference prices already present (${count}); skipping.`); return; }
  const markets = [['Nagaon', 'Assam', 0.98], ['Barpeta', 'Assam', 1.0], ['Guwahati (Fancy Bazar)', 'Assam', 1.04]];
  const base = [3150, 2400, 5700, 4000];
  const rows = [];
  commodities.slice(0, 4).forEach((c, ci) => {
    for (let d = 42; d >= 0; d -= 3) {
      for (const [market, state, f] of markets) {
        const modal = Math.round(base[ci] * f * (1 + 0.04 * Math.sin((d + ci * 7) / 9)));
        rows.push({ commodity_id: c.id, market, state, price_date: day(-d), min_paise_per_kg: Math.round(modal * 0.95),
          modal_paise_per_kg: modal, max_paise_per_kg: Math.round(modal * 1.05), source: `${TAG} sample data, not a real price` });
      }
    }
  });
  check(await admin.from('market_prices').insert(rows));
  console.log(`Seeded ${rows.length} sample reference prices (source "${TAG} sample data").`);
}

// ---------------------------------------------------------------------------------------------------------------
// Orders. Mirrors what accept_offer and the order actions write, with backdated times so the history reads like
// real trade. Each order gets an admin-only "[demo]" timeline note: that is how --remove-data finds it.
// ---------------------------------------------------------------------------------------------------------------
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
const rupees = (p) => inr.format(p / 100);
const METHOD = { bank_transfer: 'Bank transfer (NEFT/RTGS/IMPS)', upi: 'UPI', cheque: 'Cheque', cash: 'Cash' };
const DOC = { quality_report: 'Quality report', proof_of_delivery: 'Proof of delivery', weighbridge_slip: 'Weighbridge slip', invoice: 'Invoice', eway_bill: 'E-way bill', photo: 'Photo' };

/** A small valid one-page PDF, so documents open in the browser. */
function pdf(title) {
  const text = title.replace(/[()\\]/g, '');
  const stream = `BT /F1 18 Tf 72 720 Td (${text}) Tj 0 -28 Td /F1 11 Tf (Agrimate test document - not a real record) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = objs.map((o, i) => { const at = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

async function seedOrders(ids, commodities) {
  const { count } = await admin.from('order_events').select('id', { count: 'exact', head: true }).like('message', `${TAG}%`);
  if (count) { console.log(`Demo orders already present (${count}); skipping orders. Use --remove-data to reset.`); return; }

  const { data: settings } = await admin.from('settings').select('commission_bps').eq('id', 1).single();
  const bps = settings?.commission_bps ?? 200;
  const P = {};
  for (const role of ['farmer', 'buyer', 'transporter', 'inspector']) {
    const { data } = await admin.from('parties').select('id, name, type').eq('id', await partyOf(ids[role])).single();
    P[role] = { ...data, user: ids[role], label: `${data.name} (${data.type})` };
  }
  const team = { user: ids.admin, label: 'Agrimate team' };

  // Two offline parties the team trades for: a verified FPO, and a sign-up still waiting for verification.
  const offline = async (type, name, company, district, verified) => {
    const { data } = check(await admin.from('parties').insert({ type, name, company, district, state: 'Assam', verified, active: true, created_by: ids.admin }).select('id, name, type').single());
    check(await admin.from('party_private').upsert({ party_id: data.id, phone: '+919800000000', admin_notes: `${TAG} Test party created by scripts/demo-accounts.mjs` }));
    return { ...data, user: null, label: `${data.name} (${data.type})` };
  };
  const fpo = await offline('farmer', 'Brahmaputra Farmers FPO', 'Brahmaputra Farmers Producer Co.', 'Dibrugarh', true);
  await offline('farmer', 'Majuli Organic Growers', null, 'Majuli', false);

  const c = (i) => commodities[i % commodities.length];

  /** A sold-out listing, the buyer's accepted offer and the order, as accept_offer writes them, `daysAgo` days back. */
  async function deal({ farmer, cm, qty, price, pickup, deliver, daysAgo, expectIn }) {
    let t = Date.now() - daysAgo * 86400000;
    const iso = (ms = t) => new Date(ms).toISOString();
    const created = iso();
    const { data: listing } = check(await admin.from('listings').insert({
      farmer_id: farmer.id, commodity_id: cm.id, grade: gradeOf(cm), quantity_kg: 0, price_paise_per_kg: price + 150,
      location: pickup, status: 'closed', notes: `${TAG} Sold out.`, created_by: farmer.user ?? ids.admin, created_at: iso(t - 2 * 86400000),
    }).select('id').single());
    const { data: offer } = check(await admin.from('offers').insert({
      listing_id: listing.id, party_id: P.buyer.id, quantity_kg: qty, price_paise_per_kg: price, status: 'accepted',
      message: 'Agreed on call. Please arrange inspection.', created_by: ids.buyer, created_at: iso(t - 86400000), responded_at: created,
    }).select('id').single());
    const goods = qty * price;
    const { data: order } = check(await admin.from('orders').insert({
      buyer_id: P.buyer.id, farmer_id: farmer.id, commodity_id: cm.id, grade: gradeOf(cm), quantity_kg: qty,
      price_paise_per_kg: price, goods_paise: goods, commission_bps: bps, listing_id: listing.id, offer_id: offer.id,
      pickup_location: pickup, delivery_location: deliver, expected_date: iso(t + expectIn * 86400000).slice(0, 10),
      created_by: farmer.user ?? ids.admin, created_at: created, updated_at: created,
    }).select('*').single());

    let status = 'confirmed';
    const later = (hours) => { t += hours * 3600000; };
    const ev = async (kind, message, actor, extra = {}) => check(await admin.from('order_events').insert({
      order_id: order.id, kind, message, actor_id: actor.user ?? null, actor_label: actor.label, created_at: iso(), ...extra,
    }));
    const patch = async (fields) => check(await admin.from('orders').update({ ...fields, updated_at: iso() }).eq('id', order.id));

    await ev('created', 'Order created from an accepted offer.', farmer.user ? farmer : team, { to_status: 'confirmed' });
    await ev('note', `${TAG} Test order created by scripts/demo-accounts.mjs.`, team, { visibility: 'admin' });

    const freight = Math.round(qty * 1.2) * 100; // about Rs 1.20 a kg
    const total = goods + freight;
    const o = {
      order, goods, freight, total,
      farmerNet: goods - Math.round((goods * bps) / 10000),
      async move(to, actor, message, hours = 6) {
        later(hours);
        await patch({ status: to });
        await ev('status', message, actor, { from_status: status, to_status: to });
        status = to;
      },
      async note(message, actor, hours = 2, visibility = 'all') { later(hours); await ev('note', message, actor, { visibility }); },
      async inspector(hours = 4) {
        later(hours);
        await patch({ inspector_id: P.inspector.id, inspection_result: null });
        await ev('assignment', `Quality inspector: ${P.inspector.name}.`, team);
        await o.move('quality_check', team, 'Quality check scheduled.', 0);
      },
      async inspect(result, notes, hours = 20) {
        later(hours);
        await patch({ inspection_result: result, inspection_notes: notes });
        await ev('note', `Quality inspection ${result === 'pass' ? 'PASSED' : 'FAILED'}: ${notes}`, P.inspector);
        await o.doc('quality_report', `Quality report ${order.code}.pdf`, P.inspector, 0);
        if (result === 'pass') await o.move('ready', P.inspector, 'Passed quality check.', 0);
      },
      async transport(vehicle, driver, phone, hours = 3) {
        later(hours);
        await patch({ transporter_id: P.transporter.id, vehicle_no: vehicle, driver_name: driver, driver_phone: phone, freight_paise: freight });
        await ev('assignment', `Transport: ${P.transporter.name}, vehicle ${vehicle}. Freight ${rupees(freight)}.`, team);
      },
      async pay(direction, method, amount, ref, payee = null, hours = 5) {
        later(hours);
        const online = method === 'razorpay';
        check(await admin.from('payments').insert({
          order_id: order.id, direction, payee_party_id: payee?.id ?? null, method, amount_paise: amount, reference: ref,
          razorpay_payment_id: online ? ref : null, paid_on: iso().slice(0, 10), note: online ? 'Paid online' : null,
          recorded_by: online ? null : ids.admin, created_at: iso(),
        }));
        const what = online ? `Online payment received: ${rupees(amount)} (${ref})`
          : direction === 'in' ? `Payment received from buyer: ${rupees(amount)} by ${METHOD[method]} (ref ${ref}).`
          : `Payout to ${payee.type}: ${rupees(amount)} by ${METHOD[method]} (ref ${ref}).`;
        await ev('payment', what, online ? { label: 'Razorpay' } : team);
      },
      async doc(kind, name, actor, hours = 1) {
        later(hours);
        const storagePath = `${order.id}/${randomUUID()}`;
        const up = await admin.storage.from('documents').upload(storagePath, pdf(name.replace(/\.pdf$/, '')), { contentType: 'application/pdf' });
        if (up.error) throw new Error(`upload: ${up.error.message}`);
        check(await admin.from('documents').insert({ order_id: order.id, kind, file_name: name, storage_path: storagePath, uploaded_by: actor.user ?? null, created_at: iso() }));
        await ev('document', `${DOC[kind]} uploaded: ${name}`, actor);
      },
    };
    return o;
  }

  const made = [];
  let o;

  // 1. Confirmed: just agreed, nothing assigned yet. On the admin's to-do list.
  o = await deal({ farmer: P.farmer, cm: c(4), qty: 2500, price: 2800, pickup: 'Nagaon, Assam', deliver: 'Guwahati, Assam', daysAgo: 0.3, expectIn: 6 });
  made.push(`${o.order.code} confirmed`);

  // 2. Quality check: inspector assigned, inspection pending. The inspector's open job.
  o = await deal({ farmer: P.farmer, cm: c(5), qty: 4000, price: 4150, pickup: 'Barpeta, Assam', deliver: 'Siliguri, West Bengal', daysAgo: 1.5, expectIn: 5 });
  await o.inspector();
  await o.note('Inspection booked for tomorrow 10 am at the farm gate.', team);
  made.push(`${o.order.code} quality_check`);

  // 3. Ready: passed inspection, truck assigned, 30% advance paid. The transporter's next pickup.
  o = await deal({ farmer: fpo, cm: c(6), qty: 6000, price: 2600, pickup: 'Dibrugarh, Assam', deliver: 'Kolkata, West Bengal', daysAgo: 4, expectIn: 4 });
  await o.inspector();
  await o.inspect('pass', 'Moisture 11.5%, foreign matter under 1%. Matches the agreed grade.');
  await o.transport('AS01 BC 4521', 'Bikash Kalita', '+919864012345');
  await o.pay('in', 'bank_transfer', Math.round(o.total * 0.3), 'UTR HDFC000412873');
  made.push(`${o.order.code} ready`);

  // 4. In transit: picked up, paid in full online. The transporter's live trip.
  o = await deal({ farmer: P.farmer, cm: c(7), qty: 3500, price: 5200, pickup: 'Jorhat, Assam', deliver: 'Hyderabad, Telangana', daysAgo: 6, expectIn: 5 });
  await o.inspector();
  await o.inspect('pass', 'Uniform size, no pest damage seen.');
  await o.transport('AS03 AC 7788', 'Ranjit Das', '+919706055512');
  await o.pay('in', 'razorpay', o.total, `pay_TEST${o.order.code.replace(/\W/g, '')}`);
  await o.doc('weighbridge_slip', `Weighbridge ${o.order.code}.pdf`, P.transporter, 18);
  await o.move('in_transit', P.transporter, 'Picked up', 0);
  await o.note('Crossed Siliguri, expected at the buyer in 2 days.', P.transporter, 30);
  made.push(`${o.order.code} in_transit`);

  // 5. Delivered: waiting for the buyer to accept. On the buyer's to-do list.
  o = await deal({ farmer: P.farmer, cm: c(0), qty: 2000, price: 3300, pickup: 'Nagaon, Assam', deliver: 'Guwahati, Assam', daysAgo: 8, expectIn: 4 });
  await o.inspector();
  await o.inspect('pass', 'Clean and dry, bagged in 50 kg sacks as agreed.');
  await o.transport('AS01 DD 1209', 'Mukul Bora', '+919435011122');
  await o.pay('in', 'upi', o.total, 'UPI 431298776512');
  await o.move('in_transit', P.transporter, 'Picked up', 20);
  await o.move('delivered', P.transporter, 'Delivered', 30);
  await o.doc('proof_of_delivery', `POD ${o.order.code}.pdf`, P.transporter, 0);
  made.push(`${o.order.code} delivered`);

  // 6. Completed: accepted, farmer and transporter paid out. The full money trail.
  o = await deal({ farmer: P.farmer, cm: c(1), qty: 8000, price: 2400, pickup: 'Barpeta, Assam', deliver: 'Hyderabad, Telangana', daysAgo: 18, expectIn: 6 });
  await o.inspector();
  await o.inspect('pass', 'Moisture 12%, within contract. Approved for dispatch.');
  await o.transport('AS01 EC 3344', 'Bikash Kalita', '+919864012345');
  const half = Math.round(o.total * 0.5);
  await o.pay('in', 'bank_transfer', half, 'UTR ICIC000188234');
  await o.move('in_transit', P.transporter, 'Picked up', 20);
  await o.move('delivered', P.buyer, 'Goods received', 70);
  await o.doc('proof_of_delivery', `POD ${o.order.code}.pdf`, P.transporter, 0);
  await o.pay('in', 'bank_transfer', o.total - half, 'UTR ICIC000190771', null, 10);
  await o.move('completed', P.buyer, null, 4);
  await o.doc('invoice', `Invoice ${o.order.code}.pdf`, team, 2);
  await o.pay('out', 'bank_transfer', o.farmerNet, 'UTR SBIN000301122', P.farmer, 20);
  await o.pay('out', 'upi', o.freight, 'UPI 431277001234', P.transporter, 1);
  made.push(`${o.order.code} completed`);

  // 7. Disputed: the buyer received less than invoiced. On the admin's to-do list.
  o = await deal({ farmer: fpo, cm: c(2), qty: 3000, price: 5700, pickup: 'Dibrugarh, Assam', deliver: 'Guwahati, Assam', daysAgo: 10, expectIn: 4 });
  await o.inspector();
  await o.inspect('pass', 'Good colour and size at loading.');
  await o.transport('AS06 B 9081', 'Ranjit Das', '+919706055512');
  await o.pay('in', 'cheque', Math.round(o.total * 0.5), 'Cheque 004512');
  await o.move('in_transit', P.transporter, 'Picked up', 20);
  await o.move('delivered', P.transporter, 'Delivered', 40);
  check(await admin.from('orders').update({ received_qty_kg: 2840 }).eq('id', o.order.id));
  await o.move('disputed', P.buyer, 'Received 2,840 kg against 3,000 kg invoiced, and about 5% of the bags were damp. Asking for a price adjustment.', 8);
  await o.note('Called the farmer and the transporter. Checking the weighbridge slip from loading.', team, 3, 'admin');
  made.push(`${o.order.code} disputed`);

  // 8. Cancelled: failed inspection, called off.
  o = await deal({ farmer: P.farmer, cm: c(3), qty: 1500, price: 4000, pickup: 'Jorhat, Assam', deliver: 'Guwahati, Assam', daysAgo: 12, expectIn: 5 });
  await o.inspector();
  await o.inspect('fail', 'Moisture 17%, well above the 12% limit. Visible mould in some bags.');
  await o.move('cancelled', team, 'Failed quality check. Farmer and buyer agreed to cancel.', 6);
  made.push(`${o.order.code} cancelled`);

  console.log(`Seeded ${made.length} orders:\n  ${made.join('\n  ')}\nand 2 offline parties (Majuli Organic Growers is waiting for verification).`);
}

async function seed(ids) {
  const { data: commodities } = await admin.from('commodities').select('id, name, grades').eq('active', true).order('name');
  if (!commodities?.length) throw new Error('No active commodities. Run the migration first.');
  await seedMarket(ids, commodities);
  await seedOrders(ids, commodities);
  await seedPrices(commodities);
  // Show the trust badges on the demo farmer.
  check(await admin.from('parties').update({ kyc_verified: true, bank_verified: true, is_fpo: true }).eq('id', await partyOf(ids.farmer)));
}

async function main() {
  if (args.has('--remove-data')) return removeDemoData();

  if (args.has('--seed-only')) {
    const ids = {};
    for (const acc of ACCOUNTS) {
      const u = await findUser(acc.email);
      if (!u) throw new Error(`${acc.email} does not exist. Run without --seed-only first.`);
      ids[acc.role] = u.id;
    }
    return seed(ids);
  }

  const shared = env.DEMO_PASSWORD;
  if (shared && shared.length < 10) throw new Error('DEMO_PASSWORD must be at least 10 characters.');
  const ids = {};
  const rows = [];
  for (const acc of ACCOUNTS) {
    const password = shared || makePassword();
    ids[acc.role] = await ensureAccount(acc, password);
    rows.push({ role: acc.role, email: acc.email, password, check: await verifyLogin(acc, password) });
  }

  if (!args.has('--no-seed')) await seed(ids);

  console.log('\nDemo logins (sign in at /login; admins can also use /adminagri):\n');
  for (const r of rows) console.log(`  ${r.role.padEnd(12)} ${r.email.padEnd(30)} ${r.password}   ${r.check}`);
  console.log('\nThese are shown once. Change them before sharing the site publicly.');
  if (rows.some((r) => r.check !== 'ok')) process.exitCode = 1;
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
