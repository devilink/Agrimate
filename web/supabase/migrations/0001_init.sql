-- Agrimate: B2B agri-trade platform on Supabase.
-- Run once in Supabase Dashboard > SQL Editor (or `supabase db push`). Safe to read top to bottom.
--
-- Security model
--   * Every table has row-level security. Signed-in users may only SELECT, and only the rows the policies allow.
--   * Nobody writes through the Data API. All writes go through the Next.js server, which checks the user's role
--     and then uses the secret (service-role) key. anon/authenticated get no INSERT/UPDATE/DELETE anywhere.
--   * Contact, bank and tax details live in party_private, readable only by the party itself and admins.
--   * Admin rights come only from profiles.is_admin, which users cannot change.
--
-- Money is integer paise (bigint). Quantities are integer kg. Percentages are basis points (100 bps = 1%).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------------------------------------------
create type public.party_type      as enum ('buyer', 'farmer', 'transporter', 'inspector');
create type public.post_status     as enum ('open', 'closed');
create type public.offer_status    as enum ('pending', 'accepted', 'rejected', 'withdrawn');
create type public.order_status    as enum ('confirmed', 'quality_check', 'ready', 'in_transit', 'delivered',
                                            'completed', 'disputed', 'cancelled');
create type public.payment_direction as enum ('in', 'out');          -- in = from buyer, out = payout to a party
create type public.payment_method  as enum ('razorpay', 'bank_transfer', 'upi', 'cheque', 'cash', 'other');
create type public.payment_status  as enum ('confirmed', 'void');
create type public.doc_kind        as enum ('invoice', 'eway_bill', 'weighbridge_slip', 'quality_report', 'photo',
                                            'proof_of_delivery', 'other');
create type public.event_kind      as enum ('created', 'status', 'note', 'payment', 'document', 'assignment');
create type public.event_visibility as enum ('all', 'admin');

-- ---------------------------------------------------------------------------------------------------------------
-- Parties: anyone who trades or provides a service. A party may have no login at all (an offline farmer whose
-- deals an admin enters on their behalf); user_id links a login when they get one.
-- ---------------------------------------------------------------------------------------------------------------
create table public.parties (
  id          uuid primary key default gen_random_uuid(),
  type        public.party_type not null,
  name        text not null check (char_length(name) between 1 and 120),
  company     text check (char_length(company) <= 160),
  district    text check (char_length(district) <= 80),
  state       text check (char_length(state) <= 80),
  pin         text check (pin ~ '^[1-9][0-9]{5}$'),
  verified    boolean not null default false,
  active      boolean not null default true,
  user_id     uuid unique references auth.users (id) on delete set null,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index on public.parties (type);

create table public.party_private (
  party_id        uuid primary key references public.parties (id) on delete cascade,
  phone           text check (char_length(phone) <= 20),
  email           text check (char_length(email) <= 254),
  gstin           text check (gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  pan             text check (pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  address         text check (char_length(address) <= 500),
  bank_holder     text check (char_length(bank_holder) <= 120),
  bank_account_no text check (bank_account_no ~ '^[0-9]{6,20}$'),
  bank_ifsc       text check (bank_ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  upi_id          text check (char_length(upi_id) <= 100),
  admin_notes     text check (char_length(admin_notes) <= 2000),
  updated_at      timestamptz not null default now()
);

-- One row per login.
create table public.profiles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  is_admin   boolean not null default false,
  party_id   uuid unique references public.parties (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------------------------
-- Masters and settings
-- ---------------------------------------------------------------------------------------------------------------
create table public.commodities (
  id      uuid primary key default gen_random_uuid(),
  name    text not null unique check (char_length(name) between 1 and 80),
  grades  text[] not null default '{}',
  active  boolean not null default true
);

create table public.settings (
  id             int primary key default 1 check (id = 1),
  commission_bps int not null default 200 check (commission_bps between 0 and 2000),
  updated_at     timestamptz not null default now()
);
insert into public.settings (id) values (1);

-- ---------------------------------------------------------------------------------------------------------------
-- Marketplace: farmers list produce, buyers post requirements, either side makes offers.
-- ---------------------------------------------------------------------------------------------------------------
create sequence public.listing_code_seq;
create sequence public.requirement_code_seq;
create sequence public.order_code_seq;

create table public.listings (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null unique default ('L-' || to_char(nextval('public.listing_code_seq'), 'FM00000')),
  farmer_id          uuid not null references public.parties (id),
  commodity_id       uuid not null references public.commodities (id),
  grade              text check (char_length(grade) <= 60),
  quantity_kg        int not null check (quantity_kg >= 0),   -- quantity left; counts down as offers are accepted
  price_paise_per_kg bigint not null check (price_paise_per_kg > 0),
  location           text check (char_length(location) <= 200),
  pin                text check (pin ~ '^[1-9][0-9]{5}$'),
  available_from     date,
  notes              text check (char_length(notes) <= 1000),
  status             public.post_status not null default 'open',
  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now()
);
create index on public.listings (status, created_at desc);
create index on public.listings (farmer_id);

create table public.requirements (
  id                        uuid primary key default gen_random_uuid(),
  code                      text not null unique default ('R-' || to_char(nextval('public.requirement_code_seq'), 'FM00000')),
  buyer_id                  uuid not null references public.parties (id),
  commodity_id              uuid not null references public.commodities (id),
  grade                     text check (char_length(grade) <= 60),
  quantity_kg               int not null check (quantity_kg >= 0),   -- quantity still needed
  target_price_paise_per_kg bigint check (target_price_paise_per_kg > 0),
  delivery_location         text check (char_length(delivery_location) <= 200),
  pin                       text check (pin ~ '^[1-9][0-9]{5}$'),
  needed_by                 date,
  notes                     text check (char_length(notes) <= 1000),
  status                    public.post_status not null default 'open',
  created_by                uuid references auth.users (id) on delete set null,
  created_at                timestamptz not null default now()
);
create index on public.requirements (status, created_at desc);
create index on public.requirements (buyer_id);

-- An offer answers exactly one listing (made by a buyer) or one requirement (made by a farmer).
create table public.offers (
  id                 uuid primary key default gen_random_uuid(),
  listing_id         uuid references public.listings (id),
  requirement_id     uuid references public.requirements (id),
  party_id           uuid not null references public.parties (id),
  quantity_kg        int not null check (quantity_kg > 0),
  price_paise_per_kg bigint not null check (price_paise_per_kg > 0),
  message            text check (char_length(message) <= 1000),
  status             public.offer_status not null default 'pending',
  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  responded_at       timestamptz,
  check ((listing_id is null) <> (requirement_id is null))
);
create index on public.offers (listing_id);
create index on public.offers (requirement_id);
create index on public.offers (party_id);

-- ---------------------------------------------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------------------------------------------
create table public.orders (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null unique default ('AGM-' || to_char(nextval('public.order_code_seq'), 'FM000000')),
  status             public.order_status not null default 'confirmed',
  buyer_id           uuid not null references public.parties (id),
  farmer_id          uuid not null references public.parties (id),
  commodity_id       uuid not null references public.commodities (id),
  grade              text check (char_length(grade) <= 60),
  quantity_kg        int not null check (quantity_kg > 0),
  price_paise_per_kg bigint not null check (price_paise_per_kg > 0),
  -- Snapshot at contract time: later settings changes never rewrite a live order.
  goods_paise        bigint not null check (goods_paise > 0),
  commission_bps     int not null check (commission_bps between 0 and 2000),
  freight_paise      bigint not null default 0 check (freight_paise >= 0),
  listing_id         uuid references public.listings (id),
  requirement_id     uuid references public.requirements (id),
  offer_id           uuid unique references public.offers (id),
  pickup_location    text check (char_length(pickup_location) <= 300),
  delivery_location  text check (char_length(delivery_location) <= 300),
  expected_date      date,
  transporter_id     uuid references public.parties (id),
  vehicle_no         text check (char_length(vehicle_no) <= 20),
  driver_name        text check (char_length(driver_name) <= 80),
  driver_phone       text check (char_length(driver_phone) <= 20),
  inspector_id       uuid references public.parties (id),
  inspection_result  text check (inspection_result in ('pass', 'fail')),
  inspection_notes   text check (char_length(inspection_notes) <= 2000),
  received_qty_kg    int check (received_qty_kg >= 0),
  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (buyer_id <> farmer_id)
);
create index on public.orders (buyer_id);
create index on public.orders (farmer_id);
create index on public.orders (transporter_id);
create index on public.orders (inspector_id);
create index on public.orders (status, created_at desc);

-- Timeline and notes. Append-only: a trigger blocks UPDATE and DELETE, so the history can't be rewritten.
create table public.order_events (
  id          bigint generated always as identity primary key,
  order_id    uuid not null references public.orders (id) on delete cascade,
  kind        public.event_kind not null,
  from_status public.order_status,
  to_status   public.order_status,
  message     text check (char_length(message) <= 2000),
  visibility  public.event_visibility not null default 'all',
  actor_id    uuid references auth.users (id) on delete set null,
  actor_label text not null,
  created_at  timestamptz not null default now()
);
create index on public.order_events (order_id, created_at);

create function public.block_event_changes() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old; -- allow the cascade when an order itself is deleted
  end if;
  raise exception 'order_events is append-only';
end $$;
create trigger order_events_append_only before update or delete on public.order_events
  for each row execute function public.block_event_changes();

-- ---------------------------------------------------------------------------------------------------------------
-- Payments: online (Razorpay) and offline (bank, UPI, cheque, cash) in one table.
-- ---------------------------------------------------------------------------------------------------------------
create table public.payments (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references public.orders (id),
  direction           public.payment_direction not null,
  payee_party_id      uuid references public.parties (id),
  method              public.payment_method not null,
  amount_paise        bigint not null check (amount_paise > 0),
  reference           text check (char_length(reference) <= 120),
  razorpay_payment_id text unique,     -- unique: a replayed webhook or double-submit can't record a payment twice
  razorpay_order_id   text,
  paid_on             date not null default current_date,
  status              public.payment_status not null default 'confirmed',
  note                text check (char_length(note) <= 500),
  recorded_by         uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  check ((direction = 'out') = (payee_party_id is not null))
);
create index on public.payments (order_id);
create index on public.payments (payee_party_id);

-- Razorpay orders we created, so the amount is always taken from our side, never from the browser.
create table public.razorpay_orders (
  id           text primary key,
  order_id     uuid not null references public.orders (id),
  amount_paise bigint not null check (amount_paise > 0),
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now()
);

create table public.documents (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders (id),
  kind         public.doc_kind not null,
  file_name    text not null check (char_length(file_name) <= 200),
  storage_path text not null unique,
  uploaded_by  uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index on public.documents (order_id);

create table public.audit_log (
  id         bigint generated always as identity primary key,
  actor_id   uuid references auth.users (id) on delete set null,
  action     text not null,
  entity     text not null,
  entity_id  text,
  data       jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index on public.audit_log (created_at desc);

-- ---------------------------------------------------------------------------------------------------------------
-- Helpers used by the policies. SECURITY DEFINER with an empty search_path: they read profiles without recursing
-- through its own policy, and can't be hijacked by objects in other schemas.
-- ---------------------------------------------------------------------------------------------------------------
create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.is_admin from public.profiles p where p.user_id = auth.uid()), false)
$$;

-- Null for deactivated parties, so a disabled user's still-valid token can't read anything party-scoped.
create function public.my_party_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.party_id from public.profiles p join public.parties pa on pa.id = p.party_id
   where p.user_id = auth.uid() and pa.active
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- New login -> profile. Self sign-ups get a new unverified buyer/farmer/transporter party. Only the server (with
-- the secret key) can set app_metadata, so only it can create admins or link a login to an existing party.
-- ---------------------------------------------------------------------------------------------------------------
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_admin boolean := coalesce((new.raw_app_meta_data ->> 'is_admin')::boolean, false);
  v_party uuid := nullif(new.raw_app_meta_data ->> 'party_id', '')::uuid;
  v_type  public.party_type;
  v_name  text;
begin
  if v_party is null and not v_admin then
    v_type := case new.raw_user_meta_data ->> 'party_type'
                when 'farmer' then 'farmer'
                when 'transporter' then 'transporter'
                else 'buyer'
              end::public.party_type;
    v_name := left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1), 'User'), 120);
    insert into public.parties (type, name, company, user_id, created_by)
      values (v_type, v_name, left(nullif(trim(new.raw_user_meta_data ->> 'company'), ''), 160), new.id, new.id)
      returning id into v_party;
    insert into public.party_private (party_id, email, phone)
      values (v_party, left(new.email, 254), left(nullif(trim(new.raw_user_meta_data ->> 'phone'), ''), 20));
  elsif v_party is not null then
    update public.parties set user_id = new.id where id = v_party and user_id is null;
  end if;
  insert into public.profiles (user_id, is_admin, party_id) values (new.id, v_admin, v_party);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Called by the server right after it creates a login for an admin or an existing party. It does not rely on
-- app_metadata having reached the signup trigger: it removes any party the trigger auto-created and links the
-- right one. Safe to run when the trigger already did the work.
create function public.link_login(p_user uuid, p_party uuid, p_admin boolean)
returns void language plpgsql set search_path = '' as $$
begin
  delete from public.parties where user_id = p_user and (p_party is null or id <> p_party);
  if p_party is not null then
    update public.parties set user_id = p_user where id = p_party and (user_id is null or user_id = p_user);
    if not found then
      raise exception 'This party already has a login.' using errcode = 'P0001';
    end if;
  end if;
  insert into public.profiles (user_id, is_admin, party_id) values (p_user, p_admin, p_party)
  on conflict (user_id) do update set is_admin = excluded.is_admin, party_id = excluded.party_id;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Transactional operations, called only by the server. Each runs atomically and records its own timeline event.
-- ---------------------------------------------------------------------------------------------------------------

-- Accept an offer: creates the order, reduces the listing/requirement quantity, and closes it when used up.
create function public.accept_offer(p_offer uuid, p_actor uuid, p_actor_label text)
returns uuid language plpgsql set search_path = '' as $$
declare
  o         public.offers;
  l         public.listings;
  r         public.requirements;
  v_order   uuid;
  v_bps     int;
  v_buyer   uuid;
  v_farmer  uuid;
  v_comm    uuid;
  v_grade   text;
  v_pickup  text;
  v_deliver text;
  v_date    date;
begin
  select * into o from public.offers where id = p_offer for update;
  if not found or o.status <> 'pending' then
    raise exception 'This offer is no longer open.' using errcode = 'P0001';
  end if;

  if o.listing_id is not null then
    select * into l from public.listings where id = o.listing_id for update;
    if l.status <> 'open' or o.quantity_kg > l.quantity_kg then
      raise exception 'The listing is closed or has less quantity left than this offer.' using errcode = 'P0001';
    end if;
    v_buyer := o.party_id; v_farmer := l.farmer_id; v_comm := l.commodity_id; v_grade := l.grade;
    v_pickup := l.location; v_date := l.available_from;
    update public.listings
       set quantity_kg = quantity_kg - o.quantity_kg,
           status = case when quantity_kg - o.quantity_kg = 0 then 'closed'::public.post_status else status end
     where id = l.id;
  else
    select * into r from public.requirements where id = o.requirement_id for update;
    if r.status <> 'open' or o.quantity_kg > r.quantity_kg then
      raise exception 'The requirement is closed or needs less than this offer.' using errcode = 'P0001';
    end if;
    v_buyer := r.buyer_id; v_farmer := o.party_id; v_comm := r.commodity_id; v_grade := r.grade;
    v_deliver := r.delivery_location; v_date := r.needed_by;
    update public.requirements
       set quantity_kg = quantity_kg - o.quantity_kg,
           status = case when quantity_kg - o.quantity_kg = 0 then 'closed'::public.post_status else status end
     where id = r.id;
  end if;

  select s.commission_bps into v_bps from public.settings s where s.id = 1;

  insert into public.orders (buyer_id, farmer_id, commodity_id, grade, quantity_kg, price_paise_per_kg, goods_paise,
                             commission_bps, listing_id, requirement_id, offer_id, pickup_location, delivery_location,
                             expected_date, created_by)
  values (v_buyer, v_farmer, v_comm, v_grade, o.quantity_kg, o.price_paise_per_kg,
          o.quantity_kg::bigint * o.price_paise_per_kg, coalesce(v_bps, 0), o.listing_id, o.requirement_id, o.id,
          v_pickup, v_deliver, v_date, p_actor)
  returning id into v_order;

  update public.offers set status = 'accepted', responded_at = now() where id = o.id;

  insert into public.order_events (order_id, kind, to_status, message, actor_id, actor_label)
  values (v_order, 'created', 'confirmed', 'Order created from an accepted offer.', p_actor, p_actor_label);
  return v_order;
end $$;

-- Move an order to a new status, only if it is still in the status the caller saw (no lost updates).
create function public.set_order_status(p_order uuid, p_from public.order_status, p_to public.order_status,
                                        p_actor uuid, p_actor_label text, p_message text)
returns void language plpgsql set search_path = '' as $$
begin
  update public.orders set status = p_to, updated_at = now() where id = p_order and status = p_from;
  if not found then
    raise exception 'The order changed in the meantime. Reload and try again.' using errcode = 'P0001';
  end if;
  insert into public.order_events (order_id, kind, from_status, to_status, message, actor_id, actor_label)
  values (p_order, 'status', p_from, p_to, left(p_message, 2000), p_actor, p_actor_label);
end $$;

-- Record a captured Razorpay payment. Idempotent: the browser callback and the webhook may both call it.
-- Returns true only for the call that actually recorded it.
create function public.record_razorpay_payment(p_razorpay_order text, p_payment_id text, p_amount bigint)
returns boolean language plpgsql set search_path = '' as $$
declare
  ro public.razorpay_orders;
  v_id uuid;
begin
  select * into ro from public.razorpay_orders where id = p_razorpay_order;
  if not found then
    raise exception 'Unknown Razorpay order %', p_razorpay_order using errcode = 'P0001';
  end if;
  if ro.amount_paise <> p_amount then
    raise exception 'Amount mismatch for Razorpay order %', p_razorpay_order using errcode = 'P0001';
  end if;
  insert into public.payments (order_id, direction, method, amount_paise, reference, razorpay_payment_id,
                               razorpay_order_id, note)
  values (ro.order_id, 'in', 'razorpay', p_amount, p_payment_id, p_payment_id, p_razorpay_order, 'Paid online')
  on conflict (razorpay_payment_id) do nothing
  returning id into v_id;
  if v_id is null then
    return false;
  end if;
  insert into public.order_events (order_id, kind, message, actor_label)
  values (ro.order_id, 'payment',
          'Online payment received: Rs ' || to_char(p_amount / 100.0, 'FM99,99,99,99,990.00') || ' (' || p_payment_id || ')',
          'Razorpay');
  -- Two checkouts paid in parallel can exceed what the buyer owes. Flag it for the team to refund.
  if (select coalesce(sum(p.amount_paise), 0) from public.payments p
       where p.order_id = ro.order_id and p.direction = 'in' and p.status = 'confirmed')
     > (select o.goods_paise + o.freight_paise from public.orders o where o.id = ro.order_id) then
    insert into public.order_events (order_id, kind, message, visibility, actor_label)
    values (ro.order_id, 'payment', 'OVERPAID: the buyer has paid more than the order total. Refund the excess from Razorpay.',
            'admin', 'System');
  end if;
  return true;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Grants. Revoke first: this project may have changed Supabase's default privileges, so grant explicitly.
-- ---------------------------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['parties', 'party_private', 'profiles', 'commodities', 'settings', 'listings',
                           'requirements', 'offers', 'orders', 'order_events', 'payments', 'razorpay_orders',
                           'documents', 'audit_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

grant usage on schema public to anon, authenticated, service_role;
grant usage, select on all sequences in schema public to service_role;
revoke all on all sequences in schema public from anon, authenticated;

-- Read-only access for signed-in users, filtered by the policies below. razorpay_orders stays server-only.
grant select on public.parties, public.party_private, public.profiles, public.commodities, public.settings,
                public.listings, public.requirements, public.offers, public.orders, public.order_events,
                public.payments, public.documents, public.audit_log
  to authenticated;

-- Functions: Postgres lets PUBLIC execute new functions by default. Lock each one down.
revoke all on function public.is_admin() from public, anon;
revoke all on function public.my_party_id() from public, anon;
grant execute on function public.is_admin(), public.my_party_id() to authenticated, service_role;

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.block_event_changes() from public, anon, authenticated;
revoke all on function public.accept_offer(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.set_order_status(uuid, public.order_status, public.order_status, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.record_razorpay_payment(text, text, bigint) from public, anon, authenticated;
revoke all on function public.link_login(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.link_login(uuid, uuid, boolean) to service_role;
grant execute on function public.accept_offer(uuid, uuid, text),
                          public.set_order_status(uuid, public.order_status, public.order_status, uuid, text, text),
                          public.record_razorpay_payment(text, text, bigint)
  to service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- Row-level security (SELECT only; there are deliberately no write policies)
-- ---------------------------------------------------------------------------------------------------------------
-- Names, type, district and verification are public within the platform; contact details are not.
create policy parties_read on public.parties for select to authenticated using (true);

create policy party_private_read on public.party_private for select to authenticated
  using (party_id = public.my_party_id() or public.is_admin());

create policy profiles_read on public.profiles for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy commodities_read on public.commodities for select to authenticated using (true);
create policy settings_read on public.settings for select to authenticated using (true);

create policy listings_read on public.listings for select to authenticated
  using (status = 'open' or farmer_id = public.my_party_id() or public.is_admin());

create policy requirements_read on public.requirements for select to authenticated
  using (status = 'open' or buyer_id = public.my_party_id() or public.is_admin());

-- An offer is visible to whoever made it and to the owner of the listing/requirement it answers.
create policy offers_read on public.offers for select to authenticated
  using (
    public.is_admin()
    or party_id = public.my_party_id()
    or exists (select 1 from public.listings l where l.id = listing_id and l.farmer_id = public.my_party_id())
    or exists (select 1 from public.requirements r where r.id = requirement_id and r.buyer_id = public.my_party_id())
  );

create policy orders_read on public.orders for select to authenticated
  using (
    public.is_admin()
    or public.my_party_id() in (buyer_id, farmer_id, transporter_id, inspector_id)
  );

create policy order_events_read on public.order_events for select to authenticated
  using (
    public.is_admin()
    or (visibility = 'all' and exists (select 1 from public.orders o where o.id = order_id))
  );

-- Buyer and farmer see money coming in on their order; everyone sees payouts made to themselves.
create policy payments_read on public.payments for select to authenticated
  using (
    public.is_admin()
    or payee_party_id = public.my_party_id()
    or (direction = 'in' and exists (
          select 1 from public.orders o
           where o.id = order_id and public.my_party_id() in (o.buyer_id, o.farmer_id)))
  );

create policy documents_read on public.documents for select to authenticated
  using (public.is_admin() or exists (select 1 from public.orders o where o.id = order_id));

create policy audit_log_read on public.audit_log for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------------------------------------------
-- File storage: one private bucket. No storage policies, so files are reachable only through short-lived signed
-- URLs that the server issues after checking the user may see the order.
-- ---------------------------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------------------------------------------
-- Starter commodities (edit or add more in Admin > Settings)
-- ---------------------------------------------------------------------------------------------------------------
insert into public.commodities (name, grades) values
  ('Paddy',        array['FAQ', 'Grade A', 'Common']),
  ('Wheat',        array['FAQ', 'Milling', 'Sharbati']),
  ('Maize',        array['FAQ', 'Feed grade']),
  ('Potato',       array['Large', 'Medium', 'Small']),
  ('Onion',        array['Large', 'Medium', 'Small']),
  ('Tomato',       array['Grade A', 'Grade B']),
  ('Mustard',      array['FAQ']),
  ('Tea leaf',     array['Fine', 'Medium', 'Coarse']),
  ('Turmeric',     array['Finger', 'Bulb']),
  ('Soybean',      array['FAQ'])
on conflict (name) do nothing;
