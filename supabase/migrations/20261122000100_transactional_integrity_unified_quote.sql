-- AeroValet & Parking Hub — Increment 8: Transactional Integrity & Unified Quote
-- Migration: 20261122000100_transactional_integrity_unified_quote.sql
--
-- 1. Adds p_expected_total_amount to create_booking_hold: validates price BEFORE INSERT.
--    If the expected amount doesn't match the calculated quote, raises PRICE_DISCREPANCY
--    without creating any hold or consuming capacity.
-- 2. Extends source provenance gating to:
--    - service_tariff_bands
--    - services.price_amount
--    - service_price_rules
--    - excess stay rates (tarifas de exceso de estancia)
--    Requires a verifiable relationship with operator_tariff_sources.
--    Checks verification_status = 'verified', vigencia (valid_from/valid_until), and operator ownership.
--    If no valid and active verified source exists, automatic quotation is rejected (raising NO_VERIFIED_TARIFF_SOURCE).
-- 3. Round Half-Up policy adopted for percentage_bps rules across PostgreSQL and TypeScript:
--    PostgreSQL: round((price * (10000 + bps)::numeric) / 10000.0)::bigint
--    TypeScript: Math.round((price * (10000 + bps)) / 10000)
--    Both maintain mathematical parity with half-up rounding on fractional cents.

-- ═══════════════════════════════════════════════════════════════════════════════
-- PART 1: Add source_id to services and service_price_rules for provenance
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS source_id uuid REFERENCES public.operator_tariff_sources(id) ON DELETE SET NULL;

ALTER TABLE public.service_price_rules
  ADD COLUMN IF NOT EXISTS source_id uuid REFERENCES public.operator_tariff_sources(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS service_price_rules_source_idx
  ON public.service_price_rules(source_id)
  WHERE source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS services_source_idx
  ON public.services(source_id)
  WHERE source_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════════
-- PART 2: Authoritative calculate_service_quote with comprehensive provenance gating
-- ═══════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.calculate_service_quote(uuid, timestamptz, timestamptz, text, jsonb, integer);

CREATE OR REPLACE FUNCTION public.calculate_service_quote(
  p_service_id uuid,
  p_entry_at timestamptz,
  p_exit_at timestamptz,
  p_vehicle_category text DEFAULT NULL,
  p_selected_extras jsonb DEFAULT '[]'::jsonb,
  p_b2b_commission_rate_bps integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_service public.services%rowtype;
  v_facility public.facilities%rowtype;
  v_airport public.airports%rowtype;
  v_operator public.operators%rowtype;
  v_duration_seconds numeric;
  v_duration_hours integer;
  v_units integer;

  -- Price components
  v_supplier_base_amount bigint := 0;
  v_platform_markup_amount bigint := 800;          -- 8.00 EUR AeroValet commercial markup
  v_booking_management_fee_amount bigint := 199;   -- 1.99 EUR Booking management & support fee
  v_extras_amount bigint := 0;
  v_discount_amount bigint := 0;
  v_tax_amount bigint := 0;
  v_customer_total_amount bigint := 0;

  -- B2B Settlement
  v_b2b_commission_rate_bps integer := 1000;
  v_b2b_commission_amount bigint := 0;
  v_operator_payout_amount bigint := 0;

  -- Tariff band matching
  v_band record;
  v_max_band record;
  v_band_matched boolean := false;
  v_band_source_id uuid;

  -- Dynamic rules matching
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

  -- Provenance helper
  v_has_service_provenance boolean := false;
BEGIN
  -- 1. Interval Validation
  IF p_entry_at IS NULL OR p_exit_at IS NULL OR p_entry_at >= p_exit_at THEN
    RAISE EXCEPTION 'INVALID_BOOKING_INTERVAL' USING errcode = '22007';
  END IF;

  v_duration_seconds := extract(epoch from (p_exit_at - p_entry_at));
  IF v_duration_seconds < 1800 THEN
    RAISE EXCEPTION 'DURATION_TOO_SHORT' USING errcode = '22023';
  END IF;

  v_duration_hours := ceil(v_duration_seconds / 3600.0)::integer;

  -- 2. Fetch service, facility, airport, operator
  SELECT s.* INTO v_service
  FROM public.services s
  WHERE s.id = p_service_id AND s.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SERVICE_NOT_AVAILABLE' USING errcode = 'P0002';
  END IF;

  SELECT f.* INTO v_facility
  FROM public.facilities f
  WHERE f.id = v_service.facility_id AND f.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FACILITY_NOT_AVAILABLE' USING errcode = 'P0002';
  END IF;

  SELECT a.* INTO v_airport
  FROM public.airports a
  WHERE a.id = v_facility.airport_id;

  SELECT o.* INTO v_operator
  FROM public.operators o
  WHERE o.id = v_facility.operator_id;

  -- Authoritative B2B commission hardening:
  -- Only service_role / superuser can pass p_b2b_commission_rate_bps override.
  -- Anon / authenticated users always use operator's platform_fee_bps or default 1000 bps.
  IF p_b2b_commission_rate_bps IS NOT NULL THEN
    IF current_setting('request.jwt.claim.role', true) = 'service_role'
       OR (current_setting('request.jwt.claim.role', true) IS NULL AND session_user IN ('postgres', 'service_role', 'supabase_admin')) THEN
      v_b2b_commission_rate_bps := p_b2b_commission_rate_bps;
    ELSE
      v_b2b_commission_rate_bps := coalesce(v_operator.platform_fee_bps, 1000);
    END IF;
  ELSIF v_operator.platform_fee_bps IS NOT NULL THEN
    v_b2b_commission_rate_bps := v_operator.platform_fee_bps;
  ELSE
    v_b2b_commission_rate_bps := 1000;
  END IF;

  IF v_b2b_commission_rate_bps < 0 OR v_b2b_commission_rate_bps > 10000 THEN
    RAISE EXCEPTION 'INVALID_COMMISSION_RATE_BPS' USING errcode = '22023';
  END IF;

  v_units := CASE v_service.pricing_unit
    WHEN 'per_stay' THEN 1
    WHEN 'per_day' THEN greatest(1, ceil(v_duration_seconds / 86400.0)::integer)
    WHEN 'per_hour' THEN greatest(1, ceil(v_duration_seconds / 3600.0)::integer)
  END;

  -- Local time & weekday at airport
  v_entry_local_time := (p_entry_at AT TIME ZONE coalesce(v_airport.timezone, 'Europe/Madrid'))::time;
  v_entry_weekday := extract(dow from (p_entry_at AT TIME ZONE coalesce(v_airport.timezone, 'Europe/Madrid')))::smallint;

  -- 3. Check for matching Service Tariff Band (WITH VERIFIED, UNEXPIRED SOURCE BELONGING TO OPERATOR)
  SELECT b.* INTO v_band
  FROM public.service_tariff_bands b
  JOIN public.operator_tariff_sources ots ON ots.id = b.source_id
  WHERE b.service_id = p_service_id
    AND b.active = true
    AND b.source_id IS NOT NULL
    AND ots.operator_id = v_operator.id
    AND ots.verification_status = 'verified'
    AND (ots.valid_from IS NULL OR ots.valid_from <= p_entry_at)
    AND (ots.valid_until IS NULL OR ots.valid_until >= p_entry_at)
    AND v_duration_hours >= b.min_duration_hours
    AND v_duration_hours <= b.max_duration_hours
    AND (b.valid_from IS NULL OR b.valid_from <= p_entry_at)
    AND (b.valid_until IS NULL OR b.valid_until >= p_exit_at)
    AND (b.vehicle_category IS NULL OR b.vehicle_category = coalesce(p_vehicle_category, 'standard'))
  ORDER BY (b.max_duration_hours - b.min_duration_hours) ASC, b.created_at DESC, b.id ASC
  LIMIT 1;

  IF FOUND THEN
    IF v_band.currency != v_service.currency THEN
      RAISE EXCEPTION 'CURRENCY_MISMATCH_TARIFF_BAND' USING errcode = '22023';
    END IF;

    v_band_matched := true;
    v_band_source_id := v_band.source_id;

    IF v_band.pricing_unit = 'flat_stay' THEN
      v_supplier_base_amount := v_band.price_amount;
    ELSE
      v_supplier_base_amount := v_band.price_amount * v_units;
    END IF;

    v_breakdown := v_breakdown || jsonb_build_object(
      'label', 'Tarifa del operador: ' || v_band.name || ' (' || v_duration_hours || 'h)',
      'quantity', 1,
      'unit_price', v_supplier_base_amount,
      'total_price', v_supplier_base_amount,
      'type', 'supplier_tariff_band'
    );
  ELSE
    -- Check if verified bands exist but stay exceeds highest band
    SELECT b.* INTO v_max_band
    FROM public.service_tariff_bands b
    JOIN public.operator_tariff_sources ots ON ots.id = b.source_id
    WHERE b.service_id = p_service_id
      AND b.active = true
      AND b.source_id IS NOT NULL
      AND ots.operator_id = v_operator.id
      AND ots.verification_status = 'verified'
      AND (ots.valid_from IS NULL OR ots.valid_from <= p_entry_at)
      AND (ots.valid_until IS NULL OR ots.valid_until >= p_entry_at)
      AND (b.valid_from IS NULL OR b.valid_from <= p_entry_at)
      AND (b.valid_until IS NULL OR b.valid_until >= p_exit_at)
      AND (b.vehicle_category IS NULL OR b.vehicle_category = coalesce(p_vehicle_category, 'standard'))
    ORDER BY b.max_duration_hours DESC, b.id ASC
    LIMIT 1;

    IF FOUND AND v_duration_hours > v_max_band.max_duration_hours THEN
      IF v_service.pricing_unit != 'per_day' THEN
        RAISE EXCEPTION 'QUOTE_UNAVAILABLE_EXCEEDS_BANDS' USING errcode = '22023';
      END IF;

      -- PROCEDENCIA DE TARIFA DE EXCESO DE ESTANCIA:
      -- The excess daily rate comes from services.price_amount.
      -- We must verify that services.price_amount has an active, verified, unexpired provenance!
      SELECT EXISTS (
        SELECT 1 FROM public.operator_tariff_sources ots
        WHERE (
          (v_service.source_id IS NOT NULL AND ots.id = v_service.source_id)
          OR ots.service_id = p_service_id
          OR (ots.operator_id = v_operator.id AND ots.service_id IS NULL)
        )
        AND ots.operator_id = v_operator.id
        AND ots.verification_status = 'verified'
        AND (ots.valid_from IS NULL OR ots.valid_from <= p_entry_at)
        AND (ots.valid_until IS NULL OR ots.valid_until >= p_entry_at)
      ) INTO v_has_service_provenance;

      IF NOT v_has_service_provenance THEN
        RAISE EXCEPTION 'NO_VERIFIED_TARIFF_SOURCE' USING errcode = '22023';
      END IF;

      DECLARE
        v_extra_hours integer := v_duration_hours - v_max_band.max_duration_hours;
        v_extra_days integer := ceil(v_extra_hours / 24.0)::integer;
        v_daily_rate bigint := v_service.price_amount;
        v_extra_amount bigint := v_daily_rate * v_extra_days;
      BEGIN
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
      END;
    END IF;
  END IF;

  -- 4. Fallback to Dynamic Price Rules if no tariff band was matched
  --    PROCEDENCIA DE REGLAS DINÁMICAS:
  --    Only rules with a verified, unexpired source belonging to this operator are applied.
  IF NOT v_band_matched THEN
    v_adjusted_unit_price := v_service.price_amount;

    SELECT r.* INTO v_rule
    FROM public.service_price_rules r
    JOIN public.operator_tariff_sources ots ON ots.id = r.source_id
    WHERE r.service_id = p_service_id
      AND r.active = true
      AND r.source_id IS NOT NULL
      AND ots.operator_id = v_operator.id
      AND ots.verification_status = 'verified'
      AND (ots.valid_from IS NULL OR ots.valid_from <= p_entry_at)
      AND (ots.valid_until IS NULL OR ots.valid_until >= p_entry_at)
      AND (r.valid_from IS NULL OR r.valid_from <= p_entry_at)
      AND (r.valid_until IS NULL OR r.valid_until >= p_exit_at)
      AND (r.weekdays IS NULL OR v_entry_weekday = any(r.weekdays))
      AND (r.entry_time_start IS NULL OR v_entry_local_time >= r.entry_time_start)
      AND (r.entry_time_end IS NULL OR v_entry_local_time <= r.entry_time_end)
      AND (r.min_duration_hours IS NULL OR v_duration_hours >= r.min_duration_hours)
      AND (r.max_duration_hours IS NULL OR v_duration_hours <= r.max_duration_hours)
      AND (r.vehicle_category IS NULL OR r.vehicle_category = coalesce(p_vehicle_category, 'standard'))
    ORDER BY r.priority DESC, r.created_at ASC, r.id ASC
    LIMIT 1;

    IF FOUND THEN
      v_rule_matched := true;
      v_band_source_id := v_rule.source_id;

      CASE v_rule.adjustment_type
        WHEN 'override' THEN
          IF v_rule.fixed_amount IS NOT NULL THEN
            v_adjusted_unit_price := v_rule.fixed_amount;
          END IF;
        WHEN 'fixed_addition' THEN
          IF v_rule.fixed_amount IS NOT NULL THEN
            v_adjusted_unit_price := v_adjusted_unit_price + v_rule.fixed_amount;
          END IF;
        WHEN 'percentage_bps' THEN
          IF v_rule.percentage_bps IS NOT NULL THEN
            -- ROUND HALF-UP POLICY:
            -- round((price * (10000 + bps)::numeric) / 10000.0)::bigint
            -- Accurately rounds .5 to the next whole cent, matching TypeScript Math.round.
            v_adjusted_unit_price := round((v_adjusted_unit_price * (10000 + v_rule.percentage_bps)::numeric) / 10000.0)::bigint;
          END IF;
      END CASE;

      v_applied_rules := v_applied_rules || jsonb_build_object(
        'rule_id', v_rule.id,
        'rule_name', v_rule.name,
        'rule_type', v_rule.rule_type,
        'adjustment_type', v_rule.adjustment_type,
        'original_unit_price', v_service.price_amount,
        'adjusted_unit_price', v_adjusted_unit_price
      );
    END IF;

    -- PROCEDENCIA DE PRECIO BASE (services.price_amount):
    -- If no rule matched, the quote relies strictly on v_service.price_amount.
    -- We must ensure services.price_amount has an active, verified, unexpired provenance!
    IF NOT v_rule_matched THEN
      SELECT EXISTS (
        SELECT 1 FROM public.operator_tariff_sources ots
        WHERE (
          (v_service.source_id IS NOT NULL AND ots.id = v_service.source_id)
          OR ots.service_id = p_service_id
          OR (ots.operator_id = v_operator.id AND ots.service_id IS NULL)
        )
        AND ots.operator_id = v_operator.id
        AND ots.verification_status = 'verified'
        AND (ots.valid_from IS NULL OR ots.valid_from <= p_entry_at)
        AND (ots.valid_until IS NULL OR ots.valid_until >= p_entry_at)
      ) INTO v_has_service_provenance;

      IF NOT v_has_service_provenance THEN
        RAISE EXCEPTION 'NO_VERIFIED_TARIFF_SOURCE' USING errcode = '22023';
      END IF;

      -- Check if we can pick up source_id from service or operator sources
      SELECT ots.id INTO v_band_source_id
      FROM public.operator_tariff_sources ots
      WHERE (
        (v_service.source_id IS NOT NULL AND ots.id = v_service.source_id)
        OR ots.service_id = p_service_id
        OR (ots.operator_id = v_operator.id AND ots.service_id IS NULL)
      )
      AND ots.operator_id = v_operator.id
      AND ots.verification_status = 'verified'
      AND (ots.valid_from IS NULL OR ots.valid_from <= p_entry_at)
      AND (ots.valid_until IS NULL OR ots.valid_until >= p_entry_at)
      ORDER BY (ots.service_id IS NOT NULL) DESC, ots.created_at DESC
      LIMIT 1;
    END IF;

    v_supplier_base_amount := v_adjusted_unit_price * v_units;

    v_breakdown := v_breakdown || jsonb_build_object(
      'label', 'Tarifa base: ' || v_service.name || ' (' || v_units || ' ' || v_service.pricing_unit || ')',
      'quantity', v_units,
      'unit_price', v_adjusted_unit_price,
      'total_price', v_supplier_base_amount,
      'type', 'base_rate'
    );
  END IF;

  -- 5. Platform markup and booking management fee
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
  FOR v_extra_record IN
    SELECT * FROM public.service_extras
    WHERE facility_id = v_facility.id
      AND (service_id IS NULL OR service_id = p_service_id)
      AND active = true
      AND is_mandatory = true
  LOOP
    IF v_extra_record.currency != v_service.currency THEN
      RAISE EXCEPTION 'CURRENCY_MISMATCH_EXTRA' USING errcode = '22023';
    END IF;

    v_extra_qty := 1;
    v_extra_cost := CASE v_extra_record.pricing_unit
      WHEN 'per_stay' THEN v_extra_record.price_amount * v_extra_qty
      WHEN 'per_day' THEN v_extra_record.price_amount * v_units * v_extra_qty
    END;
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
  END LOOP;

  -- Requested optional extras
  IF p_selected_extras IS NOT NULL AND jsonb_typeof(p_selected_extras) = 'array' THEN
    FOR v_extra_item IN SELECT * FROM jsonb_array_elements(p_selected_extras)
    LOOP
      SELECT * INTO v_extra_record
      FROM public.service_extras
      WHERE id = (v_extra_item->>'extra_id')::uuid
        AND facility_id = v_facility.id
        AND (service_id IS NULL OR service_id = p_service_id)
        AND active = true
        AND is_mandatory = false;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'INVALID_EXTRA_SELECTION' USING errcode = '22023';
      END IF;

      IF v_extra_record.currency != v_service.currency THEN
        RAISE EXCEPTION 'CURRENCY_MISMATCH_EXTRA' USING errcode = '22023';
      END IF;

      v_extra_qty := coalesce((v_extra_item->>'quantity')::integer, 1);
      IF v_extra_qty < 1 OR v_extra_qty > v_extra_record.max_quantity THEN
        RAISE EXCEPTION 'INVALID_EXTRA_QUANTITY' USING errcode = '22023';
      END IF;

      v_extra_cost := CASE v_extra_record.pricing_unit
        WHEN 'per_stay' THEN v_extra_record.price_amount * v_extra_qty
        WHEN 'per_day' THEN v_extra_record.price_amount * v_units * v_extra_qty
      END;
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
    END LOOP;
  END IF;

  -- 7. Total Customer Amount
  v_customer_total_amount := v_supplier_base_amount + v_platform_markup_amount + v_booking_management_fee_amount + v_extras_amount - v_discount_amount + v_tax_amount;

  -- 8. B2B Settlement with Unified Round Half-Up Policy
  v_b2b_commission_amount := round((v_supplier_base_amount * v_b2b_commission_rate_bps)::numeric / 10000.0)::bigint;
  v_operator_payout_amount := v_supplier_base_amount - v_b2b_commission_amount;

  -- 9. Fetch source metadata
  IF v_band_source_id IS NOT NULL THEN
    SELECT * INTO v_source_record
    FROM public.operator_tariff_sources
    WHERE id = v_band_source_id AND verification_status = 'verified';

    IF FOUND THEN
      v_tariff_source_meta := jsonb_build_object(
        'source_id', v_source_record.id,
        'source_name', v_source_record.source_name,
        'source_type', v_source_record.source_type,
        'source_url', v_source_record.source_url,
        'retrieved_at', v_source_record.retrieved_at,
        'verification_status', v_source_record.verification_status
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
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
    'calculation_version', 4,
    'applied_rules', v_applied_rules,
    'selected_extras', v_selected_extras_result,
    'breakdown', v_breakdown
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- PART 3: create_booking_hold with atomic expected price validation BEFORE INSERT
-- ═══════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.create_booking_hold(uuid, uuid, timestamptz, timestamptz, uuid, uuid, text, text, text, text, jsonb);

CREATE OR REPLACE FUNCTION public.create_booking_hold(
  p_facility_id uuid,
  p_service_id uuid,
  p_entry_at timestamptz,
  p_exit_at timestamptz,
  p_vehicle_id uuid DEFAULT NULL,
  p_customer_id uuid DEFAULT NULL,
  p_guest_email text DEFAULT NULL,
  p_guest_name text DEFAULT NULL,
  p_guest_phone text DEFAULT NULL,
  p_vehicle_category text DEFAULT NULL,
  p_selected_extras jsonb DEFAULT '[]'::jsonb,
  p_expected_total_amount bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
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
  v_vehicle_category text;
BEGIN
  -- 1. Temporal Constraints
  IF p_entry_at IS NULL OR p_exit_at IS NULL OR p_entry_at >= p_exit_at THEN
    RAISE EXCEPTION 'INVALID_BOOKING_INTERVAL' USING errcode = '22007';
  END IF;

  IF p_entry_at < v_now THEN
    RAISE EXCEPTION 'ENTRY_MUST_BE_IN_FUTURE' USING errcode = '22023';
  END IF;

  -- 2. Customer vs Guest Identity Resolution
  IF auth.uid() IS NOT NULL THEN
    v_customer_id := auth.uid();
  ELSIF p_customer_id IS NOT NULL THEN
    IF auth.role() != 'service_role' AND auth.uid() != p_customer_id THEN
      RAISE EXCEPTION 'CUSTOMER_IMPERSONATION_DENIED' USING errcode = '42501';
    END IF;
    v_customer_id := p_customer_id;
  ELSE
    IF p_guest_email IS NULL OR position('@' IN p_guest_email) <= 1 OR p_guest_name IS NULL OR length(trim(p_guest_name)) = 0 THEN
      RAISE EXCEPTION 'GUEST_CONTACT_REQUIRED' USING errcode = '22023';
    END IF;
    v_customer_id := NULL;
  END IF;

  -- 3. Vehicle Ownership & Category Resolution
  IF p_vehicle_id IS NOT NULL THEN
    IF v_customer_id IS NOT NULL THEN
      SELECT v.category INTO v_vehicle_category
      FROM public.vehicles v
      WHERE v.id = p_vehicle_id AND v.customer_id = v_customer_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'VEHICLE_NOT_OWNED_BY_CUSTOMER' USING errcode = '42501';
      END IF;
    END IF;
  END IF;

  IF p_vehicle_category IS NOT NULL AND length(trim(p_vehicle_category)) > 0 THEN
    v_vehicle_category := p_vehicle_category;
  ELSIF v_vehicle_category IS NULL THEN
    v_vehicle_category := 'standard';
  END IF;

  -- 4. Facility Row-Level Locking (serializes concurrent capacity reservations)
  SELECT f.* INTO v_facility
  FROM public.facilities f
  JOIN public.operators o ON o.id = f.operator_id
  WHERE f.id = p_facility_id AND f.active = true AND o.status = 'active'
  FOR UPDATE OF f;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FACILITY_NOT_AVAILABLE' USING errcode = 'P0002';
  END IF;

  -- 5. Service Resolution and Validation
  SELECT s.* INTO v_service
  FROM public.services s
  WHERE s.id = p_service_id AND s.facility_id = p_facility_id AND s.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SERVICE_NOT_AVAILABLE' USING errcode = 'P0002';
  END IF;

  -- 6. Timeline-based Peak Concurrent Occupancy Calculation
  v_sellable_capacity := v_facility.total_capacity - v_facility.operational_buffer;
  IF v_sellable_capacity <= 0 THEN
    RAISE EXCEPTION 'CAPACITY_EXHAUSTED' USING errcode = 'P0001';
  END IF;

  WITH overlapping_stays AS (
    SELECT b.entry_at, b.exit_at
    FROM public.bookings b
    WHERE b.facility_id = p_facility_id
      AND b.status IN ('confirmed', 'active')
      AND b.entry_at < p_exit_at
      AND b.exit_at > p_entry_at
    UNION ALL
    SELECT h.entry_at, h.exit_at
    FROM public.booking_holds h
    WHERE h.facility_id = p_facility_id
      AND h.status = 'active'
      AND h.expires_at > v_now
      AND h.entry_at < p_exit_at
      AND h.exit_at > p_entry_at
  ),
  critical_instants AS (
    SELECT p_entry_at AS instant
    UNION
    SELECT entry_at AS instant
    FROM overlapping_stays
    WHERE entry_at > p_entry_at AND entry_at < p_exit_at
  ),
  occupancy_per_instant AS (
    SELECT
      ci.instant,
      count(*) AS occupied_count
    FROM critical_instants ci
    JOIN overlapping_stays os ON os.entry_at <= ci.instant AND os.exit_at > ci.instant
    GROUP BY ci.instant
  )
  SELECT coalesce(max(occupied_count), 0) INTO v_peak_occupied
  FROM occupancy_per_instant;

  IF (v_peak_occupied + 1) > v_sellable_capacity THEN
    RAISE EXCEPTION 'CAPACITY_EXHAUSTED' USING errcode = 'P0001';
  END IF;

  -- 7. Call calculate_service_quote to obtain authoritative pricing & snapshot
  v_quote := public.calculate_service_quote(
    p_service_id => p_service_id,
    p_entry_at => p_entry_at,
    p_exit_at => p_exit_at,
    p_vehicle_category => v_vehicle_category,
    p_selected_extras => p_selected_extras
  );

  v_total_amount := (v_quote->>'customer_total_amount')::bigint;

  -- 8. ATOMIC PRICE DISCREPANCY CHECK: STRICTLY BEFORE INSERT
  --    If the caller provided an expected total amount, compare it with the
  --    authoritative calculated quote. If they do not match exactly, raise
  --    PRICE_DISCREPANCY immediately.
  --    CRITICAL: This aborts before INSERT, so NO hold is created and NO capacity is consumed.
  IF p_expected_total_amount IS NOT NULL AND p_expected_total_amount != v_total_amount THEN
    RAISE EXCEPTION 'PRICE_DISCREPANCY: expected=% actual=%', p_expected_total_amount, v_total_amount
      USING errcode = '22023';
  END IF;

  -- 9. Persist Hold with 15-minute expiration (only reached if prices match)
  v_expires_at := v_now + interval '15 minutes';

  INSERT INTO public.booking_holds (
    customer_id, facility_id, service_id, vehicle_id,
    entry_at, exit_at, status, expires_at,
    price_amount, currency, price_snapshot,
    guest_email, guest_name, guest_phone
  ) VALUES (
    v_customer_id, p_facility_id, p_service_id, p_vehicle_id,
    p_entry_at, p_exit_at, 'active', v_expires_at,
    v_total_amount, v_service.currency, v_quote,
    lower(trim(p_guest_email)), trim(p_guest_name), trim(p_guest_phone)
  ) RETURNING id INTO v_hold_id;

  -- 10. Return structured hold confirmation guaranteeing 100% price parity
  RETURN jsonb_build_object(
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
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- PART 4: Explicit permissions
-- ═══════════════════════════════════════════════════════════════════════════════

REVOKE ALL ON FUNCTION public.calculate_service_quote(uuid, timestamptz, timestamptz, text, jsonb, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.calculate_service_quote(uuid, timestamptz, timestamptz, text, jsonb, integer) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_booking_hold(uuid, uuid, timestamptz, timestamptz, uuid, uuid, text, text, text, text, jsonb, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_booking_hold(uuid, uuid, timestamptz, timestamptz, uuid, uuid, text, text, text, text, jsonb, bigint) TO anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- PART 5: Rounding Policy Documentation Contract
-- ═══════════════════════════════════════════════════════════════════════════════

-- ROUNDING POLICY DOCUMENTATION:
--
-- 1. B2B Commission: Round Half-Up
--    PostgreSQL: round((v_supplier_base_amount * v_b2b_commission_rate_bps)::numeric / 10000.0)::bigint
--    TypeScript: Math.round((supplierBaseAmount * b2bCommissionRateBps) / 10000)
--    Both use Round Half-Up. For 205 cents at 10% (1000 bps): 205 * 0.10 = 20.5 -> rounds to 21.
--
-- 2. Percentage BPS Price Rules: Round Half-Up
--    PostgreSQL: round((v_adjusted_unit_price * (10000 + v_rule.percentage_bps)::numeric) / 10000.0)::bigint
--    TypeScript: Math.round((basePriceAmount * (10000 + topRule.percentage_bps)) / 10000)
--    Both use Round Half-Up. Examples:
--      - 2050 cents + 100 bps (+1.00%): 2050 * 10100 / 10000 = 2070.5 -> 2071 cents
--      - 2005 cents + 250 bps (+2.50%): 2005 * 10250 / 10000 = 2055.125 -> 2055 cents
--      - 2001 cents + 333 bps (+3.33%): 2001 * 10333 / 10000 = 2067.6333 -> 2068 cents
--      - 2001 cents - 333 bps (-3.33%): 2001 * 9667 / 10000 = 1934.3667 -> 1934 cents
