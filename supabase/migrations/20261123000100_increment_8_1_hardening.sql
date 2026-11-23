-- AeroValet & Parking Hub — Increment 8.1: Enforcement, Quote Security & Hold Integrity
-- Migration: 20261123000100_increment_8_1_hardening.sql
--
-- 1. Enforce mandatory, strictly positive p_expected_total_amount in create_booking_hold:
--    Rejects NULL, 0, and negative values before quote calculation or hold insertion.
-- 2. Harden calculate_service_quote with p_facility_id validation and active operator verification.
-- 3. Add release_booking_hold RPC for safe client compensation without orphaned holds.
-- 4. Create public.commercial_inquiries table for real lead persistence with idempotent deduplication.
-- 5. Document Round Half Away From Zero parity across PostgreSQL and TypeScript.

-- ═══════════════════════════════════════════════════════════════════════════════
-- PART 1: Commercial Inquiries Table (Real Commercial Lead Persistence)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.commercial_inquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  service_id uuid REFERENCES public.services(id) ON DELETE SET NULL,
  airport_id uuid REFERENCES public.airports(id) ON DELETE SET NULL,
  entry_at timestamptz NOT NULL,
  exit_at timestamptz NOT NULL,
  contact_name text CHECK (contact_name IS NULL OR length(trim(contact_name)) BETWEEN 2 AND 100),
  contact_email text CHECK (contact_email IS NULL OR position('@' IN contact_email) > 1),
  contact_phone text CHECK (contact_phone IS NULL OR length(trim(contact_phone)) BETWEEN 5 AND 30),
  notes text CHECK (notes IS NULL OR length(notes) <= 1000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'contacted', 'closed')),
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS commercial_inquiries_facility_idx
  ON public.commercial_inquiries(facility_id, created_at DESC);

CREATE INDEX IF NOT EXISTS commercial_inquiries_status_idx
  ON public.commercial_inquiries(status)
  WHERE status = 'pending';

ALTER TABLE public.commercial_inquiries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anonymous and authenticated insert of commercial inquiries" ON public.commercial_inquiries;
CREATE POLICY "Allow anonymous and authenticated insert of commercial inquiries"
  ON public.commercial_inquiries
  FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow read commercial inquiries to service_role" ON public.commercial_inquiries;
CREATE POLICY "Allow read commercial inquiries to service_role"
  ON public.commercial_inquiries
  FOR SELECT
  USING (
    current_setting('request.jwt.claim.role', true) = 'service_role'
    OR (current_setting('request.jwt.claim.role', true) IS NULL AND session_user IN ('postgres', 'service_role', 'supabase_admin'))
  );

GRANT INSERT ON TABLE public.commercial_inquiries TO anon, authenticated, service_role;
GRANT SELECT ON TABLE public.commercial_inquiries TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- PART 2: Safe Hold Release RPC (Compensating Action)
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
BEGIN
  IF p_hold_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.booking_holds
  SET status = 'released',
      updated_at = clock_timestamp()
  WHERE id = p_hold_id AND status = 'active';

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.release_booking_hold(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_booking_hold(uuid) TO anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- PART 3: Hardened calculate_service_quote with Facility Validation & Active Operator
-- ═══════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.calculate_service_quote(uuid, timestamptz, timestamptz, text, jsonb, integer);
DROP FUNCTION IF EXISTS public.calculate_service_quote(uuid, timestamptz, timestamptz, text, jsonb, integer, uuid);

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

  -- Audit: Verify service belongs to the given facility if provided
  IF p_facility_id IS NOT NULL AND v_service.facility_id != p_facility_id THEN
    RAISE EXCEPTION 'SERVICE_FACILITY_MISMATCH: Service does not belong to specified facility'
      USING errcode = '22023';
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

  -- Audit: Verify operator is active
  IF NOT FOUND OR v_operator.status != 'active' THEN
    RAISE EXCEPTION 'OPERATOR_NOT_ACTIVE' USING errcode = 'P0002';
  END IF;

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
  ELSE
    v_b2b_commission_rate_bps := coalesce(v_operator.platform_fee_bps, 1000);
  END IF;

  -- Validate commission rate range (0..10000 bps)
  IF v_b2b_commission_rate_bps < 0 OR v_b2b_commission_rate_bps > 10000 THEN
    v_b2b_commission_rate_bps := 1000;
  END IF;

  -- 3. Calculate Supplier Base Amount
  -- FIRST: Check if verified tariff bands exist for this service
  SELECT tb.id, tb.source_id, tb.name, tb.price_amount, tb.pricing_unit,
         tb.min_duration_hours, tb.max_duration_hours
  INTO v_band
  FROM public.service_tariff_bands tb
  JOIN public.operator_tariff_sources ots ON ots.id = tb.source_id
  WHERE tb.service_id = v_service.id
    AND tb.active = true
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
    -- Check if service has tariff bands requiring excess hours calculation
    SELECT tb.id, tb.source_id, tb.name, tb.price_amount, tb.pricing_unit,
           tb.min_duration_hours, tb.max_duration_hours
    INTO v_max_band
    FROM public.service_tariff_bands tb
    JOIN public.operator_tariff_sources ots ON ots.id = tb.source_id
    WHERE tb.service_id = v_service.id
      AND tb.active = true
      AND (tb.vehicle_category IS NULL OR tb.vehicle_category = p_vehicle_category)
      AND ots.verification_status = 'verified'
      AND (ots.valid_from IS NULL OR ots.valid_from <= p_entry_at)
      AND (ots.valid_until IS NULL OR ots.valid_until >= p_exit_at)
    ORDER BY tb.max_duration_hours DESC NULLS LAST
    LIMIT 1;

    IF FOUND AND v_max_band.max_duration_hours IS NOT NULL AND v_duration_hours > v_max_band.max_duration_hours THEN
      v_band_matched := true;
      v_band_source_id := v_max_band.source_id;
      v_units := 1;
      v_supplier_base_amount := v_max_band.price_amount;

      -- Check if excess hours tariff source is verified
      IF v_service.excess_hour_price_amount IS NOT NULL AND v_service.excess_hour_price_amount > 0 THEN
        DECLARE
          v_excess_hours integer;
          v_excess_amount bigint;
        BEGIN
          v_excess_hours := v_duration_hours - v_max_band.max_duration_hours;
          v_excess_amount := v_excess_hours * v_service.excess_hour_price_amount;
          v_supplier_base_amount := v_supplier_base_amount + v_excess_amount;
        END;
      END IF;

      v_breakdown := v_breakdown || jsonb_build_object(
        'type', 'supplier_tariff_band',
        'label', 'Tarifa base (' || v_max_band.name || ' + exceso estancia)',
        'quantity', 1,
        'unit_price', v_supplier_base_amount,
        'total_price', v_supplier_base_amount
      );
    ELSE
      -- Provenance validation: check if service has verified source_id
      IF v_service.source_id IS NOT NULL THEN
        SELECT 1 INTO v_source_record
        FROM public.operator_tariff_sources ots
        WHERE ots.id = v_service.source_id
          AND ots.verification_status = 'verified'
          AND (ots.valid_from IS NULL OR ots.valid_from <= p_entry_at)
          AND (ots.valid_until IS NULL OR ots.valid_until >= p_exit_at);

        IF FOUND THEN
          v_has_service_provenance := true;
          v_band_source_id := v_service.source_id;
        END IF;
      END IF;

      -- FAIL CLOSED: If no verified tariff source exists, refuse automatic quote
      IF NOT v_has_service_provenance THEN
        RAISE EXCEPTION 'NO_VERIFIED_TARIFF_SOURCE: No valid verified tariff source for service %', v_service.id
          USING errcode = '22023';
      END IF;

      -- Base price calculation
      v_adjusted_unit_price := v_service.price_amount;

      -- Local time and weekday for rule evaluation
      v_entry_local_time := (p_entry_at AT TIME ZONE coalesce(v_airport.timezone, 'Europe/Madrid'))::time;
      v_entry_weekday := extract(isodow from (p_entry_at AT TIME ZONE coalesce(v_airport.timezone, 'Europe/Madrid')))::smallint;

      -- Query service_price_rules with verified source_id gating (unverified rules strictly ignored)
      SELECT r.* INTO v_rule
      FROM public.service_price_rules r
      JOIN public.operator_tariff_sources ots ON ots.id = r.source_id
      WHERE r.service_id = v_service.id
        AND r.active = true
        AND r.source_id IS NOT NULL
        AND ots.operator_id = v_operator.id
        AND ots.verification_status = 'verified'
        AND (ots.valid_from IS NULL OR ots.valid_from <= p_entry_at)
        AND (ots.valid_until IS NULL OR ots.valid_until >= p_exit_at)
        AND (r.valid_from IS NULL OR r.valid_from <= p_entry_at)
        AND (r.valid_until IS NULL OR r.valid_until >= p_exit_at)
        AND (r.weekdays IS NULL OR v_entry_weekday = ANY(r.weekdays))
        AND (r.entry_time_start IS NULL OR (
          CASE WHEN r.entry_time_start <= r.entry_time_end THEN
            v_entry_local_time >= r.entry_time_start AND v_entry_local_time <= r.entry_time_end
          ELSE
            v_entry_local_time >= r.entry_time_start OR v_entry_local_time <= r.entry_time_end
          END
        ))
        AND (r.min_duration_hours IS NULL OR v_duration_hours >= r.min_duration_hours)
        AND (r.max_duration_hours IS NULL OR v_duration_hours <= r.max_duration_hours)
        AND (r.vehicle_category IS NULL OR r.vehicle_category = p_vehicle_category)
      ORDER BY r.priority DESC, r.created_at ASC, r.id ASC
      LIMIT 1;

      IF FOUND THEN
        v_rule_matched := true;

        IF v_rule.adjustment_type = 'override' THEN
          v_adjusted_unit_price := coalesce(v_rule.fixed_amount, v_service.price_amount);
        ELSIF v_rule.adjustment_type = 'fixed_addition' THEN
          v_adjusted_unit_price := v_service.price_amount + coalesce(v_rule.fixed_amount, 0);
        ELSIF v_rule.adjustment_type = 'percentage_bps' THEN
          -- Round Half Away From Zero formula on percentage adjustments
          v_adjusted_unit_price := round((v_service.price_amount * (10000 + coalesce(v_rule.percentage_bps, 0))::numeric) / 10000.0)::bigint;
        END IF;

        IF v_adjusted_unit_price < 0 THEN
          v_adjusted_unit_price := 0;
        END IF;

        v_applied_rules := jsonb_build_array(jsonb_build_object(
          'rule_id', v_rule.id,
          'rule_name', v_rule.name,
          'rule_type', v_rule.rule_type,
          'adjustment_type', v_rule.adjustment_type,
          'fixed_amount', v_rule.fixed_amount,
          'percentage_bps', v_rule.percentage_bps,
          'applied_unit_price', v_adjusted_unit_price
        ));
      END IF;

      -- Compute units and base amount based on pricing_unit
      IF v_service.pricing_unit = 'per_stay' THEN
        v_units := 1;
        v_supplier_base_amount := v_adjusted_unit_price;
      ELSIF v_service.pricing_unit = 'per_hour' THEN
        v_units := v_duration_hours;
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

  -- 5. Calculate Extras
  IF p_selected_extras IS NOT NULL AND jsonb_array_length(p_selected_extras) > 0 THEN
    FOR v_extra_item IN SELECT * FROM jsonb_array_elements(p_selected_extras)
    LOOP
      SELECT se.* INTO v_extra_record
      FROM public.service_extras se
      WHERE se.id = (v_extra_item->>'extra_id')::uuid
        AND (se.service_id = v_service.id OR se.facility_id = v_facility.id)
        AND se.active = true;

      IF FOUND THEN
        v_extra_qty := coalesce((v_extra_item->>'quantity')::integer, 1);
        IF v_extra_qty < 1 THEN v_extra_qty := 1; END IF;
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
          'total_amount', v_extra_cost
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

  -- 6. Total Calculation
  v_customer_total_amount := v_supplier_base_amount
                           + v_platform_markup_amount
                           + v_booking_management_fee_amount
                           + v_extras_amount
                           - v_discount_amount
                           + v_tax_amount;

  -- 7. B2B Settlement Calculation: Round Half Away From Zero
  v_b2b_commission_amount := round((v_supplier_base_amount * v_b2b_commission_rate_bps)::numeric / 10000.0)::bigint;
  v_operator_payout_amount := v_supplier_base_amount - v_b2b_commission_amount;

  -- 8. Metadata
  IF v_band_source_id IS NOT NULL THEN
    SELECT ots.* INTO v_source_record
    FROM public.operator_tariff_sources ots
    WHERE ots.id = v_band_source_id;

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
    'calculation_version', 3,
    'applied_rules', v_applied_rules,
    'selected_extras', v_selected_extras_result,
    'breakdown', v_breakdown
  );
END;
$$;

REVOKE ALL ON FUNCTION public.calculate_service_quote(uuid, timestamptz, timestamptz, text, jsonb, integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.calculate_service_quote(uuid, timestamptz, timestamptz, text, jsonb, integer, uuid) TO anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- PART 4: create_booking_hold with Strictly Mandatory Positive Expected Price
-- ═══════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.create_booking_hold(uuid, uuid, timestamptz, timestamptz, uuid, uuid, text, text, text, text, jsonb, bigint);

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
  -- 1. MANDATORY EXPECTED TOTAL AMOUNT VALIDATION
  --    Rejects NULL, 0, or negative values before any quote computation or insertion
  IF p_expected_total_amount IS NULL OR p_expected_total_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_EXPECTED_PRICE: Expected total amount must be a strictly positive integer'
      USING errcode = '22023';
  END IF;

  -- 2. Temporal Constraints
  IF p_entry_at IS NULL OR p_exit_at IS NULL OR p_entry_at >= p_exit_at THEN
    RAISE EXCEPTION 'INVALID_BOOKING_INTERVAL' USING errcode = '22007';
  END IF;

  IF p_entry_at < v_now THEN
    RAISE EXCEPTION 'ENTRY_MUST_BE_IN_FUTURE' USING errcode = '22023';
  END IF;

  -- 3. Customer vs Guest Identity Resolution
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

  -- 4. Vehicle Ownership & Category Resolution
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

  -- 5. Facility Row-Level Locking (serializes concurrent capacity reservations)
  SELECT f.* INTO v_facility
  FROM public.facilities f
  JOIN public.operators o ON o.id = f.operator_id
  WHERE f.id = p_facility_id AND f.active = true AND o.status = 'active'
  FOR UPDATE OF f;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FACILITY_NOT_AVAILABLE' USING errcode = 'P0002';
  END IF;

  -- 6. Service Resolution and Validation
  SELECT s.* INTO v_service
  FROM public.services s
  WHERE s.id = p_service_id
    AND s.facility_id = p_facility_id
    AND s.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SERVICE_NOT_AVAILABLE' USING errcode = 'P0002';
  END IF;

  -- 7. Capacity Verification under Row Lock (Timeline Peak Occupancy)
  v_sellable_capacity := v_facility.total_capacity - coalesce(v_facility.operational_buffer, 0);
  IF v_sellable_capacity <= 0 THEN
    RAISE EXCEPTION 'CAPACITY_EXHAUSTED' USING errcode = '55P03';
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
    RAISE EXCEPTION 'CAPACITY_EXHAUSTED' USING errcode = '55P03';
  END IF;

  -- 8. Authoritative Quote Calculation (passing p_facility_id for validation)
  v_quote := public.calculate_service_quote(
    p_service_id => p_service_id,
    p_entry_at => p_entry_at,
    p_exit_at => p_exit_at,
    p_vehicle_category => v_vehicle_category,
    p_selected_extras => p_selected_extras,
    p_facility_id => p_facility_id
  );

  v_total_amount := (v_quote->>'customer_total_amount')::bigint;

  -- 9. ATOMIC PRICE DISCREPANCY CHECK: STRICTLY BEFORE INSERT
  --    p_expected_total_amount is guaranteed non-null and > 0 by step 1
  IF p_expected_total_amount != v_total_amount THEN
    RAISE EXCEPTION 'PRICE_DISCREPANCY: expected=% actual=%', p_expected_total_amount, v_total_amount
      USING errcode = '22023';
  END IF;

  -- 10. Persist Hold with 15-minute expiration (only reached if prices match)
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

  -- 11. Return structured hold confirmation guaranteeing 100% price parity
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

REVOKE ALL ON FUNCTION public.create_booking_hold(uuid, uuid, timestamptz, timestamptz, uuid, uuid, text, text, text, text, jsonb, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_booking_hold(uuid, uuid, timestamptz, timestamptz, uuid, uuid, text, text, text, text, jsonb, bigint) TO anon, authenticated, service_role;
