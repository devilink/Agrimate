-- Agrimate 0002: deeper marketplace and admin tools.
-- Run once in Supabase Dashboard > SQL Editor AFTER 0001_init.sql. Safe on a database that already has data.
--
-- Adds:
--   * Listings: quality specs, minimum order quantity, packaging, harvest, "fixed price" and pausing.
--   * Negotiation: counter-offers, with an append-only message thread per offer.
--   * Trust: verification checklist flags on parties, and a completed-trades counter kept by a trigger.
--   * Reference market prices entered by the Agrimate team (never simulated), for price benchmarks.
--   * A freight rate card the team uses to estimate freight.
--   * Server-only finance functions for the admin overview and payouts queue.
--
-- Same security model as 0001: signed-in users may only SELECT rows the policies allow; every write goes through
-- the server with the secret key.

-- ---------------------------------------------------------------------------------------------------------------
-- Listings: quality and terms
-- ---------------------------------------------------------------------------------------------------------------
alter table public.listings
  add column min_order_kg       int check (min_order_kg > 0),
  add column packaging          text check (char_length(packaging) <= 80),
  add column harvest            text check (char_length(harvest) <= 60),
  add column moisture_pct       numeric(5,2) check (moisture_pct between 0 and 100),
  add column foreign_matter_pct numeric(5,2) check (foreign_matter_pct between 0 and 100),
  add column broken_pct         numeric(5,2) check (broken_pct between 0 and 100),
  add column purity_pct         numeric(5,2) check (purity_pct between 0 and 100),
  add column negotiable         boolean not null default true,
  -- Paused listings are hidden from the market but keep their offers. A boolean rather than a new post_status
  -- value, so this script never depends on an enum value added in the same transaction.
  add column paused             boolean not null default false;

drop policy listings_read on public.listings;
create policy listings_read on public.listings for select to authenticated
  using ((status = 'open' and not paused) or farmer_id = public.my_party_id() or public.is_admin());

-- ---------------------------------------------------------------------------------------------------------------
-- Negotiation. An offer's quantity and price are always its CURRENT terms; last_by is the party that set them.
-- The other side may accept, counter or decline. offer_messages keeps every step and can't be rewritten.
-- ---------------------------------------------------------------------------------------------------------------
alter table public.offers
  add column last_by  uuid references public.parties (id),
  add column counters int not null default 0 check (counters >= 0);
update public.offers set last_by = party_id where last_by is null;

create table public.offer_messages (
  id                 bigint generated always as identity primary key,
  offer_id           uuid not null references public.offers (id) on delete cascade,
  party_id           uuid not null references public.parties (id),   -- whose side this step is for
  kind               text not null check (kind in ('offer', 'counter', 'accept', 'reject', 'withdraw')),
  quantity_kg        int check (quantity_kg > 0),
  price_paise_per_kg bigint check (price_paise_per_kg > 0),
  message            text check (char_length(message) <= 1000),
  actor_id           uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now()
);
create index on public.offer_messages (offer_id, created_at);

create trigger offer_messages_append_only before update or delete on public.offer_messages
  for each row execute function public.block_event_changes();

-- Existing offers get their opening message, so every thread starts the same way.
insert into public.offer_messages (offer_id, party_id, kind, quantity_kg, price_paise_per_kg, message, actor_id, created_at)
select id, party_id, 'offer', quantity_kg, price_paise_per_kg, message, created_by, created_at from public.offers;

-- New offers: default last_by to the offerer and write the opening message, whoever inserts the row.
create function public.offers_before_insert() returns trigger language plpgsql set search_path = '' as $$
begin
  new.last_by := coalesce(new.last_by, new.party_id);
  return new;
end $$;
create trigger offers_set_last_by before insert on public.offers
  for each row execute function public.offers_before_insert();

create function public.offers_after_insert() returns trigger language plpgsql set search_path = '' as $$
begin
  insert into public.offer_messages (offer_id, party_id, kind, quantity_kg, price_paise_per_kg, message, actor_id, created_at)
  values (new.id, new.party_id, 'offer', new.quantity_kg, new.price_paise_per_kg, new.message, new.created_by, new.created_at);
  return new;
end $$;
create trigger offers_first_message after insert on public.offers
  for each row execute function public.offers_after_insert();

alter table public.offers alter column last_by set not null;

-- The post owner and the offerer take turns. Atomic, so two counters can't cross.
create function public.counter_offer(p_offer uuid, p_party uuid, p_qty int, p_price bigint, p_message text, p_actor uuid)
returns void language plpgsql set search_path = '' as $$
declare
  o       public.offers;
  v_owner uuid;
  v_open  boolean;
  v_left  int;
  v_moq   int;
begin
  select * into o from public.offers where id = p_offer for update;
  if not found or o.status <> 'pending' then
    raise exception 'This offer is no longer open.' using errcode = 'P0001';
  end if;
  if o.listing_id is not null then
    select l.farmer_id, l.status = 'open' and not l.paused, l.quantity_kg, l.min_order_kg
      into v_owner, v_open, v_left, v_moq from public.listings l where l.id = o.listing_id;
  else
    select r.buyer_id, r.status = 'open', r.quantity_kg, null::int
      into v_owner, v_open, v_left, v_moq from public.requirements r where r.id = o.requirement_id;
  end if;
  if p_party <> v_owner and p_party <> o.party_id then
    raise exception 'You are not part of this negotiation.' using errcode = 'P0001';
  end if;
  if o.last_by = p_party then
    raise exception 'Wait for the other side to respond to your last terms.' using errcode = 'P0001';
  end if;
  if not v_open then
    raise exception 'This post is closed or paused.' using errcode = 'P0001';
  end if;
  if p_qty is null or p_qty <= 0 or p_price is null or p_price <= 0 then
    raise exception 'Enter a quantity and a price.' using errcode = 'P0001';
  end if;
  if p_qty > v_left then
    raise exception 'Only % kg is left on this post.', v_left using errcode = 'P0001';
  end if;
  if v_moq is not null and p_qty < v_moq and p_qty <> v_left then
    raise exception 'The minimum order is % kg.', v_moq using errcode = 'P0001';
  end if;
  update public.offers
     set quantity_kg = p_qty, price_paise_per_kg = p_price, last_by = p_party, counters = counters + 1
   where id = o.id;
  insert into public.offer_messages (offer_id, party_id, kind, quantity_kg, price_paise_per_kg, message, actor_id)
  values (o.id, p_party, 'counter', p_qty, p_price, left(p_message, 1000), p_actor);
end $$;

-- accept_offer, now also refusing paused listings, enforcing the minimum order (the last remainder may be smaller)
-- and recording the acceptance in the thread. The acceptor is whichever side did NOT set the current terms.
-- p_counters is the number of counters the person saw when they clicked Accept: if the terms changed since, the
-- accept is refused rather than locking in terms they never saw. Replaced (not overloaded), so 3-argument calls
-- keep resolving to this one function.
drop function public.accept_offer(uuid, uuid, text);
create function public.accept_offer(p_offer uuid, p_actor uuid, p_actor_label text, p_counters int default null)
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
  v_owner   uuid;
begin
  select * into o from public.offers where id = p_offer for update;
  if not found or o.status <> 'pending' then
    raise exception 'This offer is no longer open.' using errcode = 'P0001';
  end if;
  if p_counters is not null and o.counters <> p_counters then
    raise exception 'The terms changed in the meantime. Reload and check the latest offer.' using errcode = 'P0001';
  end if;

  if o.listing_id is not null then
    select * into l from public.listings where id = o.listing_id for update;
    if l.status <> 'open' or o.quantity_kg > l.quantity_kg then
      raise exception 'The listing is closed or has less quantity left than this offer.' using errcode = 'P0001';
    end if;
    if l.paused then
      raise exception 'The listing is paused. Resume it to accept offers.' using errcode = 'P0001';
    end if;
    if l.min_order_kg is not null and o.quantity_kg < l.min_order_kg and o.quantity_kg <> l.quantity_kg then
      raise exception 'This offer is below the minimum order of % kg.', l.min_order_kg using errcode = 'P0001';
    end if;
    v_owner := l.farmer_id;
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
    v_owner := r.buyer_id;
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

  insert into public.offer_messages (offer_id, party_id, kind, quantity_kg, price_paise_per_kg, actor_id)
  values (o.id, case when coalesce(o.last_by, o.party_id) = o.party_id then v_owner else o.party_id end,
          'accept', o.quantity_kg, o.price_paise_per_kg, p_actor);

  insert into public.order_events (order_id, kind, to_status, message, actor_id, actor_label)
  values (v_order, 'created', 'confirmed',
          'Order created from an accepted offer' || case when o.counters > 0 then ' after negotiation.' else '.' end,
          p_actor, p_actor_label);
  return v_order;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Trust: checklist flags (public badges, set by admins) and completed trades (kept by a trigger)
-- ---------------------------------------------------------------------------------------------------------------
alter table public.parties
  add column kyc_verified     boolean not null default false,   -- PAN / Aadhaar checked
  add column gst_verified     boolean not null default false,   -- GSTIN checked on the GST portal
  add column bank_verified    boolean not null default false,   -- bank account confirmed (penny drop / cancelled cheque)
  add column is_fpo           boolean not null default false,   -- registered Farmer Producer Organisation
  add column completed_trades int not null default 0 check (completed_trades >= 0);

update public.parties p set completed_trades = (
  select count(*) from public.orders o where o.status = 'completed' and p.id in (o.buyer_id, o.farmer_id)
);

create function public.track_completed_trades() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'completed' and old.status <> 'completed' then
    update public.parties set completed_trades = completed_trades + 1 where id in (new.buyer_id, new.farmer_id);
  elsif old.status = 'completed' and new.status <> 'completed' then
    update public.parties set completed_trades = greatest(completed_trades - 1, 0) where id in (new.buyer_id, new.farmer_id);
  end if;
  return new;
end $$;
create trigger orders_track_completed after update of status on public.orders
  for each row execute function public.track_completed_trades();

-- ---------------------------------------------------------------------------------------------------------------
-- Reference market prices, entered by the team from Agmarknet / eNAM / mandi calls. Stored as paise per kg, which is
-- numerically the same as rupees per quintal (the unit mandis quote in).
-- ---------------------------------------------------------------------------------------------------------------
create table public.market_prices (
  id                 uuid primary key default gen_random_uuid(),
  commodity_id       uuid not null references public.commodities (id),
  market             text not null check (char_length(market) between 1 and 120),
  state              text check (char_length(state) <= 80),
  price_date         date not null,
  min_paise_per_kg   bigint check (min_paise_per_kg > 0),
  modal_paise_per_kg bigint not null check (modal_paise_per_kg > 0),
  max_paise_per_kg   bigint check (max_paise_per_kg > 0),
  source             text check (char_length(source) <= 120),
  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  unique (commodity_id, market, price_date),
  check (min_paise_per_kg is null or min_paise_per_kg <= modal_paise_per_kg),
  check (max_paise_per_kg is null or max_paise_per_kg >= modal_paise_per_kg)
);
create index on public.market_prices (commodity_id, price_date desc);

-- ---------------------------------------------------------------------------------------------------------------
-- Freight rate card. Used only to suggest freight; the admin still confirms the amount on each order.
-- ---------------------------------------------------------------------------------------------------------------
create table public.vehicle_rates (
  id                uuid primary key default gen_random_uuid(),
  name              text not null unique check (char_length(name) between 1 and 80),
  capacity_kg       int not null check (capacity_kg > 0),
  rate_paise_per_km bigint not null check (rate_paise_per_km > 0),
  min_charge_paise  bigint not null default 0 check (min_charge_paise >= 0),
  active            boolean not null default true
);

-- ---------------------------------------------------------------------------------------------------------------
-- Admin finance. Aggregated in SQL (not in the browser or app) because the Data API caps rows per request.
-- Server-only: called with the secret key after the app has checked the caller is an admin.
-- ---------------------------------------------------------------------------------------------------------------
create function public.order_money() returns table (
  order_id uuid, code text, status public.order_status, buyer_id uuid, farmer_id uuid, transporter_id uuid,
  goods bigint, commission bigint, freight bigint, received_in bigint, paid_farmer bigint, paid_transporter bigint,
  paid_out bigint, updated_at timestamptz
) language sql stable set search_path = '' as $$
  select o.id, o.code, o.status, o.buyer_id, o.farmer_id, o.transporter_id,
         o.goods_paise, round(o.goods_paise * o.commission_bps / 10000.0)::bigint, o.freight_paise,
         coalesce(sum(p.amount_paise) filter (where p.direction = 'in'), 0)::bigint,
         coalesce(sum(p.amount_paise) filter (where p.direction = 'out' and p.payee_party_id = o.farmer_id), 0)::bigint,
         coalesce(sum(p.amount_paise) filter (where p.direction = 'out' and p.payee_party_id = o.transporter_id), 0)::bigint,
         coalesce(sum(p.amount_paise) filter (where p.direction = 'out'), 0)::bigint,
         o.updated_at
    from public.orders o
    left join public.payments p on p.order_id = o.id and p.status = 'confirmed'
   group by o.id
$$;

create function public.finance_summary() returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'money_in',            coalesce(sum(received_in), 0),
    'money_out',           coalesce(sum(paid_out), 0),
    'gmv_completed',       coalesce(sum(goods) filter (where status = 'completed'), 0),
    'fees_earned',         coalesce(sum(commission) filter (where status = 'completed'), 0),
    'fees_pipeline',       coalesce(sum(commission) filter (where status not in ('completed', 'cancelled')), 0),
    'receivable',          coalesce(sum(greatest(goods + freight - received_in, 0)) filter (where status <> 'cancelled'), 0),
    'farmer_payable_due',  coalesce(sum(greatest(goods - commission - paid_farmer, 0)) filter (where status in ('delivered', 'completed')), 0),
    'overpaid_orders',     count(*) filter (where received_in > goods + freight),
    'stale_orders',        count(*) filter (where status in ('confirmed', 'quality_check', 'ready', 'in_transit', 'delivered', 'disputed')
                                              and updated_at < now() - interval '7 days'),
    'active_orders',       count(*) filter (where status in ('confirmed', 'quality_check', 'ready', 'in_transit', 'delivered', 'disputed')),
    'orders_by_status',    (select coalesce(jsonb_object_agg(s, n), '{}') from (
                              select status::text s, count(*) n from public.orders group by status) x)
  ) from public.order_money()
$$;

-- Orders where someone is still owed money, oldest first. Farmers become due once goods are delivered.
create function public.payouts_due(p_limit int default 200) returns table (
  order_id uuid, code text, status public.order_status, payee_party_id uuid, payee_role text,
  owed bigint, paid bigint, due bigint, updated_at timestamptz
) language sql stable set search_path = '' as $$
  select * from (
    select m.order_id, m.code, m.status, m.farmer_id, 'farmer', m.goods - m.commission, m.paid_farmer,
           m.goods - m.commission - m.paid_farmer, m.updated_at
      from public.order_money() m
     where m.status in ('delivered', 'completed') and m.goods - m.commission - m.paid_farmer > 0
    union all
    select m.order_id, m.code, m.status, m.transporter_id, 'transporter', m.freight, m.paid_transporter,
           m.freight - m.paid_transporter, m.updated_at
      from public.order_money() m
     -- Freight to the buyer may include a margin, so a transporter is listed only until their first payout.
     where m.transporter_id is not null and m.status in ('delivered', 'completed')
       and m.freight > 0 and m.paid_transporter = 0
  ) x
  order by x.updated_at asc
  limit least(greatest(p_limit, 1), 500)
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Grants and row-level security for the new objects (same pattern as 0001)
-- ---------------------------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['offer_messages', 'market_prices', 'vehicle_rates'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
grant usage, select on all sequences in schema public to service_role;
revoke all on all sequences in schema public from anon, authenticated;

grant select on public.offer_messages, public.market_prices, public.vehicle_rates to authenticated;

-- A thread is visible to whoever can see its offer (the offerer, the post owner, admins).
create policy offer_messages_read on public.offer_messages for select to authenticated
  using (exists (select 1 from public.offers o where o.id = offer_id));
create policy market_prices_read on public.market_prices for select to authenticated using (true);
create policy vehicle_rates_read on public.vehicle_rates for select to authenticated using (public.is_admin());

revoke all on function public.offers_before_insert() from public, anon, authenticated;
revoke all on function public.offers_after_insert() from public, anon, authenticated;
revoke all on function public.track_completed_trades() from public, anon, authenticated;
revoke all on function public.counter_offer(uuid, uuid, int, bigint, text, uuid) from public, anon, authenticated;
revoke all on function public.accept_offer(uuid, uuid, text, int) from public, anon, authenticated;
revoke all on function public.order_money() from public, anon, authenticated;
revoke all on function public.finance_summary() from public, anon, authenticated;
revoke all on function public.payouts_due(int) from public, anon, authenticated;
grant execute on function public.counter_offer(uuid, uuid, int, bigint, text, uuid),
                          public.accept_offer(uuid, uuid, text, int),
                          public.order_money(),
                          public.finance_summary(),
                          public.payouts_due(int)
  to service_role;
