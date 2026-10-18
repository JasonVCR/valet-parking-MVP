-- Valet Parking MVP — initial Supabase/PostgreSQL schema
-- Review in a development project before applying anywhere else.

create extension if not exists pgcrypto;

create type public.operator_status as enum ('pending', 'active', 'suspended');
create type public.pricing_unit as enum ('per_stay', 'per_day', 'per_hour');
create type public.hold_status as enum ('active', 'consumed', 'expired', 'released');
create type public.booking_status as enum ('confirmed', 'active', 'completed', 'cancelled');
create type public.payment_status as enum ('pending', 'processing', 'succeeded', 'failed', 'cancelled', 'partially_refunded', 'refunded');

-- Auth-linked customer profile. The customer row is created after signup.
create table public.customers (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (length(trim(full_name)) > 0),
  email text not null check (position('@' in email) > 1),
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index customers_email_lower_uidx on public.customers (lower(email));

create table public.operators (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  name text not null check (length(trim(name)) > 0),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  legal_name text,
  country_code char(2) not null,
  currency char(3) not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  status public.operator_status not null default 'pending',
  platform_fee_bps integer not null check (platform_fee_bps between 0 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index operators_owner_user_idx on public.operators(owner_user_id);

create table public.operator_stripe_accounts (
  operator_id uuid primary key references public.operators(id) on delete cascade,
  stripe_account_id text not null unique,
  charges_enabled boolean not null default false,
  payouts_enabled boolean not null default false,
  details_submitted boolean not null default false,
  onboarding_completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.airports (
  id uuid primary key default gen_random_uuid(),
  iata_code char(3) not null unique check (iata_code ~ '^[A-Z]{3}$'),
  name text not null,
  city text not null,
  country_code char(2) not null,
  timezone text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.facilities (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete restrict,
  airport_id uuid not null references public.airports(id) on delete restrict,
  name text not null,
  address text not null,
  latitude numeric(9,6),
  longitude numeric(9,6),
  total_capacity integer not null check (total_capacity > 0),
  operational_buffer integer not null default 0,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint facilities_buffer_valid check (operational_buffer >= 0 and operational_buffer < total_capacity),
  constraint facilities_latitude_valid check (latitude is null or latitude between -90 and 90),
  constraint facilities_longitude_valid check (longitude is null or longitude between -180 and 180),
  unique (id, operator_id)
);
create index facilities_airport_active_idx on public.facilities(airport_id, active);
create index facilities_operator_idx on public.facilities(operator_id);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities(id) on delete cascade,
  name text not null,
  description text,
  price_amount bigint not null check (price_amount >= 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  pricing_unit public.pricing_unit not null default 'per_stay',
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, facility_id)
);
create index services_facility_active_idx on public.services(facility_id, active);

-- Opening hours in the airport's local time. A row represents one local weekday window.
-- weekday: 0=Sunday ... 6=Saturday (PostgreSQL EXTRACT(DOW)).
create table public.availability_rules (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  opens_at time not null,
  closes_at time not null,
  valid_from date,
  valid_until date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint availability_rule_window_valid check (opens_at < closes_at),
  constraint availability_rule_date_valid check (valid_from is null or valid_until is null or valid_from <= valid_until)
);
create index availability_rules_lookup_idx on public.availability_rules(facility_id, weekday, active);

-- MVP exceptions are explicit closed/open windows. Interpret these instants in absolute time.
create table public.availability_exceptions (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  is_closed boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  constraint availability_exception_window_valid check (starts_at < ends_at)
);
create index availability_exceptions_window_idx on public.availability_exceptions(facility_id, starts_at, ends_at);

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  registration_number text not null check (length(trim(registration_number)) > 0),
  make text,
  model text,
  color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index vehicles_customer_idx on public.vehicles(customer_id);
create unique index vehicles_customer_registration_uidx on public.vehicles(customer_id, upper(registration_number));

-- A hold reserves one unit of capacity while the customer completes payment.
create table public.booking_holds (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  service_id uuid not null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  entry_at timestamptz not null,
  exit_at timestamptz not null,
  status public.hold_status not null default 'active',
  expires_at timestamptz not null,
  price_amount bigint not null check (price_amount >= 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  price_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_hold_interval_valid check (entry_at < exit_at),
  constraint booking_hold_expiry_valid check (expires_at > created_at),
  constraint booking_holds_service_facility_fk foreign key (service_id, facility_id)
    references public.services(id, facility_id) on delete restrict
);
create index booking_holds_capacity_idx on public.booking_holds(facility_id, entry_at, exit_at)
  where status = 'active';
create index booking_holds_customer_idx on public.booking_holds(customer_id, created_at desc);
create index booking_holds_expiry_idx on public.booking_holds(expires_at) where status = 'active';

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  booking_reference text not null unique,
  hold_id uuid not null unique references public.booking_holds(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  service_id uuid not null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  entry_at timestamptz not null,
  exit_at timestamptz not null,
  status public.booking_status not null default 'confirmed',
  customer_name_snapshot text not null,
  customer_email_snapshot text not null,
  customer_phone_snapshot text,
  price_amount bigint not null check (price_amount >= 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  price_snapshot jsonb not null,
  confirmed_at timestamptz not null default now(),
  cancelled_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_interval_valid check (entry_at < exit_at),
  constraint bookings_service_facility_fk foreign key (service_id, facility_id)
    references public.services(id, facility_id) on delete restrict
);
create index bookings_facility_capacity_idx on public.bookings(facility_id, entry_at, exit_at)
  where status in ('confirmed', 'active');
create index bookings_customer_created_idx on public.bookings(customer_id, created_at desc);
create index bookings_operator_queue_idx on public.bookings(facility_id, status, entry_at);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  hold_id uuid not null references public.booking_holds(id) on delete restrict,
  booking_id uuid references public.bookings(id) on delete restrict,
  status public.payment_status not null default 'pending',
  provider text not null default 'stripe' check (provider = 'stripe'),
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text unique,
  amount bigint not null check (amount >= 0),
  application_fee_amount bigint not null default 0 check (application_fee_amount >= 0),
  refund_amount bigint not null default 0 check (refund_amount >= 0 and refund_amount <= amount),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  failure_code text,
  failure_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payments_hold_created_idx on public.payments(hold_id, created_at desc);
create index payments_booking_idx on public.payments(booking_id);
create index payments_status_idx on public.payments(status, created_at);

-- Store Stripe event IDs to make webhook processing idempotent. Payloads must be scrubbed of unnecessary PII.
create table public.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error text
);

-- Create a temporary hold using one transaction and a facility-level row lock.
-- All future capacity-changing writers must lock this same facilities row.
create or replace function public.create_booking_hold(
  p_facility_id uuid,
  p_service_id uuid,
  p_entry_at timestamptz,
  p_exit_at timestamptz,
  p_vehicle_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_customer_id uuid := auth.uid();
  v_facility public.facilities%rowtype;
  v_service public.services%rowtype;
  v_customer public.customers%rowtype;
  v_units integer;
  v_amount bigint;
  v_occupied integer;
  v_hold_id uuid;
  v_snapshot jsonb;
  v_now timestamptz := clock_timestamp();
  v_duration_seconds numeric;
begin
  if v_customer_id is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '28000';
  end if;
  if p_entry_at is null or p_exit_at is null or p_entry_at >= p_exit_at then
    raise exception 'INVALID_BOOKING_INTERVAL' using errcode = '22007';
  end if;
  if p_entry_at <= v_now then
    raise exception 'ENTRY_MUST_BE_IN_FUTURE' using errcode = '22007';
  end if;

  -- Serialize competing holds for this facility before reading occupancy.
  select f.* into v_facility
  from public.facilities f
  join public.operators o on o.id = f.operator_id
  where f.id = p_facility_id and f.active = true and o.status = 'active'
  for update of f;
  if not found then
    raise exception 'FACILITY_NOT_AVAILABLE' using errcode = 'P0002';
  end if;

  select s.* into v_service
  from public.services s
  where s.id = p_service_id and s.facility_id = p_facility_id and s.active = true;
  if not found then
    raise exception 'SERVICE_NOT_AVAILABLE' using errcode = 'P0002';
  end if;

  select c.* into v_customer
  from public.customers c
  where c.id = v_customer_id;
  if not found then
    raise exception 'CUSTOMER_PROFILE_REQUIRED' using errcode = 'P0002';
  end if;

  if p_vehicle_id is not null and not exists (
    select 1 from public.vehicles v
    where v.id = p_vehicle_id and v.customer_id = v_customer_id
  ) then
    raise exception 'VEHICLE_NOT_OWNED_BY_CUSTOMER' using errcode = '42501';
  end if;

  select count(*)::integer into v_occupied
  from (
    select b.id
    from public.bookings b
    where b.facility_id = p_facility_id
      and b.status in ('confirmed', 'active')
      and b.entry_at < p_exit_at
      and b.exit_at > p_entry_at
    union all
    select h.id
    from public.booking_holds h
    where h.facility_id = p_facility_id
      and h.status = 'active'
      and h.expires_at > v_now
      and h.entry_at < p_exit_at
      and h.exit_at > p_entry_at
  ) occupied;

  if v_occupied >= (v_facility.total_capacity - v_facility.operational_buffer) then
    raise exception 'CAPACITY_EXHAUSTED' using errcode = 'P0001';
  end if;

  v_duration_seconds := extract(epoch from (p_exit_at - p_entry_at));
  v_units := case v_service.pricing_unit
    when 'per_stay' then 1
    when 'per_day' then greatest(1, ceil(v_duration_seconds / 86400.0)::integer)
    when 'per_hour' then greatest(1, ceil(v_duration_seconds / 3600.0)::integer)
  end;
  v_amount := v_service.price_amount * v_units;
  v_snapshot := jsonb_build_object(
    'service_id', v_service.id,
    'service_name', v_service.name,
    'unit_price_amount', v_service.price_amount,
    'pricing_unit', v_service.pricing_unit,
    'units', v_units,
    'total_amount', v_amount,
    'currency', v_service.currency,
    'calculation_version', 1
  );

  insert into public.booking_holds (
    customer_id, facility_id, service_id, vehicle_id,
    entry_at, exit_at, status, expires_at,
    price_amount, currency, price_snapshot
  ) values (
    v_customer_id, p_facility_id, p_service_id, p_vehicle_id,
    p_entry_at, p_exit_at, 'active', v_now + interval '15 minutes',
    v_amount, v_service.currency, v_snapshot
  ) returning id into v_hold_id;

  return v_hold_id;
end;
$$;

revoke all on function public.create_booking_hold(uuid, uuid, timestamptz, timestamptz, uuid) from public;
grant execute on function public.create_booking_hold(uuid, uuid, timestamptz, timestamptz, uuid) to authenticated;

-- Enable RLS for all API-facing tables.
alter table public.customers enable row level security;
alter table public.operators enable row level security;
alter table public.operator_stripe_accounts enable row level security;
alter table public.airports enable row level security;
alter table public.facilities enable row level security;
alter table public.services enable row level security;
alter table public.availability_rules enable row level security;
alter table public.availability_exceptions enable row level security;
alter table public.vehicles enable row level security;
alter table public.booking_holds enable row level security;
alter table public.bookings enable row level security;
alter table public.payments enable row level security;
alter table public.stripe_webhook_events enable row level security;

-- Customer-owned profile and vehicles.
create policy customers_select_self on public.customers
  for select to authenticated using (id = auth.uid());
create policy customers_insert_self on public.customers
  for insert to authenticated with check (id = auth.uid());
create policy customers_update_self on public.customers
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy vehicles_select_self on public.vehicles
  for select to authenticated using (customer_id = auth.uid());
create policy vehicles_insert_self on public.vehicles
  for insert to authenticated with check (customer_id = auth.uid());
create policy vehicles_update_self on public.vehicles
  for update to authenticated using (customer_id = auth.uid()) with check (customer_id = auth.uid());
create policy vehicles_delete_self on public.vehicles
  for delete to authenticated using (customer_id = auth.uid());

-- Public catalog: active records only. Operator owners may also read their own records.
create policy airports_read_active on public.airports
  for select to anon, authenticated using (active = true);

create policy operators_read_active_or_owned on public.operators
  for select to anon, authenticated using (status = 'active' or owner_user_id = auth.uid());
-- Operator records are provisioned by a trusted server-side workflow so clients cannot
-- self-activate an operator or choose their own platform fee.
create policy operators_update_owner on public.operators
  for update to authenticated using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());

create policy facilities_read_active_or_owned on public.facilities
  for select to anon, authenticated using (
    (active = true and exists (select 1 from public.operators o where o.id = operator_id and o.status = 'active'))
    or exists (select 1 from public.operators o where o.id = operator_id and o.owner_user_id = auth.uid())
  );
create policy facilities_insert_owned on public.facilities
  for insert to authenticated with check (
    exists (select 1 from public.operators o where o.id = operator_id and o.owner_user_id = auth.uid())
  );
create policy facilities_update_owned on public.facilities
  for update to authenticated using (
    exists (select 1 from public.operators o where o.id = operator_id and o.owner_user_id = auth.uid())
  ) with check (
    exists (select 1 from public.operators o where o.id = operator_id and o.owner_user_id = auth.uid())
  );

create policy services_read_active_or_owned on public.services
  for select to anon, authenticated using (
    (active = true and exists (
      select 1 from public.facilities f join public.operators o on o.id = f.operator_id
      where f.id = facility_id and f.active = true and o.status = 'active'
    ))
    or exists (
      select 1 from public.facilities f join public.operators o on o.id = f.operator_id
      where f.id = facility_id and o.owner_user_id = auth.uid()
    )
  );
create policy services_insert_owned on public.services
  for insert to authenticated with check (
    exists (select 1 from public.facilities f join public.operators o on o.id = f.operator_id
      where f.id = facility_id and o.owner_user_id = auth.uid())
  );
create policy services_update_owned on public.services
  for update to authenticated using (
    exists (select 1 from public.facilities f join public.operators o on o.id = f.operator_id
      where f.id = facility_id and o.owner_user_id = auth.uid())
  ) with check (
    exists (select 1 from public.facilities f join public.operators o on o.id = f.operator_id
      where f.id = facility_id and o.owner_user_id = auth.uid())
  );

create policy availability_rules_read_active on public.availability_rules
  for select to anon, authenticated using (
    active = true and exists (
      select 1 from public.facilities f join public.operators o on o.id = f.operator_id
      where f.id = facility_id and f.active = true and o.status = 'active'
    )
  );
create policy availability_rules_manage_owned on public.availability_rules
  for all to authenticated using (
    exists (select 1 from public.facilities f join public.operators o on o.id = f.operator_id
      where f.id = facility_id and o.owner_user_id = auth.uid())
  ) with check (
    exists (select 1 from public.facilities f join public.operators o on o.id = f.operator_id
      where f.id = facility_id and o.owner_user_id = auth.uid())
  );

create policy availability_exceptions_read_public on public.availability_exceptions
  for select to anon, authenticated using (
    exists (select 1 from public.facilities f join public.operators o on o.id = f.operator_id
      where f.id = facility_id and f.active = true and o.status = 'active')
  );
create policy availability_exceptions_manage_owned on public.availability_exceptions
  for all to authenticated using (
    exists (select 1 from public.facilities f join public.operators o on o.id = f.operator_id
      where f.id = facility_id and o.owner_user_id = auth.uid())
  ) with check (
    exists (select 1 from public.facilities f join public.operators o on o.id = f.operator_id
      where f.id = facility_id and o.owner_user_id = auth.uid())
  );

-- Holds and bookings can be read by the customer or the owner of the facility's operator.
-- Direct customer writes are intentionally not permitted; create holds through the RPC and
-- create/confirm bookings from server-side webhook processing only.
create policy booking_holds_read_customer_or_operator on public.booking_holds
  for select to authenticated using (
    customer_id = auth.uid() or exists (
      select 1 from public.facilities f join public.operators o on o.id = f.operator_id
      where f.id = facility_id and o.owner_user_id = auth.uid()
    )
  );

create policy bookings_read_customer_or_operator on public.bookings
  for select to authenticated using (
    customer_id = auth.uid() or exists (
      select 1 from public.facilities f join public.operators o on o.id = f.operator_id
      where f.id = facility_id and o.owner_user_id = auth.uid()
    )
  );

create policy payments_read_customer_or_operator on public.payments
  for select to authenticated using (
    exists (select 1 from public.booking_holds h where h.id = hold_id and h.customer_id = auth.uid())
    or exists (
      select 1 from public.booking_holds h
      join public.facilities f on f.id = h.facility_id
      join public.operators o on o.id = f.operator_id
      where h.id = hold_id and o.owner_user_id = auth.uid()
    )
  );

create policy operator_stripe_accounts_read_owner on public.operator_stripe_accounts
  for select to authenticated using (
    exists (select 1 from public.operators o where o.id = operator_id and o.owner_user_id = auth.uid())
  );
-- Writes to Stripe account state and webhook events belong to trusted server-side code only.

-- Do not add policies to stripe_webhook_events: RLS leaves it inaccessible to anon/authenticated.


-- Explicit API privileges. RLS policies above remain the row-level authorization boundary.
-- Keep sensitive state transitions and Stripe writes server-only.
revoke all on table public.customers from anon, authenticated;
revoke all on table public.operators from anon, authenticated;
revoke all on table public.operator_stripe_accounts from anon, authenticated;
revoke all on table public.airports from anon, authenticated;
revoke all on table public.facilities from anon, authenticated;
revoke all on table public.services from anon, authenticated;
revoke all on table public.availability_rules from anon, authenticated;
revoke all on table public.availability_exceptions from anon, authenticated;
revoke all on table public.vehicles from anon, authenticated;
revoke all on table public.booking_holds from anon, authenticated;
revoke all on table public.bookings from anon, authenticated;
revoke all on table public.payments from anon, authenticated;
revoke all on table public.stripe_webhook_events from anon, authenticated;

grant select on table public.airports to anon, authenticated;
grant select on table public.facilities to anon, authenticated;
grant insert, update on table public.facilities to authenticated;
grant select on table public.services to anon, authenticated;
grant insert, update on table public.services to authenticated;
grant select on table public.availability_rules to anon, authenticated;
grant insert, update, delete on table public.availability_rules to authenticated;
grant select on table public.availability_exceptions to anon, authenticated;
grant insert, update, delete on table public.availability_exceptions to authenticated;

grant select, insert, update on table public.customers to authenticated;
grant select, insert, update, delete on table public.vehicles to authenticated;
grant select, update (name, slug, legal_name, country_code, currency) on table public.operators to authenticated;
grant select on table public.operator_stripe_accounts to authenticated;
grant select on table public.booking_holds to authenticated;
grant select on table public.bookings to authenticated;
grant select on table public.payments to authenticated;
-- No direct privileges for anon/authenticated on stripe_webhook_events or for writes to
-- booking_holds, bookings, payments and operator_stripe_accounts.
