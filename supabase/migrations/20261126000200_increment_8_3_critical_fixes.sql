-- AeroValet & Parking Hub — Increment 8.3: Critical Security, Market Data Integrity & Ingestion Correction
-- Incremental migration applied on top of 20261126000100_market_data_integrity_and_security.sql

-- ═══════════════════════════════════════════════════════════════════════════════
-- PART 1: Commercial Inquiries Strict Privacy & Safe Server RPC
-- ═══════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Allow select commercial inquiry by idempotency key" ON public.commercial_inquiries;
REVOKE SELECT ON TABLE public.commercial_inquiries FROM anon, authenticated;
GRANT INSERT ON TABLE public.commercial_inquiries TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.commercial_inquiries TO service_role;

-- Safe server-side RPC to create/idempotently upsert a commercial inquiry
-- and return EXCLUSIVELY the inquiry UUID without exposing any PII.
CREATE OR REPLACE FUNCTION public.submit_commercial_inquiry(
  p_facility_id uuid,
  p_entry_at timestamptz,
  p_exit_at timestamptz,
  p_idempotency_key text,
  p_service_id uuid DEFAULT NULL,
  p_airport_id uuid DEFAULT NULL,
  p_contact_name text DEFAULT NULL,
  p_contact_email text DEFAULT NULL,
  p_contact_phone text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inquiry_id uuid;
BEGIN
  IF p_facility_id IS NULL THEN
    RAISE EXCEPTION 'FACILITY_ID_REQUIRED' USING errcode = '22023';
  END IF;

  IF p_entry_at IS NULL OR p_exit_at IS NULL OR p_entry_at >= p_exit_at THEN
    RAISE EXCEPTION 'INVALID_INQUIRY_INTERVAL' USING errcode = '22007';
  END IF;

  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) < 16 THEN
    RAISE EXCEPTION 'INVALID_IDEMPOTENCY_KEY' USING errcode = '22023';
  END IF;

  INSERT INTO public.commercial_inquiries (
    facility_id,
    service_id,
    airport_id,
    entry_at,
    exit_at,
    contact_name,
    contact_email,
    contact_phone,
    notes,
    idempotency_key
  ) VALUES (
    p_facility_id,
    p_service_id,
    p_airport_id,
    p_entry_at,
    p_exit_at,
    nullif(trim(p_contact_name), ''),
    nullif(trim(p_contact_email), ''),
    nullif(trim(p_contact_phone), ''),
    nullif(trim(p_notes), ''),
    trim(p_idempotency_key)
  )
  ON CONFLICT (idempotency_key) DO UPDATE
    SET idempotency_key = EXCLUDED.idempotency_key
  RETURNING id INTO v_inquiry_id;

  RETURN v_inquiry_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_commercial_inquiry(uuid, timestamptz, timestamptz, text, uuid, uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_commercial_inquiry(uuid, timestamptz, timestamptz, text, uuid, uuid, text, text, text, text) TO anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- PART 2: Structured Modality & Verified Feature Columns on Facilities
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.facilities
  ADD COLUMN IF NOT EXISTS modality text CHECK (modality IS NULL OR modality IN ('valet', 'shuttle'));

-- ═══════════════════════════════════════════════════════════════════════════════
-- PART 3: Hardened calculate_service_quote (Mandatory Band Review Status + No Fallback Price)
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
  v_best_rule_matched boolean := false;
  v_adjusted_unit_price bigint;
  v_extra_qty integer;
  v_extra_cost bigint;

  -- Output JSON structures
  v_applied_rules jsonb := '[]'::jsonb;
  v_selected_extras_result jsonb := '[]'::jsonb;
  v_breakdown jsonb := '[]'::jsonb;
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
  -- SECURITY AUDIT: Both tb.review_status = 'verified' AND ots.verification_status = 'verified' are mandatory.
  -- Also ots.operator_id MUST MATCH v_facility.operator_id.
  SELECT tb.id, tb.source_id, tb.name, tb.price_amount, tb.pricing_unit,
         tb.min_duration_hours, tb.max_duration_hours
  INTO v_band
  FROM public.service_tariff_bands tb
  JOIN public.operator_tariff_sources ots ON ots.id = tb.source_id
  WHERE tb.service_id = v_service.id
    AND tb.active = true
    AND tb.review_status = 'verified'
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
    -- Check if service has verified tariff bands where duration exceeds max_duration_hours
    SELECT tb.id, tb.source_id, tb.name, tb.price_amount, tb.pricing_unit,
           tb.min_duration_hours, tb.max_duration_hours
    INTO v_max_band
    FROM public.service_tariff_bands tb
    JOIN public.operator_tariff_sources ots ON ots.id = tb.source_id
    WHERE tb.service_id = v_service.id
      AND tb.active = true
      AND tb.review_status = 'verified'
      AND ots.operator_id = v_facility.operator_id
      AND (tb.vehicle_category IS NULL OR tb.vehicle_category = p_vehicle_category)
      AND (tb.valid_from IS NULL OR tb.valid_from <= p_entry_at)
      AND (tb.valid_until IS NULL OR tb.valid_until >= p_exit_at)
      AND ots.verification_status = 'verified'
      AND (ots.valid_from IS NULL OR ots.valid_from <= p_entry_at)
      AND (ots.valid_until IS NULL OR ots.valid_until >= p_exit_at)
    ORDER BY tb.max_duration_hours DESC NULLS LAST
    LIMIT 1;

    IF FOUND AND v_max_band.max_duration_hours IS NOT NULL AND v_duration_hours > v_max_band.max_duration_hours THEN
      -- Excess stay ONLY allowed if the service itself has a verified daily tariff source (no 2000c fallback!)
      IF v_service.source_id IS NULL OR v_service.pricing_unit != 'per_day' OR v_service.price_amount <= 0 THEN
        RAISE EXCEPTION 'NO_VERIFIED_TARIFF_SOURCE: Duration exceeds verified band % and service % has no verified daily excess rate', v_max_band.id, v_service.id
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
        RAISE EXCEPTION 'NO_VERIFIED_TARIFF_SOURCE: Excess stay source % is not verified', v_service.source_id
          USING errcode = 'P0003';
      END IF;

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
      v_excess_stay_charge := v_excess_days * v_service.price_amount;
      v_supplier_base_amount := v_supplier_base_amount + v_excess_stay_charge;

      v_breakdown := v_breakdown || jsonb_build_object(
        'type', 'excess_stay_charge',
        'label', 'Suplemento exceso de estancia (' || v_excess_days || ' ' || (CASE WHEN v_excess_days = 1 THEN 'día extra' ELSE 'días extras' END) || ')',
        'quantity', v_excess_days,
        'unit_price', v_service.price_amount,
        'total_price', v_excess_stay_charge
      );
    ELSE
      -- If service has any tariff bands defined (e.g. unverified/pending/stale) and none matched,
      -- check whether standard service pricing has its own verified source_id.
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
      ORDER BY r.priority DESC, r.created_at ASC, r.id ASC
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
-- PART 4: Market Candidates Architecture (Separation from Approved Operators)
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'candidate_onboarding_stage') THEN
    CREATE TYPE public.candidate_onboarding_stage AS ENUM (
      'discovered',
      'onboarding_started',
      'approved_operator'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.market_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain text NOT NULL check (length(trim(domain)) > 0),
  company_name text NOT NULL check (length(trim(company_name)) > 0),
  legal_name text,
  airport_iata char(3) NOT NULL check (airport_iata ~ '^[A-Z]{3}$'),
  modality text NOT NULL check (modality IN ('valet', 'shuttle')),
  source_url text NOT NULL check (source_url ~ '^https?://'),
  address text,
  latitude numeric(9,6),
  longitude numeric(9,6),
  discovery_provider text NOT NULL,
  evidence_snippet text,
  content_hash char(64) check (content_hash is null or content_hash ~ '^[a-f0-9]{64}$'),
  review_status public.tariff_verification_status NOT NULL DEFAULT 'pending_review',
  onboarding_stage public.candidate_onboarding_stage NOT NULL DEFAULT 'discovered',
  review_notes text,
  feature_ev_charging public.feature_verification_status NOT NULL DEFAULT 'unknown',
  feature_car_wash public.feature_verification_status NOT NULL DEFAULT 'unknown',
  feature_covered public.feature_verification_status NOT NULL DEFAULT 'unknown',
  feature_cctv_24h public.feature_verification_status NOT NULL DEFAULT 'unknown',
  feature_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  cancellation_free_window_hours integer,
  cancellation_late_fee_bps integer check (cancellation_late_fee_bps is null or (cancellation_late_fee_bps >= 0 and cancellation_late_fee_bps <= 10000)),
  cancellation_verified boolean NOT NULL DEFAULT false,
  cancellation_evidence text,
  approved_operator_id uuid references public.operators(id) on delete set null,
  discovered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (domain, airport_iata, modality)
);

CREATE INDEX IF NOT EXISTS market_candidates_airport_status_idx
  ON public.market_candidates(airport_iata, review_status, onboarding_stage);

CREATE TABLE IF NOT EXISTS public.market_candidate_tariff_bands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.market_candidates(id) ON DELETE CASCADE,
  name text NOT NULL check (length(trim(name)) > 0),
  min_duration_hours integer NOT NULL check (min_duration_hours >= 0),
  max_duration_hours integer NOT NULL check (max_duration_hours > min_duration_hours),
  price_amount bigint NOT NULL check (price_amount > 0),
  currency char(3) NOT NULL DEFAULT 'EUR' check (currency ~ '^[A-Z]{3}$'),
  pricing_unit public.tariff_band_pricing_unit NOT NULL DEFAULT 'flat_stay',
  evidence_snippet text NOT NULL check (length(trim(evidence_snippet)) > 0),
  review_status public.tariff_verification_status NOT NULL DEFAULT 'pending_review',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (candidate_id, min_duration_hours, max_duration_hours)
);

ALTER TABLE public.market_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_candidate_tariff_bands ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.market_candidates FROM anon, authenticated;
REVOKE ALL ON TABLE public.market_candidate_tariff_bands FROM anon, authenticated;
GRANT ALL ON TABLE public.market_candidates TO service_role;
GRANT ALL ON TABLE public.market_candidate_tariff_bands TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- PART 5: Transactional Market Candidate Ingestion RPC (Atomic SQL Operation)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.ingest_market_candidate(
  p_payload jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_candidate_id uuid;
  v_band jsonb;
  v_domain text;
  v_airport_iata text;
  v_modality text;
  v_review_status public.tariff_verification_status;
BEGIN
  IF current_user NOT IN ('postgres', 'service_role', 'supabase_admin')
     AND coalesce(current_setting('request.jwt.claim.role', true), '') != 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED_INGESTION: Only service_role can ingest market candidates'
      USING errcode = '42501';
  END IF;

  IF p_payload IS NULL THEN
    RAISE EXCEPTION 'PAYLOAD_REQUIRED' USING errcode = '22023';
  END IF;

  v_domain := lower(trim(p_payload->>'domain'));
  v_airport_iata := upper(trim(p_payload->>'airport_iata'));
  v_modality := lower(trim(p_payload->>'modality'));

  IF v_domain IS NULL OR length(v_domain) = 0 THEN
    RAISE EXCEPTION 'DOMAIN_REQUIRED' USING errcode = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.airports WHERE iata_code = v_airport_iata) THEN
    RAISE EXCEPTION 'AIRPORT_NOT_FOUND: %', v_airport_iata USING errcode = '22023';
  END IF;

  v_review_status := coalesce((p_payload->>'review_status')::public.tariff_verification_status, 'pending_review');

  INSERT INTO public.market_candidates (
    domain,
    company_name,
    legal_name,
    airport_iata,
    modality,
    source_url,
    address,
    latitude,
    longitude,
    discovery_provider,
    evidence_snippet,
    content_hash,
    review_status,
    onboarding_stage,
    review_notes,
    feature_ev_charging,
    feature_car_wash,
    feature_covered,
    feature_cctv_24h,
    feature_evidence,
    cancellation_free_window_hours,
    cancellation_late_fee_bps,
    cancellation_verified,
    cancellation_evidence,
    last_reviewed_at,
    updated_at
  ) VALUES (
    v_domain,
    trim(p_payload->>'company_name'),
    nullif(trim(p_payload->>'legal_name'), ''),
    v_airport_iata,
    v_modality,
    trim(p_payload->>'source_url'),
    nullif(trim(p_payload->>'address'), ''),
    (p_payload->>'latitude')::numeric,
    (p_payload->>'longitude')::numeric,
    coalesce(nullif(trim(p_payload->>'discovery_provider'), ''), 'unknown'),
    nullif(trim(p_payload->>'evidence_snippet'), ''),
    nullif(trim(p_payload->>'content_hash'), ''),
    v_review_status,
    'discovered',
    nullif(trim(p_payload->>'review_notes'), ''),
    coalesce((p_payload->>'feature_ev_charging')::public.feature_verification_status, 'unknown'),
    coalesce((p_payload->>'feature_car_wash')::public.feature_verification_status, 'unknown'),
    coalesce((p_payload->>'feature_covered')::public.feature_verification_status, 'unknown'),
    coalesce((p_payload->>'feature_cctv_24h')::public.feature_verification_status, 'unknown'),
    coalesce(p_payload->'feature_evidence', '{}'::jsonb),
    (p_payload->>'cancellation_free_window_hours')::integer,
    (p_payload->>'cancellation_late_fee_bps')::integer,
    coalesce((p_payload->>'cancellation_verified')::boolean, false),
    nullif(trim(p_payload->>'cancellation_evidence'), ''),
    clock_timestamp(),
    clock_timestamp()
  )
  ON CONFLICT (domain, airport_iata, modality) DO UPDATE SET
    company_name = EXCLUDED.company_name,
    legal_name = coalesce(EXCLUDED.legal_name, public.market_candidates.legal_name),
    source_url = EXCLUDED.source_url,
    address = coalesce(EXCLUDED.address, public.market_candidates.address),
    latitude = coalesce(EXCLUDED.latitude, public.market_candidates.latitude),
    longitude = coalesce(EXCLUDED.longitude, public.market_candidates.longitude),
    discovery_provider = EXCLUDED.discovery_provider,
    evidence_snippet = EXCLUDED.evidence_snippet,
    content_hash = EXCLUDED.content_hash,
    review_status = EXCLUDED.review_status,
    review_notes = EXCLUDED.review_notes,
    feature_ev_charging = EXCLUDED.feature_ev_charging,
    feature_car_wash = EXCLUDED.feature_car_wash,
    feature_covered = EXCLUDED.feature_covered,
    feature_cctv_24h = EXCLUDED.feature_cctv_24h,
    feature_evidence = EXCLUDED.feature_evidence,
    cancellation_free_window_hours = EXCLUDED.cancellation_free_window_hours,
    cancellation_late_fee_bps = EXCLUDED.cancellation_late_fee_bps,
    cancellation_verified = EXCLUDED.cancellation_verified,
    cancellation_evidence = EXCLUDED.cancellation_evidence,
    last_reviewed_at = clock_timestamp(),
    updated_at = clock_timestamp()
  RETURNING id INTO v_candidate_id;

  -- Replace candidate tariff bands transactionally
  DELETE FROM public.market_candidate_tariff_bands
  WHERE candidate_id = v_candidate_id;

  IF p_payload->'tariff_bands' IS NOT NULL AND jsonb_typeof(p_payload->'tariff_bands') = 'array' THEN
    FOR v_band IN SELECT * FROM jsonb_array_elements(p_payload->'tariff_bands')
    LOOP
      INSERT INTO public.market_candidate_tariff_bands (
        candidate_id,
        name,
        min_duration_hours,
        max_duration_hours,
        price_amount,
        currency,
        pricing_unit,
        evidence_snippet,
        review_status
      ) VALUES (
        v_candidate_id,
        trim(v_band->>'name'),
        (v_band->>'min_duration_hours')::integer,
        (v_band->>'max_duration_hours')::integer,
        (v_band->>'price_amount')::bigint,
        coalesce(nullif(trim(v_band->>'currency'), ''), 'EUR'),
        coalesce((v_band->>'pricing_unit')::public.tariff_band_pricing_unit, 'flat_stay'),
        trim(v_band->>'evidence_snippet'),
        coalesce((v_band->>'review_status')::public.tariff_verification_status, v_review_status)
      );
    END LOOP;
  END IF;

  RETURN v_candidate_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ingest_market_candidate(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ingest_market_candidate(jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_market_candidate(jsonb) TO service_role;
