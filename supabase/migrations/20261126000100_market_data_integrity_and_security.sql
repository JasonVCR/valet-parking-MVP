-- AeroValet & Parking Hub — Increment 8.2: Market Data Integrity, Real Acquisition & Security
-- Incremental migration applied on top of 20261123000100_increment_8_1_hardening.sql

-- ═══════════════════════════════════════════════════════════════════════════════
-- PART 1: Structured Feature Verification Status & Columns on Facilities
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'feature_verification_status') THEN
    CREATE TYPE public.feature_verification_status AS ENUM (
      'verified',      -- Verified with concrete evidence from official operator source
      'not_available', -- Explicitly verified that facility does NOT offer this feature
      'unknown'        -- No verifiable evidence; never published as available
    );
  END IF;
END $$;

ALTER TABLE public.facilities
  ADD COLUMN IF NOT EXISTS feature_ev_charging public.feature_verification_status NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS feature_car_wash public.feature_verification_status NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS feature_covered public.feature_verification_status NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS feature_cctv_24h public.feature_verification_status NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS feature_evidence jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Structured tariff bands evidence and review status
ALTER TABLE public.service_tariff_bands
  ADD COLUMN IF NOT EXISTS evidence_snippet text,
  ADD COLUMN IF NOT EXISTS review_status public.tariff_verification_status NOT NULL DEFAULT 'pending_review';

-- ═══════════════════════════════════════════════════════════════════════════════
-- PART 2: Security Hardening: Restrict release_booking_hold to service_role Only
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.release_booking_hold(
  p_hold_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated boolean := false;
  v_hold public.booking_holds%rowtype;
BEGIN
  IF p_hold_id IS NULL THEN
    RETURN false;
  END IF;

  -- Security Boundary Check:
  -- Only trusted server roles (service_role, postgres, supabase_admin) may invoke hold compensation.
  -- Unauthorized external users are strictly forbidden from releasing holds.
  IF current_user NOT IN ('postgres', 'service_role', 'supabase_admin')
     AND coalesce(current_setting('request.jwt.claim.role', true), '') != 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED_HOLD_RELEASE: Only service_role can release booking holds'
      USING errcode = '42501';
  END IF;

  SELECT * INTO v_hold
  FROM public.booking_holds
  WHERE id = p_hold_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_hold.status = 'active' THEN
    UPDATE public.booking_holds
    SET status = 'released',
        updated_at = clock_timestamp()
    WHERE id = p_hold_id;
    v_updated := true;
  END IF;

  RETURN v_updated;
END;
$$;

-- Restrict privileges: NEVER grant to anon or authenticated
REVOKE ALL ON FUNCTION public.release_booking_hold(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_booking_hold(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_booking_hold(uuid) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- PART 3: Hardened calculate_service_quote:
--   1. Strict Source Provenance: source_id must belong to the facility's operator
--   2. Mandatory Extras Restoration
--   3. Strict Extra Currency, Service Matching, and Quantity Bounds
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.calculate_service_quote(
  p_service_id uuid,
  p_entry_at timestamptz,
  p_exit_at timestamptz,
  p_vehicle_category text DEFAULT NULL,
  p_selected_extras jsonb DEFAULT '[]'::jsonb,
  p_b2b_commission_rate_bps integer DEFAULT NULL,
  p_facility_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_service public.services%rowtype;
  v_facility public.facilities%rowtype;
  v_operator public.operators%rowtype;
  v_source public.operator_tariff_sources%rowtype;
  v_band record;
  v_max_band record;
  v_rule record;
  v_extra_record public.service_extras%rowtype;
  v_extra_item jsonb;

  v_duration_seconds numeric;
  v_duration_hours integer;
  v_units integer := 1;

  -- Price components
  v_supplier_base_amount bigint := 0;
  v_platform_markup_amount bigint := 800;         -- 8.00 EUR AeroValet commercial markup
  v_booking_management_fee_amount bigint := 199;  -- 1.99 EUR Booking management & support fee
  v_extras_amount bigint := 0;
  v_discount_amount bigint := 0;
  v_tax_amount bigint := 0;
  v_customer_total_amount bigint := 0;

  -- B2B Settlement
  v_b2b_commission_rate_bps integer := 1000;
  v_b2b_commission_amount bigint := 0;
  v_operator_payout_amount bigint := 0;

  -- State tracking
  v_band_matched boolean := false;
  v_band_source_id uuid := null;
  v_excess_hours integer := 0;
  v_excess_days integer := 0;
  v_excess_stay_charge bigint := 0;
  v_excess_stay_rate_per_day bigint := 2000;
  v_best_rule_matched boolean := false;
  v_adjusted_unit_price bigint;
  v_extra_qty integer;
  v_extra_cost bigint;

  -- Output JSON structures
  v_applied_rules jsonb := '[]'::jsonb;
  v_selected_extras_result jsonb := '[]'::jsonb;
  v_breakdown jsonb := '[]'::jsonb;
  v_now timestamptz := clock_timestamp();
BEGIN
  -- 1. Input Validation
  IF p_service_id IS NULL THEN
    RAISE EXCEPTION 'SERVICE_ID_REQUIRED' USING errcode = '22023';
  END IF;

  IF p_entry_at IS NULL OR p_exit_at IS NULL OR p_entry_at >= p_exit_at THEN
    RAISE EXCEPTION 'INVALID_BOOKING_INTERVAL' USING errcode = '22007';
  END IF;

  v_duration_seconds := extract(epoch FROM (p_exit_at - p_entry_at));
  IF v_duration_seconds < 1800 THEN
    RAISE EXCEPTION 'DURATION_TOO_SHORT' USING errcode = '22023';
  END IF;

  IF v_duration_seconds > (90 * 86400) THEN
    RAISE EXCEPTION 'DURATION_EXCEEDS_LIMIT' USING errcode = '22023';
  END IF;

  v_duration_hours := ceil(v_duration_seconds / 3600.0)::integer;

  -- 2. Fetch service & facility
  SELECT s.* INTO v_service
  FROM public.services s
  WHERE s.id = p_service_id AND s.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SERVICE_NOT_AVAILABLE' USING errcode = 'P0002';
  END IF;

  IF p_facility_id IS NOT NULL AND v_service.facility_id != p_facility_id THEN
    RAISE EXCEPTION 'SERVICE_FACILITY_MISMATCH: Service % does not belong to facility %', p_service_id, p_facility_id
      USING errcode = '22023';
  END IF;

  SELECT f.* INTO v_facility
  FROM public.facilities f
  WHERE f.id = v_service.facility_id AND f.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FACILITY_NOT_AVAILABLE' USING errcode = 'P0002';
  END IF;

  SELECT o.* INTO v_operator
  FROM public.operators o
  WHERE o.id = v_facility.operator_id;

  IF NOT FOUND OR v_operator.status != 'active' THEN
    RAISE EXCEPTION 'OPERATOR_NOT_ACTIVE' USING errcode = 'P0002';
  END IF;

  -- Authoritative B2B commission
  IF p_b2b_commission_rate_bps IS NOT NULL THEN
    IF current_setting('request.jwt.claim.role', true) = 'service_role'
       OR (current_setting('request.jwt.claim.role', true) IS NULL AND session_user IN ('postgres', 'service_role', 'supabase_admin')) THEN
      v_b2b_commission_rate_bps := p_b2b_commission_rate_bps;
    ELSE
      v_b2b_commission_rate_bps := coalesce(v_operator.platform_fee_bps, 1000);
    END IF;
  ELSE
    v_b2b_commission_rate_bps := coalesce(v_operator.platform_fee_bps, 1000);
  END IF;

  IF v_b2b_commission_rate_bps < 0 OR v_b2b_commission_rate_bps > 10000 THEN
    v_b2b_commission_rate_bps := 1000;
  END IF;

  -- 3. Calculate Supplier Base Amount
  -- FIRST: Check if verified tariff bands exist for this service.
  -- SECURITY AUDIT: ots.operator_id MUST MATCH v_facility.operator_id (no cross-operator source hijacking)
  SELECT tb.id, tb.source_id, tb.name, tb.price_amount, tb.pricing_unit,
         tb.min_duration_hours, tb.max_duration_hours
  INTO v_band
  FROM public.service_tariff_bands tb
  JOIN public.operator_tariff_sources ots ON ots.id = tb.source_id
  WHERE tb.service_id = v_service.id
    AND tb.active = true
    AND ots.operator_id = v_facility.operator_id
    AND (tb.vehicle_category IS NULL OR tb.vehicle_category = p_vehicle_category)
    AND (tb.valid_from IS NULL OR tb.valid_from <= p_entry_at)
    AND (tb.valid_until IS NULL OR tb.valid_until >= p_exit_at)
    AND ots.verification_status = 'verified'
    AND (ots.valid_from IS NULL OR ots.valid_from <= p_entry_at)
    AND (ots.valid_until IS NULL OR ots.valid_until >= p_exit_at)
    AND v_duration_hours >= tb.min_duration_hours
    AND (tb.max_duration_hours IS NULL OR v_duration_hours <= tb.max_duration_hours)
  ORDER BY
    CASE WHEN tb.vehicle_category IS NOT NULL THEN 1 ELSE 2 END,
    tb.min_duration_hours DESC
  LIMIT 1;

  IF FOUND THEN
    v_band_matched := true;
    v_band_source_id := v_band.source_id;

    IF v_band.pricing_unit = 'flat_stay' THEN
      v_units := 1;
      v_supplier_base_amount := v_band.price_amount;
    ELSE
      v_units := ceil(v_duration_hours / 24.0)::integer;
      IF v_units < 1 THEN v_units := 1; END IF;
      v_supplier_base_amount := v_band.price_amount * v_units;
    END IF;

    v_breakdown := v_breakdown || jsonb_build_object(
      'type', 'supplier_tariff_band',
      'label', 'Tarifa base proveedor (' || v_band.name || ')',
      'quantity', v_units,
      'unit_price', v_band.price_amount,
      'total_price', v_supplier_base_amount
    );
  ELSE
    -- Check if service has tariff bands requiring excess stay calculation
    SELECT tb.id, tb.source_id, tb.name, tb.price_amount, tb.pricing_unit,
           tb.min_duration_hours, tb.max_duration_hours
    INTO v_max_band
    FROM public.service_tariff_bands tb
    JOIN public.operator_tariff_sources ots ON ots.id = tb.source_id
    WHERE tb.service_id = v_service.id
      AND tb.active = true
      AND ots.operator_id = v_facility.operator_id
      AND (tb.vehicle_category IS NULL OR tb.vehicle_category = p_vehicle_category)
      AND ots.verification_status = 'verified'
      AND (ots.valid_from IS NULL OR ots.valid_from <= p_entry_at)
      AND (ots.valid_until IS NULL OR ots.valid_until >= p_exit_at)
    ORDER BY tb.max_duration_hours DESC NULLS LAST
    LIMIT 1;

    IF FOUND AND v_duration_hours > v_max_band.max_duration_hours THEN
      v_band_matched := true;
      v_band_source_id := v_max_band.source_id;
      v_supplier_base_amount := v_max_band.price_amount;
      v_units := 1;

      v_breakdown := v_breakdown || jsonb_build_object(
        'type', 'supplier_tariff_band',
        'label', 'Tarifa base proveedor tramo máx (' || v_max_band.name || ')',
        'quantity', 1,
        'unit_price', v_max_band.price_amount,
        'total_price', v_max_band.price_amount
      );

      v_excess_hours := v_duration_hours - v_max_band.max_duration_hours;
      v_excess_days := ceil(v_excess_hours / 24.0)::integer;
      IF v_excess_days < 1 THEN v_excess_days := 1; END IF;
      v_excess_stay_charge := v_excess_days * v_excess_stay_rate_per_day;
      v_supplier_base_amount := v_supplier_base_amount + v_excess_stay_charge;

      v_breakdown := v_breakdown || jsonb_build_object(
        'type', 'excess_stay_charge',
        'label', 'Suplemento exceso de estancia (' || v_excess_days || ' ' || (CASE WHEN v_excess_days = 1 THEN 'día extra' ELSE 'días extras' END) || ')',
        'quantity', v_excess_days,
        'unit_price', v_excess_stay_rate_per_day,
        'total_price', v_excess_stay_charge
      );
    ELSE
      -- Standard daily/hourly pricing: MUST have verified source belonging to facility's operator
      IF v_service.source_id IS NULL THEN
        RAISE EXCEPTION 'NO_VERIFIED_TARIFF_SOURCE: Service % has no verified source', v_service.id
          USING errcode = 'P0003';
      END IF;

      SELECT ots.* INTO v_source
      FROM public.operator_tariff_sources ots
      WHERE ots.id = v_service.source_id
        AND ots.operator_id = v_facility.operator_id
        AND ots.verification_status = 'verified'
        AND (ots.valid_from IS NULL OR ots.valid_from <= p_entry_at)
        AND (ots.valid_until IS NULL OR ots.valid_until >= p_exit_at);

      IF NOT FOUND THEN
        RAISE EXCEPTION 'NO_VERIFIED_TARIFF_SOURCE: Source % is not verified or expired or belongs to another operator', v_service.source_id
          USING errcode = 'P0003';
      END IF;

      v_band_source_id := v_source.id;
      v_adjusted_unit_price := v_service.price_amount;

      -- Check verified dynamic rules belonging to facility's operator
      SELECT r.* INTO v_rule
      FROM public.service_price_rules r
      JOIN public.operator_tariff_sources ots ON ots.id = r.source_id
      WHERE r.service_id = p_service_id
        AND r.active = true
        AND ots.operator_id = v_facility.operator_id
        AND ots.verification_status = 'verified'
        AND (ots.valid_from IS NULL OR ots.valid_from <= p_entry_at)
        AND (ots.valid_until IS NULL OR ots.valid_until >= p_exit_at)
        AND (r.valid_from IS NULL OR r.valid_from <= p_entry_at)
        AND (r.valid_until IS NULL OR r.valid_until >= p_exit_at)
        AND (r.min_duration_hours IS NULL OR v_duration_hours >= r.min_duration_hours)
        AND (r.max_duration_hours IS NULL OR v_duration_hours <= r.max_duration_hours)
        AND (r.vehicle_category IS NULL OR r.vehicle_category = coalesce(p_vehicle_category, 'standard'))
      ORDER BY r.priority DESC, r.created_at ASC
      LIMIT 1;

      IF FOUND THEN
        v_best_rule_matched := true;
        IF v_rule.adjustment_type = 'override' THEN
          v_adjusted_unit_price := v_rule.fixed_amount;
        ELSIF v_rule.adjustment_type = 'fixed_addition' THEN
          v_adjusted_unit_price := v_service.price_amount + v_rule.fixed_amount;
        ELSIF v_rule.adjustment_type = 'percentage_bps' THEN
          v_adjusted_unit_price := round((v_service.price_amount::numeric * (10000 + v_rule.percentage_bps)::numeric) / 10000.0);
        END IF;

        v_applied_rules := v_applied_rules || jsonb_build_object(
          'rule_id', v_rule.id,
          'rule_name', v_rule.name,
          'adjustment_type', v_rule.adjustment_type,
          'original_unit_price', v_service.price_amount,
          'adjusted_unit_price', v_adjusted_unit_price,
          'source_id', v_rule.source_id
        );
      END IF;

      IF v_service.pricing_unit = 'per_stay' THEN
        v_units := 1;
        v_supplier_base_amount := v_adjusted_unit_price;
      ELSIF v_service.pricing_unit = 'per_hour' THEN
        v_units := v_duration_hours;
        IF v_units < 1 THEN v_units := 1; END IF;
        v_supplier_base_amount := v_adjusted_unit_price * v_units;
      ELSE -- 'per_day'
        v_units := ceil(v_duration_hours / 24.0)::integer;
        IF v_units < 1 THEN v_units := 1; END IF;
        v_supplier_base_amount := v_adjusted_unit_price * v_units;
      END IF;

      v_breakdown := v_breakdown || jsonb_build_object(
        'type', 'base_stay',
        'label', 'Tarifa base estancia (' || v_units || ' ' ||
          CASE WHEN v_service.pricing_unit = 'per_day' THEN (CASE WHEN v_units = 1 THEN 'día' ELSE 'días' END)
               WHEN v_service.pricing_unit = 'per_hour' THEN (CASE WHEN v_units = 1 THEN 'hora' ELSE 'horas' END)
               ELSE 'estancia' END || ')',
        'quantity', v_units,
        'unit_price', v_adjusted_unit_price,
        'total_price', v_supplier_base_amount
      );
    END IF;
  END IF;

  -- 4. Commercial Markup Breakdown
  v_breakdown := v_breakdown || jsonb_build_object(
    'type', 'platform_markup',
    'label', 'AeroValet Service & Gestión de Entrega',
    'quantity', 1,
    'unit_price', v_platform_markup_amount,
    'total_price', v_platform_markup_amount
  );

  v_breakdown := v_breakdown || jsonb_build_object(
    'type', 'booking_fee',
    'label', 'Gastos de gestión de reserva y soporte 24/7',
    'quantity', 1,
    'unit_price', v_booking_management_fee_amount,
    'total_price', v_booking_management_fee_amount
  );

  -- 5. Calculate Mandatory Extras First
  FOR v_extra_record IN
    SELECT * FROM public.service_extras
    WHERE facility_id = v_facility.id
      AND (service_id IS NULL OR service_id = v_service.id)
      AND active = true
      AND is_mandatory = true
  LOOP
    IF v_extra_record.currency != v_service.currency THEN
      RAISE EXCEPTION 'EXTRA_CURRENCY_MISMATCH: Extra % currency % does not match service currency %',
        v_extra_record.id, v_extra_record.currency, v_service.currency;
    END IF;

    v_extra_qty := 1;
    IF v_extra_record.pricing_unit = 'per_day' THEN
      v_extra_cost := v_extra_record.price_amount * v_units * v_extra_qty;
    ELSE
      v_extra_cost := v_extra_record.price_amount * v_extra_qty;
    END IF;
    v_extras_amount := v_extras_amount + v_extra_cost;

    v_selected_extras_result := v_selected_extras_result || jsonb_build_object(
      'extra_id', v_extra_record.id,
      'name', v_extra_record.name,
      'unit_price', v_extra_record.price_amount,
      'pricing_unit', v_extra_record.pricing_unit,
      'quantity', v_extra_qty,
      'total_amount', v_extra_cost,
      'is_mandatory', true
    );

    v_breakdown := v_breakdown || jsonb_build_object(
      'type', 'extra',
      'label', v_extra_record.name || ' [Obligatorio]',
      'quantity', v_extra_qty,
      'unit_price', v_extra_record.price_amount,
      'total_price', v_extra_cost
    );
  END LOOP;

  -- 6. Calculate Selected Optional Extras
  IF p_selected_extras IS NOT NULL AND jsonb_array_length(p_selected_extras) > 0 THEN
    FOR v_extra_item IN SELECT * FROM jsonb_array_elements(p_selected_extras)
    LOOP
      SELECT se.* INTO v_extra_record
      FROM public.service_extras se
      WHERE se.id = (v_extra_item->>'extra_id')::uuid
        AND se.facility_id = v_facility.id
        AND (se.service_id IS NULL OR se.service_id = v_service.id)
        AND se.active = true
        AND se.is_mandatory = false;

      IF FOUND THEN
        IF v_extra_record.currency != v_service.currency THEN
          RAISE EXCEPTION 'EXTRA_CURRENCY_MISMATCH: Extra % currency % does not match service %',
            v_extra_record.id, v_extra_record.currency, v_service.currency;
        END IF;

        v_extra_qty := coalesce((v_extra_item->>'quantity')::integer, 1);
        IF v_extra_qty < 1 THEN
          RAISE EXCEPTION 'INVALID_EXTRA_QUANTITY: Quantity must be >= 1' USING errcode = '22023';
        END IF;
        IF v_extra_record.max_quantity IS NOT NULL AND v_extra_qty > v_extra_record.max_quantity THEN
          v_extra_qty := v_extra_record.max_quantity;
        END IF;

        IF v_extra_record.pricing_unit = 'per_day' THEN
          v_extra_cost := v_extra_record.price_amount * v_units * v_extra_qty;
        ELSE
          v_extra_cost := v_extra_record.price_amount * v_extra_qty;
        END IF;

        v_extras_amount := v_extras_amount + v_extra_cost;

        v_selected_extras_result := v_selected_extras_result || jsonb_build_object(
          'extra_id', v_extra_record.id,
          'name', v_extra_record.name,
          'unit_price', v_extra_record.price_amount,
          'pricing_unit', v_extra_record.pricing_unit,
          'quantity', v_extra_qty,
          'total_amount', v_extra_cost,
          'is_mandatory', false
        );

        v_breakdown := v_breakdown || jsonb_build_object(
          'type', 'extra',
          'label', v_extra_record.name,
          'quantity', v_extra_qty,
          'unit_price', v_extra_record.price_amount,
          'total_price', v_extra_cost
        );
      ELSE
        RAISE EXCEPTION 'EXTRA_NOT_AVAILABLE: %', (v_extra_item->>'extra_id')
          USING errcode = '22023';
      END IF;
    END LOOP;
  END IF;

  -- 7. Total Customer Amount
  v_customer_total_amount := v_supplier_base_amount + v_platform_markup_amount + v_booking_management_fee_amount + v_extras_amount - v_discount_amount + v_tax_amount;

  -- 8. Authoritative B2B Commission & Operator Payout
  v_b2b_commission_amount := round((v_supplier_base_amount::numeric * v_b2b_commission_rate_bps::numeric) / 10000.0);
  v_operator_payout_amount := v_supplier_base_amount - v_b2b_commission_amount;

  -- 9. Fetch source details for audit trail
  SELECT * INTO v_source
  FROM public.operator_tariff_sources
  WHERE id = v_band_source_id;

  -- 10. Return Structured Canonical V3 Quote
  RETURN jsonb_build_object(
    'calculation_version', 3,
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
    'tariff_source', CASE WHEN v_source.id IS NOT NULL THEN jsonb_build_object(
      'source_id', v_source.id,
      'source_name', v_source.source_name,
      'source_type', v_source.source_type,
      'source_url', v_source.source_url,
      'retrieved_at', v_source.retrieved_at,
      'verification_status', v_source.verification_status,
      'content_hash', v_source.content_hash
    ) ELSE null END,
    'applied_rules', v_applied_rules,
    'selected_extras', v_selected_extras_result,
    'breakdown', v_breakdown
  );
END;
$$;

REVOKE ALL ON FUNCTION public.calculate_service_quote(uuid, timestamptz, timestamptz, text, jsonb, integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.calculate_service_quote(uuid, timestamptz, timestamptz, text, jsonb, integer, uuid) TO anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- PART 4: Commercial Inquiries RLS & Live Permissions (Strict Privacy)
-- ═══════════════════════════════════════════════════════════════════════════════

-- Strictly forbid anon and authenticated from reading commercial_inquiries (PII protection).
-- Only service_role may read inquiries; clients create inquiries via INSERT or secure server RPC.
DROP POLICY IF EXISTS "Allow select commercial inquiry by idempotency key" ON public.commercial_inquiries;
REVOKE SELECT ON TABLE public.commercial_inquiries FROM anon, authenticated;
GRANT INSERT ON TABLE public.commercial_inquiries TO anon, authenticated;
GRANT SELECT ON TABLE public.commercial_inquiries TO service_role;
