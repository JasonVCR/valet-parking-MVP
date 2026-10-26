-- AeroValet & Parking Hub — Increment 3 / Phase 1: Pricing Rules & Extras Engine
-- Incremental migration applied on top of 20261019000100_atomic_booking_holds.sql

-- 1. Create Enums for Pricing Rules and Extras
do $$ begin
  if not exists (select 1 from pg_type where typname = 'price_rule_type') then
    create type public.price_rule_type as enum (
      'season',            -- Calendar season / date range
      'weekday',           -- Specific days of week
      'time_band',         -- Entry time-of-day window
      'duration_band',     -- Stay duration range (hours)
      'vehicle_category'   -- Specific vehicle size/type
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'price_adjustment_type') then
    create type public.price_adjustment_type as enum (
      'override',          -- Replaces the unit price with fixed_amount
      'fixed_addition',    -- Adds fixed_amount to unit price
      'percentage_bps'     -- Multiplies by (10000 + percentage_bps) / 10000
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'extra_pricing_unit') then
    create type public.extra_pricing_unit as enum (
      'per_stay',          -- Fixed charge once per reservation
      'per_day'            -- Charged per billable day
    );
  end if;
end $$;

-- 2. Table: service_price_rules
create table if not exists public.service_price_rules (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  rule_type public.price_rule_type not null,
  priority integer not null default 0,

  -- Criteria filters (all optional; null means applies unconditionally)
  valid_from timestamptz,
  valid_until timestamptz,
  weekdays smallint[] check (weekdays is null or weekdays <@ array[0,1,2,3,4,5,6]::smallint[]),
  entry_time_start time,
  entry_time_end time,
  min_duration_hours integer check (min_duration_hours is null or min_duration_hours >= 0),
  max_duration_hours integer check (max_duration_hours is null or max_duration_hours > min_duration_hours),
  vehicle_category text check (vehicle_category is null or vehicle_category in ('standard', 'suv', 'van', 'motorcycle')),

  -- Rule effects (in integer minor units or basis points)
  adjustment_type public.price_adjustment_type not null,
  fixed_amount bigint check (fixed_amount is null or fixed_amount >= 0),
  percentage_bps integer check (percentage_bps is null or (percentage_bps >= -10000 and percentage_bps <= 50000)),

  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint price_rule_valid_window check (valid_from is null or valid_until is null or valid_from < valid_until),
  constraint price_rule_time_window check (entry_time_start is null or entry_time_end is null or entry_time_start < entry_time_end),
  constraint price_rule_effect_valid check (
    (adjustment_type = 'override' and fixed_amount is not null) or
    (adjustment_type = 'fixed_addition' and fixed_amount is not null) or
    (adjustment_type = 'percentage_bps' and percentage_bps is not null)
  )
);

create index if not exists service_price_rules_service_active_idx
  on public.service_price_rules(service_id, active, priority desc);

-- 3. Table: service_extras
create table if not exists public.service_extras (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities(id) on delete cascade,
  service_id uuid references public.services(id) on delete cascade, -- null = applicable to all services in facility
  name text not null check (length(trim(name)) > 0),
  description text,
  price_amount bigint not null check (price_amount >= 0),
  currency char(3) not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  pricing_unit public.extra_pricing_unit not null default 'per_stay',
  is_mandatory boolean not null default false,
  max_quantity integer not null default 1 check (max_quantity >= 1),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists service_extras_facility_service_idx
  on public.service_extras(facility_id, coalesce(service_id, '00000000-0000-0000-0000-000000000000'::uuid), active);

-- 4. Enable RLS
alter table public.service_price_rules enable row level security;
alter table public.service_extras enable row level security;

-- Read policies: active rules and extras are readable by anyone
create policy "Anyone can read active price rules"
  on public.service_price_rules for select
  using (active = true);

create policy "Anyone can read active service extras"
  on public.service_extras for select
  using (active = true);

-- Operators can manage rules and extras for their own facilities/services
create policy "Operators can manage price rules for their services"
  on public.service_price_rules for all
  using (
    exists (
      select 1 from public.services s
      join public.facilities f on f.id = s.facility_id
      join public.operators o on o.id = f.operator_id
      where s.id = service_price_rules.service_id
        and o.owner_user_id = auth.uid()
    )
  );

create policy "Operators can manage extras for their facilities"
  on public.service_extras for all
  using (
    exists (
      select 1 from public.facilities f
      join public.operators o on o.id = f.operator_id
      where f.id = service_extras.facility_id
        and o.owner_user_id = auth.uid()
    )
  );

-- 5. Enhanced RPC: calculate_service_quote
-- Server authoritative calculation for quote & search breakdown
create or replace function public.calculate_service_quote(
  p_service_id uuid,
  p_entry_at timestamptz,
  p_exit_at timestamptz,
  p_vehicle_category text default null,
  p_selected_extras jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_service public.services%rowtype;
  v_facility public.facilities%rowtype;
  v_airport public.airports%rowtype;
  v_duration_seconds numeric;
  v_units integer;
  v_base_unit_price bigint;
  v_base_amount bigint;
  v_rules_adjustments_amount bigint := 0;
  v_extras_amount bigint := 0;
  v_total_amount bigint;
  v_rule record;
  v_applied_rules jsonb := '[]'::jsonb;
  v_selected_extras_result jsonb := '[]'::jsonb;
  v_breakdown jsonb := '[]'::jsonb;
  v_extra_item jsonb;
  v_extra_record public.service_extras%rowtype;
  v_extra_qty integer;
  v_extra_cost bigint;
  v_entry_local_time time;
  v_entry_weekday smallint;
  v_duration_hours integer;
  v_best_rule_matched boolean := false;
  v_adjusted_unit_price bigint;
begin
  -- 1. Validation
  if p_entry_at is null or p_exit_at is null or p_entry_at >= p_exit_at then
    raise exception 'INVALID_BOOKING_INTERVAL' using errcode = '22007';
  end if;

  v_duration_seconds := extract(epoch from (p_exit_at - p_entry_at));
  if v_duration_seconds < 1800 then
    raise exception 'DURATION_TOO_SHORT' using errcode = '22023';
  end if;

  -- 2. Fetch service & facility & airport
  select s.* into v_service
  from public.services s
  where s.id = p_service_id and s.active = true;

  if not found then
    raise exception 'SERVICE_NOT_AVAILABLE' using errcode = 'P0002';
  end if;

  select f.* into v_facility
  from public.facilities f
  where f.id = v_service.facility_id and f.active = true;

  if not found then
    raise exception 'FACILITY_NOT_AVAILABLE' using errcode = 'P0002';
  end if;

  select a.* into v_airport
  from public.airports a
  where a.id = v_facility.airport_id;

  -- 3. Calculate Billable Units
  v_units := case v_service.pricing_unit
    when 'per_stay' then 1
    when 'per_day' then greatest(1, ceil(v_duration_seconds / 86400.0)::integer)
    when 'per_hour' then greatest(1, ceil(v_duration_seconds / 3600.0)::integer)
  end;

  v_base_unit_price := v_service.price_amount;
  v_adjusted_unit_price := v_base_unit_price;
  v_duration_hours := ceil(v_duration_seconds / 3600.0)::integer;

  -- Local time & weekday at airport
  v_entry_local_time := (p_entry_at at time zone coalesce(v_airport.timezone, 'UTC'))::time;
  v_entry_weekday := extract(dow from (p_entry_at at time zone coalesce(v_airport.timezone, 'UTC')))::smallint;

  -- 4. Evaluate Price Rules (sorted by priority DESC, created_at ASC)
  for v_rule in
    select * from public.service_price_rules
    where service_id = p_service_id
      and active = true
      and (valid_from is null or valid_from <= p_entry_at)
      and (valid_until is null or valid_until >= p_exit_at)
      and (weekdays is null or v_entry_weekday = any(weekdays))
      and (entry_time_start is null or v_entry_local_time >= entry_time_start)
      and (entry_time_end is null or v_entry_local_time <= entry_time_end)
      and (min_duration_hours is null or v_duration_hours >= min_duration_hours)
      and (max_duration_hours is null or v_duration_hours <= max_duration_hours)
      and (vehicle_category is null or vehicle_category = coalesce(p_vehicle_category, 'standard'))
    order by priority desc, created_at asc
  loop
    -- Highest priority rule match applies
    if not v_best_rule_matched then
      v_best_rule_matched := true;
      if v_rule.adjustment_type = 'override' then
        v_adjusted_unit_price := v_rule.fixed_amount;
      elsif v_rule.adjustment_type = 'fixed_addition' then
        v_adjusted_unit_price := v_base_unit_price + v_rule.fixed_amount;
      elsif v_rule.adjustment_type = 'percentage_bps' then
        v_adjusted_unit_price := (v_base_unit_price * (10000 + v_rule.percentage_bps)) / 10000;
      end if;

      v_applied_rules := v_applied_rules || jsonb_build_object(
        'rule_id', v_rule.id,
        'rule_name', v_rule.name,
        'rule_type', v_rule.rule_type,
        'adjustment_type', v_rule.adjustment_type,
        'original_unit_price', v_base_unit_price,
        'adjusted_unit_price', v_adjusted_unit_price
      );
    end if;
  end loop;

  v_base_amount := v_base_unit_price * v_units;
  v_rules_adjustments_amount := (v_adjusted_unit_price - v_base_unit_price) * v_units;

  -- Add base line to breakdown
  v_breakdown := v_breakdown || jsonb_build_object(
    'label', v_service.name || ' (' || v_units || ' ' || (case when v_units = 1 then 'unidad' else 'unidades' end) || ')',
    'quantity', v_units,
    'unit_price', v_adjusted_unit_price,
    'total_price', v_adjusted_unit_price * v_units,
    'type', 'base_stay'
  );

  -- 5. Process Extras (Mandatory + Selected)
  -- Add any mandatory extras first
  for v_extra_record in
    select * from public.service_extras
    where facility_id = v_facility.id
      and (service_id is null or service_id = p_service_id)
      and active = true
      and is_mandatory = true
  loop
    v_extra_qty := 1;
    v_extra_cost := case v_extra_record.pricing_unit
      when 'per_stay' then v_extra_record.price_amount * v_extra_qty
      when 'per_day' then v_extra_record.price_amount * v_units * v_extra_qty
    end;
    v_extras_amount := v_extras_amount + v_extra_cost;

    v_selected_extras_result := v_selected_extras_result || jsonb_build_object(
      'extra_id', v_extra_record.id,
      'name', v_extra_record.name,
      'unit_price_amount', v_extra_record.price_amount,
      'pricing_unit', v_extra_record.pricing_unit,
      'quantity', v_extra_qty,
      'total_amount', v_extra_cost,
      'is_mandatory', true
    );

    v_breakdown := v_breakdown || jsonb_build_object(
      'label', v_extra_record.name || ' [Obligatorio]',
      'quantity', v_extra_qty,
      'unit_price', v_extra_record.price_amount,
      'total_price', v_extra_cost,
      'type', 'extra'
    );
  end loop;

  -- Process optional requested extras from JSON array: [{ extra_id: string, quantity: number }]
  if p_selected_extras is not null and jsonb_typeof(p_selected_extras) = 'array' then
    for v_extra_item in select * from jsonb_array_elements(p_selected_extras)
    loop
      select * into v_extra_record
      from public.service_extras
      where id = (v_extra_item->>'extra_id')::uuid
        and facility_id = v_facility.id
        and (service_id is null or service_id = p_service_id)
        and active = true
        and is_mandatory = false;

      if found then
        v_extra_qty := greatest(1, least(coalesce((v_extra_item->>'quantity')::integer, 1), v_extra_record.max_quantity));
        v_extra_cost := case v_extra_record.pricing_unit
          when 'per_stay' then v_extra_record.price_amount * v_extra_qty
          when 'per_day' then v_extra_record.price_amount * v_units * v_extra_qty
        end;
        v_extras_amount := v_extras_amount + v_extra_cost;

        v_selected_extras_result := v_selected_extras_result || jsonb_build_object(
          'extra_id', v_extra_record.id,
          'name', v_extra_record.name,
          'unit_price_amount', v_extra_record.price_amount,
          'pricing_unit', v_extra_record.pricing_unit,
          'quantity', v_extra_qty,
          'total_amount', v_extra_cost,
          'is_mandatory', false
        );

        v_breakdown := v_breakdown || jsonb_build_object(
          'label', v_extra_record.name,
          'quantity', v_extra_qty,
          'unit_price', v_extra_record.price_amount,
          'total_price', v_extra_cost,
          'type', 'extra'
        );
      end if;
    end loop;
  end if;

  v_total_amount := (v_adjusted_unit_price * v_units) + v_extras_amount;

  return jsonb_build_object(
    'service_id', v_service.id,
    'service_name', v_service.name,
    'currency', v_service.currency,
    'pricing_unit', v_service.pricing_unit,
    'units', v_units,
    'base_unit_price_amount', v_base_unit_price,
    'base_total_amount', v_base_amount,
    'rules_adjustments_amount', v_rules_adjustments_amount,
    'extras_amount', v_extras_amount,
    'discount_amount', 0,
    'tax_amount', 0,
    'total_amount', v_total_amount,
    'calculation_version', 2,
    'applied_rules', v_applied_rules,
    'selected_extras', v_selected_extras_result,
    'breakdown', v_breakdown
  );
end;
$$;

grant execute on function public.calculate_service_quote(uuid, timestamptz, timestamptz, text, jsonb) to anon, authenticated, service_role;

-- 6. Updated create_booking_hold integrating quote engine
create or replace function public.create_booking_hold(
  p_facility_id uuid,
  p_service_id uuid,
  p_entry_at timestamptz,
  p_exit_at timestamptz,
  p_vehicle_id uuid default null,
  p_customer_id uuid default null,
  p_guest_email text default null,
  p_guest_name text default null,
  p_guest_phone text default null,
  p_vehicle_category text default null,
  p_selected_extras jsonb default '[]'::jsonb
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
  v_quote jsonb;
  v_peak_occupied integer;
  v_sellable_capacity integer;
  v_hold_id uuid;
  v_now timestamptz := clock_timestamp();
  v_expires_at timestamptz;
  v_duration_seconds numeric;
  v_total_amount bigint;
begin
  -- 1. Interval & Future Entry Validation
  if p_entry_at is null or p_exit_at is null or p_entry_at >= p_exit_at then
    raise exception 'INVALID_BOOKING_INTERVAL' using errcode = '22007';
  end if;

  if p_entry_at <= v_now then
    raise exception 'ENTRY_MUST_BE_IN_FUTURE' using errcode = '22007';
  end if;

  v_duration_seconds := extract(epoch from (p_exit_at - p_entry_at));
  if v_duration_seconds < 1800 then
    raise exception 'DURATION_TOO_SHORT' using errcode = '22023';
  end if;

  if v_duration_seconds > (90 * 86400) then
    raise exception 'DURATION_EXCEEDS_LIMIT' using errcode = '22023';
  end if;

  -- 2. Identity Resolution
  if v_auth_uid is not null then
    v_customer_id := v_auth_uid;
  elsif p_customer_id is not null then
    if current_user in ('postgres', 'service_role') or coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' then
      v_customer_id := p_customer_id;
    else
      raise exception 'UNAUTHORIZED_CUSTOMER_IMPERSONATION' using errcode = '42501';
    end if;
  else
    if p_guest_email is null or position('@' in p_guest_email) <= 1 or p_guest_name is null or length(trim(p_guest_name)) = 0 then
      raise exception 'GUEST_CONTACT_REQUIRED' using errcode = '22023';
    end if;
    v_customer_id := null;
  end if;

  -- 3. Vehicle Ownership Validation
  if v_customer_id is not null and p_vehicle_id is not null then
    if not exists (
      select 1 from public.vehicles v
      where v.id = p_vehicle_id and v.customer_id = v_customer_id
    ) then
      raise exception 'VEHICLE_NOT_OWNED_BY_CUSTOMER' using errcode = '42501';
    end if;
  end if;

  -- 4. Facility Row-Level Locking (Serialize all competing capacity requests)
  select f.* into v_facility
  from public.facilities f
  join public.operators o on o.id = f.operator_id
  where f.id = p_facility_id and f.active = true and o.status = 'active'
  for update of f;

  if not found then
    raise exception 'FACILITY_NOT_AVAILABLE' using errcode = 'P0002';
  end if;

  -- 5. Service Resolution
  select s.* into v_service
  from public.services s
  where s.id = p_service_id and s.facility_id = p_facility_id and s.active = true;

  if not found then
    raise exception 'SERVICE_NOT_AVAILABLE' using errcode = 'P0002';
  end if;

  -- 6. Timeline-based Peak Concurrent Occupancy Calculation
  v_sellable_capacity := v_facility.total_capacity - v_facility.operational_buffer;
  if v_sellable_capacity <= 0 then
    raise exception 'CAPACITY_EXHAUSTED' using errcode = 'P0001';
  end if;

  with overlapping_stays as (
    select b.entry_at, b.exit_at
    from public.bookings b
    where b.facility_id = p_facility_id
      and b.status in ('confirmed', 'active')
      and b.entry_at < p_exit_at
      and b.exit_at > p_entry_at
    union all
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

  if (v_peak_occupied + 1) > v_sellable_capacity then
    raise exception 'CAPACITY_EXHAUSTED' using errcode = 'P0001';
  end if;

  -- 7. Calculate authoritative quote
  v_quote := public.calculate_service_quote(
    p_service_id,
    p_entry_at,
    p_exit_at,
    p_vehicle_category,
    p_selected_extras
  );

  v_total_amount := (v_quote->>'total_amount')::bigint;
  v_expires_at := v_now + interval '15 minutes';

  -- 8. Persist Hold with detailed PriceSnapshot V2
  insert into public.booking_holds (
    customer_id, facility_id, service_id, vehicle_id,
    entry_at, exit_at, status, expires_at,
    price_amount, currency, price_snapshot,
    guest_email, guest_name, guest_phone
  ) values (
    v_customer_id, p_facility_id, p_service_id, p_vehicle_id,
    p_entry_at, p_exit_at, 'active', v_expires_at,
    v_total_amount, v_service.currency, v_quote,
    lower(trim(p_guest_email)), trim(p_guest_name), trim(p_guest_phone)
  ) returning id into v_hold_id;

  -- 9. Return structured confirmation
  return jsonb_build_object(
    'hold_id', v_hold_id,
    'facility_id', p_facility_id,
    'service_id', p_service_id,
    'entry_at', p_entry_at,
    'exit_at', p_exit_at,
    'status', 'active',
    'expires_at', v_expires_at,
    'price_amount', v_total_amount,
    'currency', v_service.currency,
    'pricing_unit', v_service.pricing_unit,
    'units', (v_quote->>'units')::integer,
    'price_snapshot', v_quote
  );
end;
$$;

revoke all on function public.create_booking_hold(uuid, uuid, timestamptz, timestamptz, uuid, uuid, text, text, text, text, jsonb) from public;
grant execute on function public.create_booking_hold(uuid, uuid, timestamptz, timestamptz, uuid, uuid, text, text, text, text, jsonb) to anon, authenticated, service_role;
