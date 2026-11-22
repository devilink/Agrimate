// Runs every file in supabase/migrations (in order) against a THROWAWAY local Postgres (never your Supabase project) with
// minimal stand-ins for Supabase's auth/storage schemas and roles, then checks the security model.
//
//   TEST_PG_URL=postgres://postgres@localhost:5432/postgres pnpm test:db
//
// It creates and drops a database named agrimate_test on that server.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const BASE = process.env.TEST_PG_URL;
if (!BASE) { console.error('Set TEST_PG_URL to a local, disposable Postgres server.'); process.exit(2); }
if (/supabase\.(co|com)/.test(BASE)) { console.error('Refusing to run against Supabase. Use a local Postgres.'); process.exit(2); }
const MIGRATIONS = path.join(__dirname, '..', 'migrations');
const testUrl = () => { const u = new URL(BASE); u.pathname = '/agrimate_test'; return u.toString(); };

const SUPA = `
do $r$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; end if; end $r$;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text,
  raw_app_meta_data jsonb not null default '{}', raw_user_meta_data jsonb not null default '{}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
-- Supabase's default privileges grant everything to these roles; simulate the worst case for the new tables.
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
`;

let pass = 0, failN = 0;
function ok(cond, name, extra = '') { if (cond) { pass++; console.log('  ok   ', name); } else { failN++; console.log('  FAIL ', name, extra); } }

(async () => {
  const root = new Client({ connectionString: BASE });
  await root.connect();
  await root.query('drop database if exists agrimate_test'); await root.query('create database agrimate_test'); await root.end();
  const db = new Client({ connectionString: testUrl() });
  await db.connect();
  await db.query(SUPA);
  for (const f of fs.readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).sort()) {
    await db.query(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'));
    console.log('applied', f);
  }

  const q = (s, p) => db.query(s, p).then((r) => r.rows);
  const as = async (uid, fn) => {
    await db.query('begin');
    await db.query(`set local role authenticated`);
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid]);
    try { return await fn(); } finally { await db.query('rollback'); }
  };
  const asService = async (fn) => { await db.query('set role service_role'); try { return await fn(); } finally { await db.query('reset role'); } };
  const throws = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };

  // --- signup trigger
  const [farmerU] = await q(`insert into auth.users (email, raw_user_meta_data) values ('f@x.in', '{"party_type":"farmer","name":"Ramesh","phone":"+919999"}') returning id`);
  const [buyerU] = await q(`insert into auth.users (email, raw_user_meta_data) values ('b@x.in', '{"party_type":"buyer","name":"Buyer Co"}') returning id`);
  const [otherU] = await q(`insert into auth.users (email, raw_user_meta_data) values ('o@x.in', '{"party_type":"buyer","name":"Other"}') returning id`);
  const [sneakyU] = await q(`insert into auth.users (email, raw_user_meta_data) values ('s@x.in', '{"party_type":"admin","is_admin":true,"party_id":"00000000-0000-0000-0000-000000000000"}') returning id`);
  const [adminU] = await q(`insert into auth.users (email, raw_app_meta_data) values ('a@x.in', '{"is_admin":true}') returning id`);
  const prof = async (u) => (await q(`select p.is_admin, pa.type, pa.id party, pa.name from public.profiles p left join public.parties pa on pa.id = p.party_id where p.user_id = $1`, [u.id]))[0];
  const F = await prof(farmerU), Bp = await prof(buyerU), O = await prof(otherU), S = await prof(sneakyU), A = await prof(adminU);
  ok(F.type === 'farmer' && F.name === 'Ramesh' && !F.is_admin, 'self signup creates a farmer party');
  ok(S.type === 'buyer' && !S.is_admin, 'user_metadata cannot grant admin or another party', JSON.stringify(S));
  ok(A.is_admin && A.party === null, 'app_metadata.is_admin creates an admin');
  const priv = await q(`select phone, email from public.party_private where party_id = $1`, [F.party]);
  ok(priv[0]?.phone === '+919999', 'private row created with phone');

  // Link a login to an offline party
  const [off] = await q(`insert into public.parties (type, name) values ('farmer', 'Offline Farmer') returning id`);
  const [offU] = await q(`insert into auth.users (email, raw_app_meta_data) values ('off@x.in', $1) returning id`, [JSON.stringify({ party_id: off.id })]);
  ok((await q(`select user_id from public.parties where id = $1`, [off.id]))[0].user_id === offU.id, 'app_metadata.party_id links login to an existing party');
  const dup = await throws(() => q(`insert into auth.users (email, raw_app_meta_data) values ('off2@x.in', $1)`, [JSON.stringify({ party_id: off.id })]));
  ok(dup && /unique/.test(dup), 'a second login for the same party is refused', dup);

  // --- marketplace flow as the server (service role)
  await q(`update public.parties set verified = true`);
  const [comm] = await q(`select id from public.commodities where name = 'Paddy'`);
  let orderId, listingId, offerId;
  await asService(async () => {
    [{ id: listingId }] = await q(`insert into public.listings (farmer_id, commodity_id, quantity_kg, price_paise_per_kg) values ($1,$2,10000,2400) returning id`, [F.party, comm.id]);
    [{ id: offerId }] = await q(`insert into public.offers (listing_id, party_id, quantity_kg, price_paise_per_kg) values ($1,$2,4000,2350) returning id`, [listingId, Bp.party]);
    [{ accept_offer: orderId }] = await q(`select public.accept_offer($1, $2, 'test')`, [offerId, farmerU.id]);
  });
  const [ord] = await q(`select * from public.orders where id = $1`, [orderId]);
  const [lst] = await q(`select quantity_kg, status, code from public.listings where id = $1`, [listingId]);
  ok(ord && Number(ord.goods_paise) === 4000 * 2350 && ord.commission_bps === 200 && /^AGM-\d{6}$/.test(ord.code), 'accept_offer creates the order with a snapshot fee', ord && ord.code);
  ok(lst.quantity_kg === 6000 && lst.status === 'open' && lst.code === 'L-00001', 'listing quantity reduced and stays open');
  const again = await throws(() => asService(() => q(`select public.accept_offer($1, $2, 'x')`, [offerId, farmerU.id])));
  ok(again && /no longer open/.test(again), 'an offer cannot be accepted twice');
  // Full-quantity offer closes the listing
  await asService(async () => {
    const [{ id }] = await q(`insert into public.offers (listing_id, party_id, quantity_kg, price_paise_per_kg) values ($1,$2,6000,2400) returning id`, [listingId, O.party]);
    await q(`select public.accept_offer($1, $2, 'x')`, [id, farmerU.id]);
  });
  const [lst2] = await q(`select quantity_kg, status from public.listings where id = $1`, [listingId]);
  ok(lst2.quantity_kg === 0 && lst2.status === 'closed', 'listing closes when fully sold');

  // --- status + events
  const bad = await throws(() => asService(() => q(`select public.set_order_status($1, 'ready', 'in_transit', null, 'x', null)`, [orderId])));
  ok(bad && /changed in the meantime/.test(bad), 'set_order_status refuses a stale "from" status');
  await asService(() => q(`select public.set_order_status($1, 'confirmed', 'ready', null, 'x', 'ok')`, [orderId]));
  ok((await q(`select status from public.orders where id = $1`, [orderId]))[0].status === 'ready', 'set_order_status moves the order');
  const upd = await throws(() => asService(() => q(`update public.order_events set message = 'rewritten' where order_id = $1`, [orderId])));
  ok(upd && /append-only/.test(upd), 'order_events cannot be rewritten, even by the server');
  await asService(() => q(`insert into public.order_events (order_id, kind, message, visibility, actor_label) values ($1, 'note', 'secret', 'admin', 'admin')`, [orderId]));

  // --- Razorpay recording is idempotent and amount-checked
  await asService(() => q(`insert into public.razorpay_orders (id, order_id, amount_paise) values ('order_RZP1', $1, 500000)`, [orderId]));
  const r1 = await asService(() => q(`select public.record_razorpay_payment('order_RZP1', 'pay_1', 500000) r`));
  const r2 = await asService(() => q(`select public.record_razorpay_payment('order_RZP1', 'pay_1', 500000) r`));
  ok(r1[0].r === true && r2[0].r === false, 'Razorpay payment recorded once even if reported twice');
  ok((await q(`select count(*)::int n from public.payments where razorpay_payment_id = 'pay_1'`))[0].n === 1, 'exactly one payment row');
  const mism = await throws(() => asService(() => q(`select public.record_razorpay_payment('order_RZP1', 'pay_2', 1)`)));
  ok(mism && /mismatch/.test(mism), 'amount mismatch rejected');

  // --- what signed-in users can see / do through the Data API
  await as(buyerU.id, async () => {
    ok((await q(`select id from public.orders`)).length === 1, 'buyer sees their own order');
    ok((await q(`select party_id from public.party_private`)).length === 1, 'buyer sees only their own private details');
    const ev = await q(`select message from public.order_events where order_id = $1`, [orderId]);
    ok(ev.length >= 2 && !ev.some((e) => e.message === 'secret'), 'buyer sees timeline but not internal admin notes');
    ok((await q(`select id from public.payments`)).length === 1, 'buyer sees incoming payments on their order');
  });
  await as(otherU.id, async () => {
    const seen = await q(`select id from public.orders where id = $1`, [orderId]);
    ok(seen.length === 0, 'an unrelated buyer cannot see the order');
    ok((await q(`select * from public.party_private where party_id = $1`, [F.party])).length === 0, "others cannot read a farmer's bank/contact details");
    ok((await q(`select id from public.order_events where order_id = $1`, [orderId])).length === 0, 'others cannot read the timeline');
    ok((await q(`select id from public.payments where order_id = $1`, [orderId])).length === 0, 'others cannot read payments');
  });
  for (const [label, sql, params] of [
    ['insert listing', `insert into public.listings (farmer_id, commodity_id, quantity_kg, price_paise_per_kg) values ($1,$2,1,1)`, [F.party, comm.id]],
    ['update own party verified', `update public.parties set verified = true where id = $1`, [F.party]],
    ['make self admin', `update public.profiles set is_admin = true`, []],
    ['insert payment', `insert into public.payments (order_id, direction, method, amount_paise) values ($1,'in','cash',1)`, [orderId]],
    ['read razorpay_orders', `select * from public.razorpay_orders`, []],
    ['call accept_offer', `select public.accept_offer($1, $2, 'x')`, [offerId, farmerU.id]],
    ['call record_razorpay_payment', `select public.record_razorpay_payment('order_RZP1','pay_9',500000)`, []],
  ]) {
    const e = await throws(() => as(farmerU.id, () => q(sql, params)));
    ok(e && /permission denied/.test(e), `authenticated cannot ${label}`, e ?? 'succeeded!');
  }
  const anonRead = await throws(async () => { await db.query('begin'); await db.query('set local role anon'); try { await q('select * from public.parties'); } finally { await db.query('rollback'); } });
  ok(anonRead && /permission denied/.test(anonRead), 'anon cannot read anything', anonRead ?? 'succeeded!');
  await as(adminU.id, async () => {
    ok((await q(`select party_id from public.party_private`)).length === 4, 'admin reads all private details');
    ok((await q(`select message from public.order_events where message = 'secret'`)).length === 1, 'admin sees internal notes');
  });

  // --- link_login: works even if app_metadata never reached the signup trigger
  const [lateU] = await q(`insert into auth.users (email) values ('late@x.in') returning id`);
  const autoParty = (await prof(lateU)).party;
  const [off2] = await q(`insert into public.parties (type, name) values ('farmer', 'Offline 2') returning id`);
  await asService(() => q(`select public.link_login($1, $2, false)`, [lateU.id, off2.id]));
  const late = await prof(lateU);
  ok(late.party === off2.id && !late.is_admin, 'link_login links a login to the offline party');
  ok((await q(`select count(*)::int n from public.parties where id = $1`, [autoParty]))[0].n === 0, 'link_login removes the auto-created party');
  const [lateA] = await q(`insert into auth.users (email) values ('late-admin@x.in') returning id`);
  await asService(() => q(`select public.link_login($1, null, true)`, [lateA.id]));
  const la = await prof(lateA);
  ok(la.is_admin && la.party === null, 'link_login makes an admin without a party');
  const [thief] = await q(`insert into auth.users (email) values ('thief@x.in') returning id`);
  const taken = await throws(() => asService(() => q(`select public.link_login($1, $2, false)`, [thief.id, off2.id])));
  ok(taken && /already has a login/.test(taken), 'link_login refuses a party that already has a login');
  const linkByUser = await throws(() => as(thief.id, () => q(`select public.link_login($1, $2, true)`, [thief.id, null])));
  ok(linkByUser && /permission denied/.test(linkByUser), 'authenticated cannot call link_login');

  // --- deactivation also cuts off the Data API
  await q(`update public.parties set active = false where id = $1`, [Bp.party]);
  await as(buyerU.id, async () => {
    ok((await q(`select id from public.orders`)).length === 0, 'a deactivated buyer sees no orders');
    ok((await q(`select party_id from public.party_private`)).length === 0, 'a deactivated buyer sees no private details');
  });
  await q(`update public.parties set active = true where id = $1`, [Bp.party]);

  // --- overpayment is flagged to admins
  await asService(() => q(`insert into public.razorpay_orders (id, order_id, amount_paise) values ('order_RZP2', $1, 9000000)`, [orderId]));
  await asService(() => q(`select public.record_razorpay_payment('order_RZP2', 'pay_3', 9000000)`));
  const flag = await q(`select visibility from public.order_events where order_id = $1 and message like 'OVERPAID%'`, [orderId]);
  ok(flag.length === 1 && flag[0].visibility === 'admin', 'overpayment flagged with an admin-only event');

  // ================= 0002: pausing, minimum orders, negotiation, trust, finance =================
  let L2, offerA, offerB;
  await asService(async () => {
    [{ id: L2 }] = await q(`insert into public.listings (farmer_id, commodity_id, quantity_kg, price_paise_per_kg, min_order_kg) values ($1,$2,5000,2600,1000) returning id`, [F.party, comm.id]);
    [{ id: offerA }] = await q(`insert into public.offers (listing_id, party_id, quantity_kg, price_paise_per_kg, message) values ($1,$2,2000,2400,'opening') returning id`, [L2, Bp.party]);
  });
  const [oa] = await q(`select last_by from public.offers where id = $1`, [offerA]);
  ok(oa.last_by === Bp.party, 'a new offer starts with the offerer holding the terms');
  const firstMsg = await q(`select kind, message from public.offer_messages where offer_id = $1`, [offerA]);
  ok(firstMsg.length === 1 && firstMsg[0].kind === 'offer' && firstMsg[0].message === 'opening', 'a new offer writes its opening message');

  const ownTurn = await throws(() => asService(() => q(`select public.counter_offer($1,$2,2000,2450,null,null)`, [offerA, Bp.party])));
  ok(ownTurn && /Wait for the other side/.test(ownTurn), 'a party cannot counter its own terms');
  const outsider = await throws(() => asService(() => q(`select public.counter_offer($1,$2,2000,2450,null,null)`, [offerA, O.party])));
  ok(outsider && /not part of this negotiation/.test(outsider), 'an outsider cannot counter');
  const belowMoq = await throws(() => asService(() => q(`select public.counter_offer($1,$2,500,2500,null,null)`, [offerA, F.party])));
  ok(belowMoq && /minimum order/.test(belowMoq), 'a counter below the minimum order is refused');
  await asService(() => q(`select public.counter_offer($1,$2,3000,2500,'meet halfway',null)`, [offerA, F.party]));
  const [oa2] = await q(`select quantity_kg, price_paise_per_kg, last_by, counters from public.offers where id = $1`, [offerA]);
  ok(oa2.quantity_kg === 3000 && Number(oa2.price_paise_per_kg) === 2500 && oa2.last_by === F.party && oa2.counters === 1, 'a counter updates the current terms and passes the turn');

  // Pausing hides the listing from others and blocks acceptance
  await q(`update public.listings set paused = true where id = $1`, [L2]);
  await as(otherU.id, async () => ok((await q(`select id from public.listings where id = $1`, [L2])).length === 0, 'a paused listing is hidden from other members'));
  await as(farmerU.id, async () => ok((await q(`select id from public.listings where id = $1`, [L2])).length === 1, 'the farmer still sees their paused listing'));
  const pausedAccept = await throws(() => asService(() => q(`select public.accept_offer($1,$2,'x')`, [offerA, buyerU.id])));
  ok(pausedAccept && /paused/.test(pausedAccept), 'an offer on a paused listing cannot be accepted');
  await q(`update public.listings set paused = false where id = $1`, [L2]);

  const stale = await throws(() => asService(() => q(`select public.accept_offer($1,$2,'buyer',0)`, [offerA, buyerU.id])));
  ok(stale && /terms changed/.test(stale), 'accepting with out-of-date terms is refused', stale);
  let order2;
  await asService(async () => { [{ accept_offer: order2 }] = await q(`select public.accept_offer($1,$2,'buyer',1)`, [offerA, buyerU.id]); });
  const [o2] = await q(`select goods_paise, quantity_kg from public.orders where id = $1`, [order2]);
  ok(Number(o2.goods_paise) === 3000 * 2500, 'accepting a counter creates the order at the countered terms');
  const thread = await q(`select kind, party_id from public.offer_messages where offer_id = $1 order by id`, [offerA]);
  ok(thread.map((m) => m.kind).join(',') === 'offer,counter,accept' && thread[2].party_id === Bp.party, 'the thread records offer, counter and who accepted', JSON.stringify(thread));
  const [ev2] = await q(`select message from public.order_events where order_id = $1 and kind = 'created'`, [order2]);
  ok(/after negotiation/.test(ev2.message), 'the order timeline notes the negotiation');

  // Minimum order on acceptance; the last remainder may be smaller
  await asService(async () => {
    [{ id: offerB }] = await q(`insert into public.offers (listing_id, party_id, quantity_kg, price_paise_per_kg) values ($1,$2,500,2600) returning id`, [L2, O.party]);
  });
  const moqAccept = await throws(() => asService(() => q(`select public.accept_offer($1,$2,'x')`, [offerB, farmerU.id])));
  ok(moqAccept && /minimum order/.test(moqAccept), 'an offer below the minimum order cannot be accepted');
  await asService(async () => {
    await q(`update public.listings set quantity_kg = 500 where id = $1`, [L2]);
    await q(`select public.accept_offer($1,$2,'x')`, [offerB, farmerU.id]);
  });
  ok((await q(`select status from public.listings where id = $1`, [L2]))[0].status === 'closed', 'the last remainder below the minimum can still be sold');

  // Threads follow offer visibility, and can't be rewritten or written by users
  await as(buyerU.id, async () => ok((await q(`select id from public.offer_messages where offer_id = $1`, [offerA])).length === 3, 'the offerer reads the thread'));
  await as(farmerU.id, async () => ok((await q(`select id from public.offer_messages where offer_id = $1`, [offerA])).length === 3, 'the post owner reads the thread'));
  await as(otherU.id, async () => ok((await q(`select id from public.offer_messages where offer_id = $1`, [offerA])).length === 0, 'others cannot read the thread'));
  const rewrite = await throws(() => asService(() => q(`update public.offer_messages set message = 'x' where offer_id = $1`, [offerA])));
  ok(rewrite && /append-only/.test(rewrite), 'offer messages cannot be rewritten');

  // Completed-trades counter
  const trades = async (id) => (await q(`select completed_trades n from public.parties where id = $1`, [id]))[0].n;
  const before = [await trades(F.party), await trades(Bp.party)];
  await asService(() => q(`select public.set_order_status($1, 'confirmed', 'completed', null, 'x', null)`, [order2]));
  ok(await trades(F.party) === before[0] + 1 && await trades(Bp.party) === before[1] + 1, 'completing an order counts a trade for both sides');
  await asService(() => q(`select public.set_order_status($1, 'completed', 'disputed', null, 'x', null)`, [order2]));
  ok(await trades(F.party) === before[0], 'reopening a completed order takes the trade back');

  // Reference prices and finance (server only)
  await asService(() => q(`insert into public.market_prices (commodity_id, market, price_date, min_paise_per_kg, modal_paise_per_kg, max_paise_per_kg) values ($1,'Nagaon','2026-11-20',2200,2300,2400)`, [comm.id]));
  await as(buyerU.id, async () => ok((await q(`select id from public.market_prices`)).length === 1, 'members read reference prices'));
  const badPrice = await throws(() => asService(() => q(`insert into public.market_prices (commodity_id, market, price_date, min_paise_per_kg, modal_paise_per_kg) values ($1,'X','2026-11-20',2500,2300)`, [comm.id])));
  ok(badPrice && /check/.test(badPrice), 'a minimum above the modal price is refused');
  const [{ finance_summary: fin }] = await asService(() => q(`select public.finance_summary()`));
  ok(fin && Number(fin.money_in) > 0 && fin.overpaid_orders === 1 && typeof fin.orders_by_status === 'object', 'finance_summary aggregates payments and flags', JSON.stringify(fin));
  await asService(() => q(`select public.set_order_status($1, 'ready', 'delivered', null, 'x', null)`, [orderId]));
  const due = await asService(() => q(`select * from public.payouts_due(50)`));
  ok(due.some((d) => d.order_id === orderId && d.payee_role === 'farmer' && Number(d.due) > 0), 'payouts_due lists the farmer of a delivered order');

  for (const [label, sql, params] of [
    ['insert an offer message', `insert into public.offer_messages (offer_id, party_id, kind) values ($1,$2,'counter')`, [offerA, F.party]],
    ['insert a market price', `insert into public.market_prices (commodity_id, market, price_date, modal_paise_per_kg) values ($1,'Y','2026-11-21',1)`, [comm.id]],
    ['call counter_offer', `select public.counter_offer($1,$2,1,1,null,null)`, [offerA, F.party]],
    ['call finance_summary', `select public.finance_summary()`, []],
    ['call payouts_due', `select * from public.payouts_due(10)`, []],
    ['set own trust flags', `update public.parties set kyc_verified = true where id = $1`, [F.party]],
  ]) {
    const e = await throws(() => as(farmerU.id, () => q(sql, params)));
    ok(e && /permission denied/.test(e), `authenticated cannot ${label}`, e ?? 'succeeded!');
  }
  await as(farmerU.id, async () => ok((await q(`select id from public.vehicle_rates`)).length === 0, 'members do not see the freight rate card'));

  // Deleting an offer (demo cleanup) takes its thread with it, despite the append-only trigger
  let delOffer;
  await asService(async () => {
    const [{ id: L3 }] = await q(`insert into public.listings (farmer_id, commodity_id, quantity_kg, price_paise_per_kg) values ($1,$2,100,100) returning id`, [F.party, comm.id]);
    [{ id: delOffer }] = await q(`insert into public.offers (listing_id, party_id, quantity_kg, price_paise_per_kg) values ($1,$2,10,90) returning id`, [L3, Bp.party]);
    await q(`select public.counter_offer($1,$2,10,95,null,null)`, [delOffer, F.party]);
    await q(`delete from public.offers where id = $1`, [delOffer]);
  });
  ok((await q(`select count(*)::int n from public.offer_messages where offer_id = $1`, [delOffer]))[0].n === 0, 'deleting an offer cascades to its thread');

  await db.end();

  // ================= Upgrade path: 0002 on a database that already has 0001 data =================
  const root2 = new Client({ connectionString: BASE });
  await root2.connect();
  await root2.query('drop database if exists agrimate_test'); await root2.query('create database agrimate_test'); await root2.end();
  const up = new Client({ connectionString: testUrl() });
  await up.connect();
  await up.query(SUPA);
  const files = fs.readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).sort();
  await up.query(fs.readFileSync(path.join(MIGRATIONS, files[0]), 'utf8'));
  const uq = (s, p) => up.query(s, p).then((r) => r.rows);
  const [[fp], [bp]] = await Promise.all([
    uq(`insert into public.parties (type, name) values ('farmer','F') returning id`),
    uq(`insert into public.parties (type, name) values ('buyer','B') returning id`),
  ]);
  const [uc] = await uq(`select id from public.commodities limit 1`);
  const [ul] = await uq(`insert into public.listings (farmer_id, commodity_id, quantity_kg, price_paise_per_kg) values ($1,$2,100,100) returning id`, [fp.id, uc.id]);
  await uq(`insert into public.offers (listing_id, party_id, quantity_kg, price_paise_per_kg, message) values ($1,$2,10,90,'old offer')`, [ul.id, bp.id]);
  await uq(`insert into public.orders (buyer_id, farmer_id, commodity_id, quantity_kg, price_paise_per_kg, goods_paise, commission_bps, status) values ($1,$2,$3,1,1,1,0,'completed')`, [bp.id, fp.id, uc.id]);
  for (const f of files.slice(1)) await up.query(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'));
  const [uo] = await uq(`select last_by, party_id from public.offers`);
  const um = await uq(`select kind, message from public.offer_messages`);
  ok(uo.last_by === uo.party_id && um.length === 1 && um[0].message === 'old offer', 'upgrade: existing offers get last_by and an opening message');
  const [ut] = await uq(`select completed_trades n from public.parties where id = $1`, [fp.id]);
  ok(ut.n === 1, 'upgrade: completed trades are backfilled');
  await up.end();

  console.log(`\n${pass} passed, ${failN} failed`);
  process.exit(failN ? 1 : 0);
})().catch((e) => { console.error('ERROR', e.message, e.position ? `at ${e.position}` : '', e.where ?? ''); process.exit(2); });
