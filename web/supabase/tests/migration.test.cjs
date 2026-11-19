// Runs supabase/migrations/0001_init.sql against a THROWAWAY local Postgres (never your Supabase project) with
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
const MIGRATION = path.join(__dirname, '..', 'migrations', '0001_init.sql');
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
  await db.query(fs.readFileSync(MIGRATION, 'utf8'));
  console.log('migration applied');

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

  console.log(`\n${pass} passed, ${failN} failed`);
  await db.end();
  process.exit(failN ? 1 : 0);
})().catch((e) => { console.error('ERROR', e.message, e.position ? `at ${e.position}` : '', e.where ?? ''); process.exit(2); });
