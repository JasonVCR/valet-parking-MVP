-- AeroValet & Parking Hub — Increment 5: Tariff Integration, Integrity & Source Verification
-- Migration: 20261027000200_tariff_integration_and_integrity.sql
-- Enforces pending_review as default for new sources, verified-only band usage,
-- strict currency and extras validation, Round Half-Up commission policy,
-- and connects create_booking_hold directly to calculate_service_quote.

-- 1. Alter default verification_status on operator_tariff_sources to pending_review
alter table public.operator_tariff_sources
  alter column verification_status set default 'pending_review'::public.tariff_verification_status;

-- 2. Update RLS on service_tariff_bands to ensure only verified sources are publicly readable
drop policy if exists "Anyone can read active tariff bands" on public.service_tariff_bands;

create policy "Anyone can read active verified tariff bands"
  on public.service_tariff_bands for select
  using (
    active = true
    and (
      source_id is null
      or exists (
        select 1 from public.operator_tariff_sources ots
        where ots.id = service_tariff_bands.source_id
          and ots.verification_status = 'verified'
      )
    )
  );

-- 3. Replace calculate_service_quote with strict currency, excess duration, and extras validation
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
  v_platform_markup_amount bigint := 800;          -- 8.00 EUR AeroValet commercial markup (minor units)
  v_booking_management_fee_amount bigint := 199;   -- 1.99 EUR Booking management & support fee
  v_extras_amount bigint := 0;
  v_discount_amount bigint := 0;
  v_tax_amount bigint := 0;                       -- Zero pending explicit tax validation with competent advisory
  v_customer_total_amount bigint := 0;

  -- B2B Settlement Memo (10% commission strictly on supplier base, never on platform markup)
  v_b2b_commission_rate_bps integer := 1000;      -- 10% = 1000 bps
  v_b2b_commission_amount bigint := 0;
  v_operator_payout_amount bigint := 0;

  -- Tariff band matching
  v_band record;
  v_max_band record;
  v_band_matched boolean := false;
  v_band_source_id uuid;

  -- Dynamic rules matching (fallback if no tariff band exists)
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
  -- 1. Interval Validation
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

  -- 3. Check for matching Service Tariff Band (with verified source only)
  select b.* into v_band
  from public.service_tariff_bands b
  left join public.operator_tariff_sources ots on ots.id = b.source_id
  where b.service_id = p_service_id
    and b.active = true
    and (b.source_id is null or ots.verification_status = 'verified')
    and v_duration_hours >= b.min_duration_hours
    and v_duration_hours <= b.max_duration_hours
    and (b.valid_from is null or b.valid_from <= p_entry_at)
    and (b.valid_until is null or b.valid_until >= p_exit_at)
    and (b.vehicle_category is null or b.vehicle_category = coalesce(p_vehicle_category, 'standard'))
  order by (b.max_duration_hours - b.min_duration_hours) asc, b.created_at desc
  limit 1;

  if found then
    -- Currency compatibility validation
    if v_band.currency != v_service.currency then
      raise exception 'CURRENCY_MISMATCH_TARIFF_BAND' using errcode = '22023';
    end if;

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
    -- Check if bands are configured for this service but stay exceeds highest band
    select b.* into v_max_band
    from public.service_tariff_bands b
    left join public.operator_tariff_sources ots on ots.id = b.source_id
    where b.service_id = p_service_id
      and b.active = true
      and (b.source_id is null or ots.verification_status = 'verified')
      and (b.valid_from is null or b.valid_from <= p_entry_at)
      and (b.valid_until is null or b.valid_until >= p_exit_at)
      and (b.vehicle_category is null or b.vehicle_category = coalesce(p_vehicle_category, 'standard'))
    order by b.max_duration_hours desc
    limit 1;

    if found and v_duration_hours > v_max_band.max_duration_hours then
      -- If stay exceeds maximum band and service is NOT per_day or no explicit excess rule exists,
      -- reject automatic quote to avoid inventing extrapolated daily rates.
      if v_service.pricing_unit != 'per_day' then
        raise exception 'QUOTE_UNAVAILABLE_EXCEEDS_BANDS' using errcode = '22023';
      end if;

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

  -- 4. Fallback to Dynamic Price Rules if no tariff band was matched
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

  -- 6. Process Extras (Mandatory + Strict Selected Validation)
  -- Mandatory extras
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

  -- Requested optional extras: must be strictly validated
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

      if not found then
        raise exception 'INVALID_EXTRA_SELECTION' using errcode = '22023';
      end if;

      v_extra_qty := coalesce((v_extra_item->>'quantity')::integer, 1);
      if v_extra_qty < 1 or v_extra_qty > v_extra_record.max_quantity then
        raise exception 'INVALID_EXTRA_QUANTITY' using errcode = '22023';
      end if;

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
    end loop;
  end if;

  -- 7. Total Customer Amount
  v_customer_total_amount := v_supplier_base_amount + v_platform_markup_amount + v_booking_management_fee_amount + v_extras_amount - v_discount_amount + v_tax_amount;

  -- 8. Compute B2B Settlement Memo with Unified Round Half-Up Policy:
  -- (supplier_base_amount * 1000) / 10000.0 rounded half-up
  v_b2b_commission_amount := round((v_supplier_base_amount * v_b2b_commission_rate_bps)::numeric / 10000.0)::bigint;
  v_operator_payout_amount := v_supplier_base_amount - v_b2b_commission_amount;

  -- 9. Fetch source metadata if associated
  if v_band_source_id is not null then
    select * into v_source_record
    from public.operator_tariff_sources
    where id = v_band_source_id and verification_status = 'verified';

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

-- 4. Update create_booking_hold to use calculate_service_quote directly
-- Guarantees 100% price and snapshot parity between quote and hold creation in PostgreSQL.
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
  p_selected_extras jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_expires_at timestamptz;
  v_facility public.facilities%rowtype;
  v_service public.services%rowtype;
  v_customer_id uuid;
  v_hold_id uuid;
  v_sellable_capacity integer;
  v_peak_occupied integer;
  v_quote jsonb;
  v_total_amount bigint;
  v_vehicle_category text := 'standard';
begin
  -- 1. Temporal Constraints
  if p_entry_at is null or p_exit_at is null or p_entry_at >= p_exit_at then
    raise exception 'INVALID_BOOKING_INTERVAL' using errcode = '22007';
  end if;

  if p_entry_at < v_now then
    raise exception 'ENTRY_MUST_BE_IN_FUTURE' using errcode = '22023';
  end if;

  -- 2. Customer vs Guest Resolution
  if auth.uid() is not null then
    v_customer_id := auth.uid();
  elsif p_customer_id is not null then
    if auth.role() != 'service_role' and auth.uid() != p_customer_id then
      raise exception 'CUSTOMER_IMPERSONATION_DENIED' using errcode = '42501';
    end if;
    v_customer_id := p_customer_id;
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

  -- 4. Facility Row-Level Locking
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
      count(*) as occupied_count
    from critical_instants ci
    join overlapping_stays os on os.entry_at <= ci.instant and os.exit_at > ci.instant
    group by ci.instant
  )
  select coalesce(max(occupied_count), 0) into v_peak_occupied
  from occupancy_per_instant;

  if (v_peak_occupied + 1) > v_sellable_capacity then
    raise exception 'CAPACITY_EXHAUSTED' using errcode = 'P0001';
  end if;

  -- 7. Call calculate_service_quote to obtain authoritative Version 3 pricing & snapshot
  v_quote := public.calculate_service_quote(
    p_service_id => p_service_id,
    p_entry_at => p_entry_at,
    p_exit_at => p_exit_at,
    p_vehicle_category => v_vehicle_category,
    p_selected_extras => p_selected_extras
  );

  v_total_amount := (v_quote->>'customer_total_amount')::bigint;

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
    v_total_amount, v_service.currency, v_quote,
    lower(trim(p_guest_email)), trim(p_guest_name), trim(p_guest_phone)
  ) returning id into v_hold_id;

  -- 9. Return structured hold confirmation
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
