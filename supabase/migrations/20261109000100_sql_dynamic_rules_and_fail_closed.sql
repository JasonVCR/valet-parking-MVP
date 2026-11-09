-- AeroValet & Parking Hub — Increment 7: SQL Dynamic Rules Hotfix, Authoritative Commission & Pricing Fail-Closed
-- Migration: 20261109000100_sql_dynamic_rules_and_fail_closed.sql
-- 1. Corrects calculate_service_quote to strictly query service_price_rules with real schema columns:
--    adjustment_type ('override', 'fixed_addition', 'percentage_bps'), fixed_amount, percentage_bps.
-- 2. Aligns rule precedence semantics with TypeScript: highest priority rule applied with deterministic tie-breaking (order by priority desc, created_at asc, id asc limit 1).
-- 3. Hardens B2B commission: strictly derives from operators.platform_fee_bps (0..10000) or secure internal override restricted to service_role/superuser.
-- 4. Replaces 5-param calculate_service_quote signature to prevent caller override of commission rate by unprivileged clients.
-- 5. Revokes execute from PUBLIC and grants least-privilege permissions.

-- 1. Drop previous calculate_service_quote overloads
drop function if exists public.calculate_service_quote(uuid, timestamptz, timestamptz, text, jsonb);
drop function if exists public.calculate_service_quote(uuid, timestamptz, timestamptz, text, jsonb, integer);

-- 2. Recreate calculate_service_quote with real schema columns, deterministic tie-breaking and hardened commission
create or replace function public.calculate_service_quote(
  p_service_id uuid,
  p_entry_at timestamptz,
  p_exit_at timestamptz,
  p_vehicle_category text default null,
  p_selected_extras jsonb default '[]'::jsonb,
  p_b2b_commission_rate_bps integer default null
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
  v_operator public.operators%rowtype;
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

  -- B2B Settlement Memo: strictly from operator configuration (0..10000 bps)
  v_b2b_commission_rate_bps integer := 1000;
  v_b2b_commission_amount bigint := 0;
  v_operator_payout_amount bigint := 0;

  -- Tariff band matching
  v_band record;
  v_max_band record;
  v_band_matched boolean := false;
  v_band_source_id uuid;

  -- Dynamic rules matching (fallback if no tariff band exists)
  v_rule public.service_price_rules%rowtype;
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

  -- 2. Fetch service, facility, airport, operator
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

  select o.* into v_operator
  from public.operators o
  where o.id = v_facility.operator_id;

  -- Authoritative B2B commission hardening:
  -- If an override is passed, only allow service_role or superuser/admin to set it.
  -- Anon and authenticated client roles are strictly forbidden from overriding B2B commission.
  -- Otherwise, always use operator's platform_fee_bps (falling back to 1000 bps = 10%).
  if p_b2b_commission_rate_bps is not null then
    if current_setting('request.jwt.claim.role', true) = 'service_role'
       or (current_setting('request.jwt.claim.role', true) is null and session_user in ('postgres', 'service_role', 'supabase_admin')) then
      v_b2b_commission_rate_bps := p_b2b_commission_rate_bps;
    else
      -- Unprivileged caller cannot override B2B commission rate
      v_b2b_commission_rate_bps := coalesce(v_operator.platform_fee_bps, 1000);
    end if;
  elsif v_operator.platform_fee_bps is not null then
    v_b2b_commission_rate_bps := v_operator.platform_fee_bps;
  else
    v_b2b_commission_rate_bps := 1000;
  end if;

  -- Bound check commission rate (0 to 10000 bps = 0% to 100%)
  if v_b2b_commission_rate_bps < 0 or v_b2b_commission_rate_bps > 10000 then
    raise exception 'INVALID_COMMISSION_RATE_BPS' using errcode = '22023';
  end if;

  v_units := case v_service.pricing_unit
    when 'per_stay' then 1
    when 'per_day' then greatest(1, ceil(v_duration_seconds / 86400.0)::integer)
    when 'per_hour' then greatest(1, ceil(v_duration_seconds / 3600.0)::integer)
  end;

  -- Local time & weekday at airport
  v_entry_local_time := (p_entry_at at time zone coalesce(v_airport.timezone, 'Europe/Madrid'))::time;
  v_entry_weekday := extract(dow from (p_entry_at at time zone coalesce(v_airport.timezone, 'Europe/Madrid')))::smallint;

  -- 3. Check for matching Service Tariff Band (WITH VERIFIED SOURCE ONLY: source_id IS NOT NULL)
  select b.* into v_band
  from public.service_tariff_bands b
  join public.operator_tariff_sources ots on ots.id = b.source_id
  where b.service_id = p_service_id
    and b.active = true
    and b.source_id is not null
    and ots.verification_status = 'verified'
    and (ots.valid_until is null or ots.valid_until >= p_entry_at)
    and v_duration_hours >= b.min_duration_hours
    and v_duration_hours <= b.max_duration_hours
    and (b.valid_from is null or b.valid_from <= p_entry_at)
    and (b.valid_until is null or b.valid_until >= p_exit_at)
    and (b.vehicle_category is null or b.vehicle_category = coalesce(p_vehicle_category, 'standard'))
  order by (b.max_duration_hours - b.min_duration_hours) asc, b.created_at desc, b.id asc
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
    -- Check if verified bands are configured for this service but stay exceeds highest band
    select b.* into v_max_band
    from public.service_tariff_bands b
    join public.operator_tariff_sources ots on ots.id = b.source_id
    where b.service_id = p_service_id
      and b.active = true
      and b.source_id is not null
      and ots.verification_status = 'verified'
      and (ots.valid_until is null or ots.valid_until >= p_entry_at)
      and (b.valid_from is null or b.valid_from <= p_entry_at)
      and (b.valid_until is null or b.valid_until >= p_exit_at)
      and (b.vehicle_category is null or b.vehicle_category = coalesce(p_vehicle_category, 'standard'))
    order by b.max_duration_hours desc, b.id asc
    limit 1;

    if found and v_duration_hours > v_max_band.max_duration_hours then
      -- If stay exceeds maximum band and service is NOT per_day, reject automatic quote
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
  -- Follows single-rule precedence policy: applies highest priority matching rule with deterministic tie-breaking
  if not v_band_matched then
    v_adjusted_unit_price := v_service.price_amount;

    select * into v_rule
    from public.service_price_rules
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
    order by priority desc, created_at asc, id asc
    limit 1;

    if found then
      v_rule_matched := true;
      case v_rule.adjustment_type
        when 'override' then
          if v_rule.fixed_amount is not null then
            v_adjusted_unit_price := v_rule.fixed_amount;
          end if;
        when 'fixed_addition' then
          if v_rule.fixed_amount is not null then
            v_adjusted_unit_price := v_adjusted_unit_price + v_rule.fixed_amount;
          end if;
        when 'percentage_bps' then
          if v_rule.percentage_bps is not null then
            v_adjusted_unit_price := (v_adjusted_unit_price * (10000 + v_rule.percentage_bps)::bigint) / 10000;
          end if;
      end case;

      v_applied_rules := v_applied_rules || jsonb_build_object(
        'rule_id', v_rule.id,
        'rule_name', v_rule.name,
        'rule_type', v_rule.rule_type,
        'adjustment_type', v_rule.adjustment_type,
        'original_unit_price', v_service.price_amount,
        'adjusted_unit_price', v_adjusted_unit_price
      );
    end if;

    v_supplier_base_amount := v_adjusted_unit_price * v_units;

    v_breakdown := v_breakdown || jsonb_build_object(
      'label', 'Tarifa base: ' || v_service.name || ' (' || v_units || ' ' || v_service.pricing_unit || ')',
      'quantity', v_units,
      'unit_price', v_adjusted_unit_price,
      'total_price', v_supplier_base_amount,
      'type', 'base_rate'
    );
  end if;

  -- 5. Add platform markup and booking management fee (transparent AeroValet margin)
  v_breakdown := v_breakdown || jsonb_build_object(
    'label', 'Margen comercial de intermediación AeroValet',
    'quantity', 1,
    'unit_price', v_platform_markup_amount,
    'total_price', v_platform_markup_amount,
    'type', 'platform_markup'
  );

  v_breakdown := v_breakdown || jsonb_build_object(
    'label', 'Cargo por gestión y soporte de reserva',
    'quantity', 1,
    'unit_price', v_booking_management_fee_amount,
    'total_price', v_booking_management_fee_amount,
    'type', 'booking_fee'
  );

  -- 6. Process Extras (Mandatory + Strict Selected Validation with Currency Check)
  for v_extra_record in
    select * from public.service_extras
    where facility_id = v_facility.id
      and (service_id is null or service_id = p_service_id)
      and active = true
      and is_mandatory = true
  loop
    -- Strict currency check for mandatory extra
    if v_extra_record.currency != v_service.currency then
      raise exception 'CURRENCY_MISMATCH_EXTRA' using errcode = '22023';
    end if;

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

      -- Strict currency check for optional extra
      if v_extra_record.currency != v_service.currency then
        raise exception 'CURRENCY_MISMATCH_EXTRA' using errcode = '22023';
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
  v_b2b_commission_amount := round((v_supplier_base_amount * v_b2b_commission_rate_bps)::numeric / 10000.0)::bigint;
  v_operator_payout_amount := v_supplier_base_amount - v_b2b_commission_amount;

  -- 9. Fetch source metadata if associated with verified source
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
    'total_amount', v_customer_total_amount,
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

-- 3. Explicit permissions
revoke all on function public.calculate_service_quote(uuid, timestamptz, timestamptz, text, jsonb, integer) from public;
grant execute on function public.calculate_service_quote(uuid, timestamptz, timestamptz, text, jsonb, integer) to anon, authenticated, service_role;
