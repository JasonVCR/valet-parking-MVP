-- AeroValet & Parking Hub — Increment 4 / Phase 1: Market Coverage, Tariff Sources & Fixed Bands
-- Incremental migration applied on top of 20261026000200_terms_and_legal_policies.sql

-- 1. Create Enums for Tariff Sources and Bands
do $$ begin
  if not exists (select 1 from pg_type where typname = 'tariff_source_type') then
    create type public.tariff_source_type as enum (
      'official_website',
      'operator_tariff_pdf',
      'csv_import',
      'manual_verified',
      'api_feed'
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'tariff_acquisition_mode') then
    create type public.tariff_acquisition_mode as enum (
      'manual',
      'csv',
      'api',
      'web_extraction'
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'tariff_verification_status') then
    create type public.tariff_verification_status as enum (
      'verified',
      'pending_review',
      'flagged_ambiguous',
      'stale'
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'tariff_band_pricing_unit') then
    create type public.tariff_band_pricing_unit as enum (
      'flat_stay',   -- Fixed closed stay price for the duration interval
      'per_day'      -- Rate per day applied when stay duration falls in this band
    );
  end if;
end $$;

-- 2. Table: operator_tariff_sources
-- Stores verifiable provenance for all operator rates with content hashing & audit timestamps
create table if not exists public.operator_tariff_sources (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  source_name text not null check (length(trim(source_name)) > 0),
  source_url text,
  source_type public.tariff_source_type not null default 'official_website',
  acquisition_mode public.tariff_acquisition_mode not null default 'manual',
  content_hash char(64) check (content_hash is null or content_hash ~ '^[a-f0-9]{64}$'),
  retrieved_at timestamptz not null default now(),
  valid_from timestamptz,
  valid_until timestamptz,
  next_review_at timestamptz,
  verification_status public.tariff_verification_status not null default 'verified',
  provenance_notes text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists operator_tariff_sources_operator_idx
  on public.operator_tariff_sources(operator_id, verification_status);

-- 3. Table: service_tariff_bands
-- Represents closed duration intervals (e.g. 1d, 2d, 3d, 7d, 14d) as published by operators
create table if not exists public.service_tariff_bands (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  source_id uuid references public.operator_tariff_sources(id) on delete set null,
  name text not null check (length(trim(name)) > 0),
  min_duration_hours integer not null check (min_duration_hours >= 0),
  max_duration_hours integer not null check (max_duration_hours >= min_duration_hours),
  price_amount bigint not null check (price_amount >= 0),
  currency char(3) not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  pricing_unit public.tariff_band_pricing_unit not null default 'flat_stay',
  vehicle_category text check (vehicle_category is null or vehicle_category in ('standard', 'suv', 'van', 'motorcycle')),
  valid_from timestamptz,
  valid_until timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint tariff_bands_window_valid check (valid_from is null or valid_until is null or valid_from < valid_until)
);

create index if not exists service_tariff_bands_lookup_idx
  on public.service_tariff_bands(service_id, active, min_duration_hours, max_duration_hours);

-- 4. Enable RLS
alter table public.operator_tariff_sources enable row level security;
alter table public.service_tariff_bands enable row level security;

create policy "Anyone can read verified tariff sources"
  on public.operator_tariff_sources for select
  using (verification_status = 'verified');

create policy "Anyone can read active tariff bands"
  on public.service_tariff_bands for select
  using (active = true);

create policy "Operators can manage tariff sources for their operations"
  on public.operator_tariff_sources for all
  using (
    exists (
      select 1 from public.operators o
      where o.id = operator_tariff_sources.operator_id
        and o.owner_user_id = auth.uid()
    )
  );

create policy "Operators can manage tariff bands for their services"
  on public.service_tariff_bands for all
  using (
    exists (
      select 1 from public.services s
      join public.facilities f on f.id = s.facility_id
      join public.operators o on o.id = f.operator_id
      where s.id = service_tariff_bands.service_id
        and o.owner_user_id = auth.uid()
    )
  );

-- 5. Enhanced Authoritative RPC: calculate_service_quote (Version 3)
-- Incorporates fixed duration bands, explicit 800c platform markup, 199c management fee, and B2B settlement memo
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
  v_duration_hours integer;
  v_units integer;
  
  -- Price components
  v_supplier_base_amount bigint := 0;
  v_platform_markup_amount bigint := 800;          -- 8.00 EUR AeroValet commercial markup
  v_booking_management_fee_amount bigint := 199;   -- 1.99 EUR Booking management & support fee
  v_extras_amount bigint := 0;
  v_discount_amount bigint := 0;
  v_tax_amount bigint := 0;                       -- Zero unless explicit validated tax config exists
  v_customer_total_amount bigint := 0;

  -- B2B Settlement Memo (10% B2B commission strictly on supplier base)
  v_b2b_commission_rate_bps integer := 1000;      -- 10%
  v_b2b_commission_amount bigint := 0;
  v_operator_payout_amount bigint := 0;

  -- Tariff band matching
  v_band record;
  v_max_band record;
  v_band_matched boolean := false;
  v_band_source_id uuid;

  -- Dynamic rules matching (fallback if no tariff band matches)
  v_rule record;
  v_rule_matched boolean := false;
  v_adjusted_unit_price bigint;
  v_applied_rules jsonb := '[]'::jsonb;

  -- Extras and breakdown
  v_selected_extras_result jsonb := '[]'::jsonb;
  v_breakdown jsonb := '[]'::jsonb;
  v_extra_item jsonb;
  v_extra_record public.service_extras%rowtype;
  v_extra_qty integer;
  v_extra_cost bigint;
  v_entry_local_time time;
  v_entry_weekday smallint;
  v_source_record record;
  v_tariff_source_meta jsonb := null;
begin
  -- 1. Validation
  if p_entry_at is null or p_exit_at is null or p_entry_at >= p_exit_at then
    raise exception 'INVALID_BOOKING_INTERVAL' using errcode = '22007';
  end if;

  v_duration_seconds := extract(epoch from (p_exit_at - p_entry_at));
  if v_duration_seconds < 1800 then
    raise exception 'DURATION_TOO_SHORT' using errcode = '22023';
  end if;

  v_duration_hours := ceil(v_duration_seconds / 3600.0)::integer;

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

  v_units := case v_service.pricing_unit
    when 'per_stay' then 1
    when 'per_day' then greatest(1, ceil(v_duration_seconds / 86400.0)::integer)
    when 'per_hour' then greatest(1, ceil(v_duration_seconds / 3600.0)::integer)
  end;

  -- Local time & weekday at airport
  v_entry_local_time := (p_entry_at at time zone coalesce(v_airport.timezone, 'UTC'))::time;
  v_entry_weekday := extract(dow from (p_entry_at at time zone coalesce(v_airport.timezone, 'UTC')))::smallint;

  -- 3. Check for matching Service Tariff Band (Fixed price for interval)
  select b.* into v_band
  from public.service_tariff_bands b
  where b.service_id = p_service_id
    and b.active = true
    and v_duration_hours >= b.min_duration_hours
    and v_duration_hours <= b.max_duration_hours
    and (b.valid_from is null or b.valid_from <= p_entry_at)
    and (b.valid_until is null or b.valid_until >= p_exit_at)
    and (b.vehicle_category is null or b.vehicle_category = coalesce(p_vehicle_category, 'standard'))
  order by (b.max_duration_hours - b.min_duration_hours) asc, b.created_at desc
  limit 1;

  if found then
    v_band_matched := true;
    v_band_source_id := v_band.source_id;

    if v_band.pricing_unit = 'flat_stay' then
      v_supplier_base_amount := v_band.price_amount;
    else
      v_supplier_base_amount := v_band.price_amount * v_units;
    end if;

    v_breakdown := v_breakdown || jsonb_build_object(
      'label', 'Tarifa del operador: ' || v_band.name || ' (' || v_duration_hours || 'h)',
      'quantity', 1,
      'unit_price', v_supplier_base_amount,
      'total_price', v_supplier_base_amount,
      'type', 'supplier_tariff_band'
    );
  else
    -- Check if duration exceeds maximum defined band (e.g. 18 days when bands end at 14 days)
    select b.* into v_max_band
    from public.service_tariff_bands b
    where b.service_id = p_service_id
      and b.active = true
      and (b.valid_from is null or b.valid_from <= p_entry_at)
      and (b.valid_until is null or b.valid_until >= p_exit_at)
      and (b.vehicle_category is null or b.vehicle_category = coalesce(p_vehicle_category, 'standard'))
    order by b.max_duration_hours desc
    limit 1;

    if found and v_duration_hours > v_max_band.max_duration_hours then
      declare
        v_extra_hours integer := v_duration_hours - v_max_band.max_duration_hours;
        v_extra_days integer := ceil(v_extra_hours / 24.0)::integer;
        v_daily_rate bigint := v_service.price_amount;
        v_extra_amount bigint := v_daily_rate * v_extra_days;
      begin
        v_band_matched := true;
        v_band_source_id := v_max_band.source_id;
        v_supplier_base_amount := v_max_band.price_amount + v_extra_amount;

        v_breakdown := v_breakdown || jsonb_build_object(
          'label', 'Tarifa base: ' || v_max_band.name || ' + ' || v_extra_days || ' d adicionales',
          'quantity', 1,
          'unit_price', v_supplier_base_amount,
          'total_price', v_supplier_base_amount,
          'type', 'supplier_tariff_band'
        );
      end;
    end if;
  end if;

  -- 4. Fallback to Dynamic Price Rules if no tariff band matched
  if not v_band_matched then
    v_adjusted_unit_price := v_service.price_amount;

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
      if not v_rule_matched then
        v_rule_matched := true;
        if v_rule.adjustment_type = 'override' then
          v_adjusted_unit_price := v_rule.fixed_amount;
        elsif v_rule.adjustment_type = 'fixed_addition' then
          v_adjusted_unit_price := v_service.price_amount + v_rule.fixed_amount;
        elsif v_rule.adjustment_type = 'percentage_bps' then
          v_adjusted_unit_price := (v_service.price_amount * (10000 + v_rule.percentage_bps)) / 10000;
        end if;

        v_applied_rules := v_applied_rules || jsonb_build_object(
          'rule_id', v_rule.id,
          'rule_name', v_rule.name,
          'rule_type', v_rule.rule_type,
          'adjustment_type', v_rule.adjustment_type,
          'original_unit_price', v_service.price_amount,
          'adjusted_unit_price', v_adjusted_unit_price
        );
      end if;
    end loop;

    v_supplier_base_amount := v_adjusted_unit_price * v_units;

    v_breakdown := v_breakdown || jsonb_build_object(
      'label', v_service.name || ' (' || v_units || ' ' || (case when v_units = 1 then 'unidad' else 'unidades' end) || ')',
      'quantity', v_units,
      'unit_price', v_adjusted_unit_price,
      'total_price', v_supplier_base_amount,
      'type', 'base_stay'
    );
  end if;

  -- 5. Add Explicit AeroValet Platform Charges to Breakdown
  v_breakdown := v_breakdown || jsonb_build_object(
    'label', 'Margen comercial de intermediación AeroValet',
    'quantity', 1,
    'unit_price', v_platform_markup_amount,
    'total_price', v_platform_markup_amount,
    'type', 'platform_markup'
  );

  v_breakdown := v_breakdown || jsonb_build_object(
    'label', 'Cargo por gestión y garantía de reserva',
    'quantity', 1,
    'unit_price', v_booking_management_fee_amount,
    'total_price', v_booking_management_fee_amount,
    'type', 'booking_fee'
  );

  -- 6. Process Extras (Mandatory + Selected)
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

  -- 7. Compute Customer Total Amount
  v_customer_total_amount := v_supplier_base_amount + v_platform_markup_amount + v_booking_management_fee_amount + v_extras_amount - v_discount_amount + v_tax_amount;

  -- 8. Compute B2B Settlement Memo (10% commission on operator base only, never on platform charges)
  v_b2b_commission_amount := (v_supplier_base_amount * v_b2b_commission_rate_bps) / 10000;
  v_operator_payout_amount := v_supplier_base_amount - v_b2b_commission_amount;

  -- 9. Fetch source metadata if associated
  if v_band_source_id is not null then
    select * into v_source_record
    from public.operator_tariff_sources
    where id = v_band_source_id;

    if found then
      v_tariff_source_meta := jsonb_build_object(
        'source_id', v_source_record.id,
        'source_name', v_source_record.source_name,
        'source_type', v_source_record.source_type,
        'source_url', v_source_record.source_url,
        'retrieved_at', v_source_record.retrieved_at,
        'verification_status', v_source_record.verification_status
      );
    end if;
  end if;

  return jsonb_build_object(
    'service_id', v_service.id,
    'service_name', v_service.name,
    'currency', v_service.currency,
    'pricing_unit', v_service.pricing_unit,
    'duration_hours', v_duration_hours,
    'units', v_units,
    'supplier_base_amount', v_supplier_base_amount,
    'platform_markup_amount', v_platform_markup_amount,
    'booking_management_fee_amount', v_booking_management_fee_amount,
    'extras_amount', v_extras_amount,
    'discount_amount', v_discount_amount,
    'tax_amount', v_tax_amount,
    'customer_total_amount', v_customer_total_amount,
    'b2b_settlement', jsonb_build_object(
      'commission_rate_bps', v_b2b_commission_rate_bps,
      'commission_basis_amount', v_supplier_base_amount,
      'commission_amount', v_b2b_commission_amount,
      'operator_payout_amount', v_operator_payout_amount
    ),
    'tariff_source', v_tariff_source_meta,
    'calculation_version', 3,
    'applied_rules', v_applied_rules,
    'selected_extras', v_selected_extras_result,
    'breakdown', v_breakdown
  );
end;
$$;

grant execute on function public.calculate_service_quote(uuid, timestamptz, timestamptz, text, jsonb) to anon, authenticated, service_role;
