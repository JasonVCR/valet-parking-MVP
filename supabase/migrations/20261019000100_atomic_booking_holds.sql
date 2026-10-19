-- AeroValet & Parking Hub — Increment 2: Atomic Booking Holds & Timeline Capacity
-- Incremental migration applied on top of 20261017000100_initial_schema.sql

-- 1. Allow booking_holds to support guest checkouts (nullable customer_id with verified guest contact info)
alter table public.booking_holds
  alter column customer_id drop not null;

alter table public.booking_holds
  add column if not exists guest_email text,
  add column if not exists guest_name text,
  add column if not exists guest_phone text;

-- Ensure every hold has either an authenticated customer_id or a valid guest_email
alter table public.booking_holds
  drop constraint if exists booking_hold_customer_or_guest_chk;

alter table public.booking_holds
  add constraint booking_hold_customer_or_guest_chk
  check (
    (customer_id is not null) or
    (guest_email is not null and position('@' in guest_email) > 1 and guest_name is not null and length(trim(guest_name)) > 0)
  );

-- Index for guest email lookups
create index if not exists booking_holds_guest_email_idx
  on public.booking_holds(lower(guest_email), created_at desc)
  where customer_id is null;

-- 2. Enhanced RPC create_booking_hold with timeline-based peak concurrent capacity calculation
create or replace function public.create_booking_hold(
  p_facility_id uuid,
  p_service_id uuid,
  p_entry_at timestamptz,
  p_exit_at timestamptz,
  p_vehicle_id uuid default null,
  p_customer_id uuid default null,
  p_guest_email text default null,
  p_guest_name text default null,
  p_guest_phone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_auth_uid uuid := auth.uid();
  v_customer_id uuid;
  v_facility public.facilities%rowtype;
  v_service public.services%rowtype;
  v_units integer;
  v_amount bigint;
  v_peak_occupied integer;
  v_sellable_capacity integer;
  v_hold_id uuid;
  v_snapshot jsonb;
  v_now timestamptz := clock_timestamp();
  v_expires_at timestamptz;
  v_duration_seconds numeric;
begin
  -- 1. Parameter & Duration Validation
  if p_entry_at is null or p_exit_at is null or p_entry_at >= p_exit_at then
    raise exception 'INVALID_BOOKING_INTERVAL' using errcode = '22007';
  end if;

  if p_entry_at <= v_now then
    raise exception 'ENTRY_MUST_BE_IN_FUTURE' using errcode = '22007';
  end if;

  v_duration_seconds := extract(epoch from (p_exit_at - p_entry_at));
  if v_duration_seconds < 1800 then -- minimum 30 minutes
    raise exception 'DURATION_TOO_SHORT' using errcode = '22023';
  end if;

  if v_duration_seconds > (90 * 86400) then -- maximum 90 days
    raise exception 'DURATION_EXCEEDS_LIMIT' using errcode = '22023';
  end if;

  -- 2. Authorization & Customer Resolution
  if v_auth_uid is not null then
    -- Authenticated user: always bind to authenticated identity
    v_customer_id := v_auth_uid;
  elsif p_customer_id is not null then
    -- Explicit customer_id: only trusted server roles (service_role, postgres) may pass this
    if current_user in ('postgres', 'service_role') or coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' then
      v_customer_id := p_customer_id;
    else
      raise exception 'UNAUTHORIZED_CUSTOMER_IMPERSONATION' using errcode = '42501';
    end if;
  else
    -- Guest booking: must provide valid guest contact details
    if p_guest_email is null or position('@' in p_guest_email) <= 1 or p_guest_name is null or length(trim(p_guest_name)) = 0 then
      raise exception 'GUEST_CONTACT_REQUIRED' using errcode = '22023';
    end if;
    v_customer_id := null;
  end if;

  -- 3. Vehicle Ownership Validation (if vehicle provided for authenticated user)
  if v_customer_id is not null and p_vehicle_id is not null then
    if not exists (
      select 1 from public.vehicles v
      where v.id = p_vehicle_id and v.customer_id = v_customer_id
    ) then
      raise exception 'VEHICLE_NOT_OWNED_BY_CUSTOMER' using errcode = '42501';
    end if;
  end if;

  -- 4. Facility Row-Level Locking (Serialize all competing capacity requests for this facility)
  select f.* into v_facility
  from public.facilities f
  join public.operators o on o.id = f.operator_id
  where f.id = p_facility_id and f.active = true and o.status = 'active'
  for update of f;

  if not found then
    raise exception 'FACILITY_NOT_AVAILABLE' using errcode = 'P0002';
  end if;

  -- 5. Service Resolution and Validation
  select s.* into v_service
  from public.services s
  where s.id = p_service_id and s.facility_id = p_facility_id and s.active = true;

  if not found then
    raise exception 'SERVICE_NOT_AVAILABLE' using errcode = 'P0002';
  end if;

  -- 6. Timeline-based Peak Concurrent Occupancy Calculation
  -- Accurately checks max simultaneous vehicles across the entire requested stay [p_entry_at, p_exit_at)
  -- Does NOT falsely reject consecutive non-overlapping bookings.
  v_sellable_capacity := v_facility.total_capacity - v_facility.operational_buffer;
  if v_sellable_capacity <= 0 then
    raise exception 'CAPACITY_EXHAUSTED' using errcode = 'P0001';
  end if;

  with overlapping_stays as (
    -- Confirmed or active bookings
    select b.entry_at, b.exit_at
    from public.bookings b
    where b.facility_id = p_facility_id
      and b.status in ('confirmed', 'active')
      and b.entry_at < p_exit_at
      and b.exit_at > p_entry_at
    union all
    -- Active unexpired holds
    select h.entry_at, h.exit_at
    from public.booking_holds h
    where h.facility_id = p_facility_id
      and h.status = 'active'
      and h.expires_at > v_now
      and h.entry_at < p_exit_at
      and h.exit_at > p_entry_at
  ),
  critical_instants as (
    select p_entry_at as instant
    union
    select entry_at as instant
    from overlapping_stays
    where entry_at > p_entry_at and entry_at < p_exit_at
  ),
  occupancy_per_instant as (
    select
      ci.instant,
      count(*)::integer as occupied_count
    from critical_instants ci
    join overlapping_stays s
      on s.entry_at <= ci.instant
     and s.exit_at > ci.instant
    group by ci.instant
  )
  select coalesce(max(occupied_count), 0) into v_peak_occupied
  from occupancy_per_instant;

  -- Check if adding 1 vehicle exceeds sellable capacity at any point in time
  if (v_peak_occupied + 1) > v_sellable_capacity then
    raise exception 'CAPACITY_EXHAUSTED' using errcode = 'P0001';
  end if;

  -- 7. Deterministic Pricing Calculation (server authoritative, integer minor units)
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

  -- 8. Persist Hold with 15-minute expiration
  v_expires_at := v_now + interval '15 minutes';

  insert into public.booking_holds (
    customer_id, facility_id, service_id, vehicle_id,
    entry_at, exit_at, status, expires_at,
    price_amount, currency, price_snapshot,
    guest_email, guest_name, guest_phone
  ) values (
    v_customer_id, p_facility_id, p_service_id, p_vehicle_id,
    p_entry_at, p_exit_at, 'active', v_expires_at,
    v_amount, v_service.currency, v_snapshot,
    lower(trim(p_guest_email)), trim(p_guest_name), trim(p_guest_phone)
  ) returning id into v_hold_id;

  -- 9. Return structured hold confirmation (authoritative server state)
  return jsonb_build_object(
    'hold_id', v_hold_id,
    'facility_id', p_facility_id,
    'service_id', p_service_id,
    'entry_at', p_entry_at,
    'exit_at', p_exit_at,
    'status', 'active',
    'expires_at', v_expires_at,
    'price_amount', v_amount,
    'currency', v_service.currency,
    'pricing_unit', v_service.pricing_unit,
    'units', v_units
  );
end;
$$;

-- Grant execution privileges
revoke all on function public.create_booking_hold(uuid, uuid, timestamptz, timestamptz, uuid, uuid, text, text, text) from public;
grant execute on function public.create_booking_hold(uuid, uuid, timestamptz, timestamptz, uuid, uuid, text, text, text) to anon, authenticated, service_role;

-- 3. Secure read RPC for checking hold status during checkout without exposing private tables
create or replace function public.get_booking_hold_status(
  p_hold_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hold public.booking_holds%rowtype;
  v_now timestamptz := clock_timestamp();
  v_effective_status text;
begin
  select * into v_hold
  from public.booking_holds
  where id = p_hold_id;

  if not found then
    return null;
  end if;

  if v_hold.status = 'active' and v_hold.expires_at <= v_now then
    v_effective_status := 'expired';
  else
    v_effective_status := v_hold.status;
  end if;

  return jsonb_build_object(
    'hold_id', v_hold.id,
    'facility_id', v_hold.facility_id,
    'service_id', v_hold.service_id,
    'status', v_effective_status,
    'entry_at', v_hold.entry_at,
    'exit_at', v_hold.exit_at,
    'expires_at', v_hold.expires_at,
    'price_amount', v_hold.price_amount,
    'currency', v_hold.currency,
    'price_snapshot', v_hold.price_snapshot
  );
end;
$$;

revoke all on function public.get_booking_hold_status(uuid) from public;
grant execute on function public.get_booking_hold_status(uuid) to anon, authenticated, service_role;
