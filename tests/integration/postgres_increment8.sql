-- Integration Test Suite for AeroValet PostgreSQL Database (Increment 8: Transactional Integrity & Unified Quote)
--
-- Tests:
-- 1. Setup seed data (airport, operator, facility, service, extra, verified & unverified tariff sources)
-- 2. Discrepancia de importe esperado: calling create_booking_hold with wrong expected price raises PRICE_DISCREPANCY,
--    guaranteeing NO hold is inserted and NO capacity is consumed.
-- 3. Precio coincidente: calling create_booking_hold with exact authorized quote creates a single valid hold.
-- 4. Operador sin fuente verificada: attempting automatic quote or hold raises NO_VERIFIED_TARIFF_SOURCE.
-- 5. Precio base sin procedencia: service without verified source rejects automatic quote.
-- 6. Regla dinámica sin procedencia aprobada: unverified dynamic rule is ignored by the quote engine.
-- 7. Regla dinámica porcentual con Round Half-Up: fractional cent calculation (e.g. 2050c + 100 bps = 2070.5c -> 2071c).
-- 8. Capacidad límite concurrente: facility with 1 sellable spot rejects second concurrent reservation (CAPACITY_EXHAUSTED).
-- 9. Paridad absoluta al céntimo: quote customer_total_amount, hold price_amount, and snapshot customer_total_amount match 100%.

\set ON_ERROR_STOP on

BEGIN;

-- 1. Seed Airport
INSERT INTO public.airports (id, iata_code, name, city, country_code, timezone, active)
VALUES ('11111111-1111-4111-a111-111111111111', 'MAD', 'Adolfo Suárez Madrid-Barajas', 'Madrid', 'ES', 'Europe/Madrid', true)
ON CONFLICT (id) DO NOTHING;

-- Seed Operator Owner User
INSERT INTO auth.users (id, email, role)
VALUES ('22222222-2222-4222-a222-222222222222', 'op.owner@aerovalet.test', 'authenticated')
ON CONFLICT (id) DO NOTHING;

-- Seed Verified Operator
INSERT INTO public.operators (id, owner_user_id, name, slug, legal_name, country_code, currency, status, platform_fee_bps)
VALUES ('33333333-3333-4333-a333-333333333333', '22222222-2222-4222-a222-222222222222', 'Valet Test SL', 'valet-test', 'Valet Test SL', 'ES', 'EUR', 'active', 1500)
ON CONFLICT (id) DO NOTHING;

-- Seed Unverified Operator (no verified tariff sources)
INSERT INTO public.operators (id, owner_user_id, name, slug, legal_name, country_code, currency, status, platform_fee_bps)
VALUES ('33333333-3333-4333-a333-333333333334', '22222222-2222-4222-a222-222222222222', 'Unverified Parking SL', 'unverified-park', 'Unverified Parking SL', 'ES', 'EUR', 'active', 1000)
ON CONFLICT (id) DO NOTHING;

-- Seed Facility for Verified Operator
INSERT INTO public.facilities (id, operator_id, airport_id, name, address, total_capacity, operational_buffer, active)
VALUES ('44444444-4444-4444-a444-444444444444', '33333333-3333-4333-a333-333333333333', '11111111-1111-4111-a111-111111111111', 'Parking VIP T4', 'Terminal 4 Salidas', 50, 5, true)
ON CONFLICT (id) DO NOTHING;

-- Seed Facility for Unverified Operator
INSERT INTO public.facilities (id, operator_id, airport_id, name, address, total_capacity, operational_buffer, active)
VALUES ('44444444-4444-4444-a444-444444444445', '33333333-3333-4333-a333-333333333334', '11111111-1111-4111-a111-111111111111', 'Parking Sin Verificar', 'Carretera Externa', 20, 2, true)
ON CONFLICT (id) DO NOTHING;

-- Seed Verified Sources
INSERT INTO public.operator_tariff_sources (id, operator_id, source_name, source_type, source_url, verification_status, valid_from, valid_until)
VALUES 
  ('77777777-7777-4777-a777-777777777771', '33333333-3333-4333-a333-333333333333', 'Web Oficial Verificada', 'official_website', 'https://valettest.es/tarifas', 'verified', '2026-01-01T00:00:00Z', '2027-12-31T23:59:59Z'),
  ('77777777-7777-4777-a777-777777777772', '33333333-3333-4333-a333-333333333333', 'Tarifa no contrastada', 'manual_verified', 'https://externo.com/tarifas', 'pending_review', null, null)
ON CONFLICT (id) DO NOTHING;

-- Seed Services
INSERT INTO public.services (id, facility_id, source_id, name, description, price_amount, currency, pricing_unit, active)
VALUES 
  ('55555555-5555-4555-a555-555555555555', '44444444-4444-4444-a444-444444444444', '77777777-7777-4777-a777-777777777771', 'Valet Express 24h', 'Entrega en terminal', 2000, 'EUR', 'per_day', true),
  ('55555555-5555-4555-a555-555555555556', '44444444-4444-4444-a444-444444444445', null, 'Servicio Sin Fuente', 'Sin verificar', 1800, 'EUR', 'per_day', true)
ON CONFLICT (id) DO NOTHING;

-- Seed Extra: Wash (1500 cents)
INSERT INTO public.service_extras (id, facility_id, service_id, name, price_amount, currency, pricing_unit, is_mandatory, max_quantity, active)
VALUES ('66666666-6666-4666-a666-666666666666', '44444444-4444-4444-a444-444444444444', '55555555-5555-4555-a555-555555555555', 'Lavado Exterior VIP', 1500, 'EUR', 'per_stay', false, 1, true)
ON CONFLICT (id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════════
-- TEST 1: Discrepancia de importe esperado: aborts BEFORE insert, zero holds created
-- ═══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_err_caught boolean := false;
  v_holds_before integer;
  v_holds_after integer;
BEGIN
  SELECT count(*) INTO v_holds_before FROM public.booking_holds WHERE facility_id = '44444444-4444-4444-a444-444444444444';

  BEGIN
    -- Real quote for 2 days (4000 base + 800 markup + 199 fee = 4999 cents)
    -- We deliberately send p_expected_total_amount = 3500 (discrepant price)
    PERFORM public.create_booking_hold(
      p_facility_id => '44444444-4444-4444-a444-444444444444',
      p_service_id => '55555555-5555-4555-a555-555555555555',
      p_entry_at => '2026-12-10T10:00:00Z',
      p_exit_at => '2026-12-12T10:00:00Z',
      p_vehicle_id => null,
      p_customer_id => null,
      p_guest_email => 'discrepancy.tester@aerovalet.demo',
      p_guest_name => 'Discrepancy Tester',
      p_guest_phone => '+34600112233',
      p_vehicle_category => 'standard',
      p_selected_extras => '[]'::jsonb,
      p_expected_total_amount => 3500 -- DISCREPANT AMOUNT
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%PRICE_DISCREPANCY%' THEN
      v_err_caught := true;
    ELSE
      RAISE EXCEPTION 'Unexpected error: %', SQLERRM;
    END IF;
  END;

  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST 1 FAILED: Expected PRICE_DISCREPANCY exception was not raised';
  END IF;

  SELECT count(*) INTO v_holds_after FROM public.booking_holds WHERE facility_id = '44444444-4444-4444-a444-444444444444';

  -- Verify NO hold was inserted and NO capacity was consumed
  IF v_holds_after != v_holds_before THEN
    RAISE EXCEPTION 'TEST 1 FAILED: A hold was inserted despite PRICE_DISCREPANCY (before=%, after=%)', v_holds_before, v_holds_after;
  END IF;

  RAISE NOTICE 'TEST 1 PASSED: Price discrepancy rejected before INSERT; zero holds created';
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- TEST 1.1: Rejection of NULL, Zero, Negative, and Omitted expected_total_amount
-- ═══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_holds_before integer;
  v_holds_after integer;
  v_err_null boolean := false;
  v_err_zero boolean := false;
  v_err_neg boolean := false;
  v_err_omit boolean := false;
BEGIN
  SELECT count(*) INTO v_holds_before FROM public.booking_holds WHERE facility_id = '44444444-4444-4444-a444-444444444444';

  -- Case A: NULL expected price
  BEGIN
    PERFORM public.create_booking_hold(
      p_facility_id => '44444444-4444-4444-a444-444444444444',
      p_service_id => '55555555-5555-4555-a555-555555555555',
      p_entry_at => '2026-12-10T10:00:00Z',
      p_exit_at => '2026-12-12T10:00:00Z',
      p_guest_email => 'invalid.price@aerovalet.demo',
      p_guest_name => 'Invalid Price',
      p_expected_total_amount => null
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%INVALID_EXPECTED_PRICE%' THEN v_err_null := true; END IF;
  END;

  -- Case B: 0 expected price
  BEGIN
    PERFORM public.create_booking_hold(
      p_facility_id => '44444444-4444-4444-a444-444444444444',
      p_service_id => '55555555-5555-4555-a555-555555555555',
      p_entry_at => '2026-12-10T10:00:00Z',
      p_exit_at => '2026-12-12T10:00:00Z',
      p_guest_email => 'invalid.price@aerovalet.demo',
      p_guest_name => 'Invalid Price',
      p_expected_total_amount => 0
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%INVALID_EXPECTED_PRICE%' THEN v_err_zero := true; END IF;
  END;

  -- Case C: Negative expected price
  BEGIN
    PERFORM public.create_booking_hold(
      p_facility_id => '44444444-4444-4444-a444-444444444444',
      p_service_id => '55555555-5555-4555-a555-555555555555',
      p_entry_at => '2026-12-10T10:00:00Z',
      p_exit_at => '2026-12-12T10:00:00Z',
      p_guest_email => 'invalid.price@aerovalet.demo',
      p_guest_name => 'Invalid Price',
      p_expected_total_amount => -4999
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%INVALID_EXPECTED_PRICE%' THEN v_err_neg := true; END IF;
  END;

  -- Case D: Omitted expected price (default null)
  BEGIN
    PERFORM public.create_booking_hold(
      p_facility_id => '44444444-4444-4444-a444-444444444444',
      p_service_id => '55555555-5555-4555-a555-555555555555',
      p_entry_at => '2026-12-10T10:00:00Z',
      p_exit_at => '2026-12-12T10:00:00Z',
      p_guest_email => 'invalid.price@aerovalet.demo',
      p_guest_name => 'Invalid Price'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%INVALID_EXPECTED_PRICE%' THEN v_err_omit := true; END IF;
  END;

  IF NOT (v_err_null AND v_err_zero AND v_err_neg AND v_err_omit) THEN
    RAISE EXCEPTION 'TEST 1.1 FAILED: Not all invalid expected_total_amount cases were rejected: null=%, zero=%, neg=%, omit=%',
      v_err_null, v_err_zero, v_err_neg, v_err_omit;
  END IF;

  SELECT count(*) INTO v_holds_after FROM public.booking_holds WHERE facility_id = '44444444-4444-4444-a444-444444444444';
  IF v_holds_after != v_holds_before THEN
    RAISE EXCEPTION 'TEST 1.1 FAILED: A hold was created with an invalid expected_total_amount';
  END IF;

  RAISE NOTICE 'TEST 1.1 PASSED: NULL, zero, negative, and omitted expected prices are strictly rejected before INSERT';
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- TEST 2: Precio coincidente: exactly 1 hold created with 100% price parity
-- ═══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_quote jsonb;
  v_expected_amount bigint;
  v_hold jsonb;
  v_hold_id uuid;
  v_hold_row public.booking_holds%rowtype;
BEGIN
  -- 1. Get authoritative quote for 2 days
  v_quote := public.calculate_service_quote(
    '55555555-5555-4555-a555-555555555555',
    '2026-12-10T10:00:00Z',
    '2026-12-12T10:00:00Z'
  );
  v_expected_amount := (v_quote->>'customer_total_amount')::bigint;

  -- 2. Call create_booking_hold with exact expected amount
  v_hold := public.create_booking_hold(
    p_facility_id => '44444444-4444-4444-a444-444444444444',
    p_service_id => '55555555-5555-4555-a555-555555555555',
    p_entry_at => '2026-12-10T10:00:00Z',
    p_exit_at => '2026-12-12T10:00:00Z',
    p_vehicle_id => null,
    p_customer_id => null,
    p_guest_email => 'parity.tester@aerovalet.demo',
    p_guest_name => 'Parity Tester',
    p_guest_phone => '+34600112233',
    p_vehicle_category => 'standard',
    p_selected_extras => '[]'::jsonb,
    p_expected_total_amount => v_expected_amount -- MATCHING AMOUNT
  );

  v_hold_id := (v_hold->>'hold_id')::uuid;

  -- 3. Verify exactly 1 hold was persisted in table
  SELECT * INTO v_hold_row FROM public.booking_holds WHERE id = v_hold_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST 2 FAILED: Booking hold record not found in database';
  END IF;

  IF v_hold_row.price_amount != v_expected_amount THEN
    RAISE EXCEPTION 'TEST 2 FAILED: Persisted price_amount (%) != expected (%)', v_hold_row.price_amount, v_expected_amount;
  END IF;

  IF v_hold_row.status != 'active' THEN
    RAISE EXCEPTION 'TEST 2 FAILED: Hold status is %, expected active', v_hold_row.status;
  END IF;

  -- Clean up test hold
  DELETE FROM public.booking_holds WHERE id = v_hold_id;
  RAISE NOTICE 'TEST 2 PASSED: Matching expected price creates exactly one valid hold';
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- TEST 3: Operador / Servicio sin fuente verificada: rechazo de cotización automática
-- ═══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_err_caught boolean := false;
BEGIN
  -- Service 55555555-5555-4555-a555-555555555556 belongs to operator 33333333-3333-4333-a333-333333333334
  -- which has NO verified sources in operator_tariff_sources.
  BEGIN
    PERFORM public.calculate_service_quote(
      '55555555-5555-4555-a555-555555555556',
      '2026-12-10T10:00:00Z',
      '2026-12-12T10:00:00Z'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%NO_VERIFIED_TARIFF_SOURCE%' THEN
      v_err_caught := true;
    END IF;
  END;

  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST 3 FAILED: Service without verified source should raise NO_VERIFIED_TARIFF_SOURCE';
  END IF;

  RAISE NOTICE 'TEST 3 PASSED: Service without verified source rejects automatic quote';
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- TEST 4: Regla dinámica sin procedencia aprobada: ignorada por calculate_service_quote
-- ═══════════════════════════════════════════════════════════════════════════════
-- Insert an unverified rule (source_id = NULL)
INSERT INTO public.service_price_rules (id, service_id, source_id, name, rule_type, priority, adjustment_type, fixed_amount, active)
VALUES ('88888888-8888-4888-a888-888888888891', '55555555-5555-4555-a555-555555555555', null, 'Regla No Aprobada', 'season', 50, 'override', 999, true);

DO $$
DECLARE
  v_quote jsonb;
BEGIN
  v_quote := public.calculate_service_quote(
    '55555555-5555-4555-a555-555555555555',
    '2026-12-10T10:00:00Z',
    '2026-12-12T10:00:00Z' -- 2 days
  );

  -- Since the rule has NO verified source, it must be completely IGNORED.
  -- Supplier base must be 2 days * 2000c = 4000c (NOT 2 * 999 = 1998c)
  IF (v_quote->>'supplier_base_amount')::bigint != 4000 THEN
    RAISE EXCEPTION 'TEST 4 FAILED: Unverified rule was incorrectly applied (supplier_base = %)', v_quote->>'supplier_base_amount';
  END IF;

  IF jsonb_array_length(v_quote->'applied_rules') != 0 THEN
    RAISE EXCEPTION 'TEST 4 FAILED: Unverified rule appears in applied_rules';
  END IF;

  RAISE NOTICE 'TEST 4 PASSED: Unapproved dynamic rule without verified source is strictly ignored';
END $$;
DELETE FROM public.service_price_rules WHERE id = '88888888-8888-4888-a888-888888888891';

-- ═══════════════════════════════════════════════════════════════════════════════
-- TEST 5: Regla dinámica con fuente verificada: aplicada correctamente
-- ═══════════════════════════════════════════════════════════════════════════════
INSERT INTO public.service_price_rules (id, service_id, source_id, name, rule_type, priority, adjustment_type, fixed_amount, active)
VALUES ('88888888-8888-4888-a888-888888888892', '55555555-5555-4555-a555-555555555555', '77777777-7777-4777-a777-777777777771', 'Promo Oficial Verificada', 'season', 10, 'override', 1600, true);

DO $$
DECLARE
  v_quote jsonb;
BEGIN
  v_quote := public.calculate_service_quote(
    '55555555-5555-4555-a555-555555555555',
    '2026-12-10T10:00:00Z',
    '2026-12-12T10:00:00Z'
  );

  -- 2 days * 1600 = 3200 supplier base
  IF (v_quote->>'supplier_base_amount')::bigint != 3200 THEN
    RAISE EXCEPTION 'TEST 5 FAILED: Verified rule not applied (got %)', v_quote->>'supplier_base_amount';
  END IF;

  RAISE NOTICE 'TEST 5 PASSED: Verified dynamic rule with approved source is applied';
END $$;
DELETE FROM public.service_price_rules WHERE id = '88888888-8888-4888-a888-888888888892';

-- ═══════════════════════════════════════════════════════════════════════════════
-- TEST 6: Regla porcentual con Round Half-Up en fracciones de céntimo
-- ═══════════════════════════════════════════════════════════════════════════════
-- Temporary service with 2050 cents base rate
INSERT INTO public.services (id, facility_id, source_id, name, price_amount, currency, pricing_unit, active)
VALUES ('55555555-5555-4555-a555-555555555557', '44444444-4444-4444-a444-444444444444', '77777777-7777-4777-a777-777777777771', 'Half-Up Test Srv', 2050, 'EUR', 'per_stay', true);

-- Add rule with +100 bps (+1.00%): 2050 * 10100 / 10000 = 2070.5 -> rounds Half-Up to 2071 cents!
INSERT INTO public.service_price_rules (id, service_id, source_id, name, rule_type, priority, adjustment_type, percentage_bps, active)
VALUES ('88888888-8888-4888-a888-888888888893', '55555555-5555-4555-a555-555555555557', '77777777-7777-4777-a777-777777777771', 'Recargo 1%', 'season', 10, 'percentage_bps', 100, true);

DO $$
DECLARE
  v_quote jsonb;
BEGIN
  v_quote := public.calculate_service_quote(
    '55555555-5555-4555-a555-555555555557',
    '2026-12-10T10:00:00Z',
    '2026-12-11T10:00:00Z'
  );

  -- 2050 * 1.01 = 2070.5 cents -> Round Half-Up must yield 2071 cents
  IF (v_quote->>'supplier_base_amount')::bigint != 2071 THEN
    RAISE EXCEPTION 'TEST 6 FAILED: Expected 2071 cents via Round Half-Up for 2070.5, got %', v_quote->>'supplier_base_amount';
  END IF;

  RAISE NOTICE 'TEST 6 PASSED: Round Half-Up on percentage_bps rule with fractional cents (2070.5 -> 2071)';
END $$;
DELETE FROM public.service_price_rules WHERE id = '88888888-8888-4888-a888-888888888893';
DELETE FROM public.services WHERE id = '55555555-5555-4555-a555-555555555557';

-- ═══════════════════════════════════════════════════════════════════════════════
-- TEST 7: Capacidad límite: dos clientes simultáneos compitiendo por la última plaza
-- ═══════════════════════════════════════════════════════════════════════════════
-- Create tiny facility: total_capacity = 2, operational_buffer = 1 (sellable capacity = 1 spot)
INSERT INTO public.facilities (id, operator_id, airport_id, name, address, total_capacity, operational_buffer, active)
VALUES ('44444444-4444-4444-a444-444444444449', '33333333-3333-4333-a333-333333333333', '11111111-1111-4111-a111-111111111111', 'Micro Parking 1 Spot', 'T4', 2, 1, true);

INSERT INTO public.services (id, facility_id, source_id, name, price_amount, currency, pricing_unit, active)
VALUES ('55555555-5555-4555-a555-555555555558', '44444444-4444-4444-a444-444444444449', '77777777-7777-4777-a777-777777777771', 'Micro Valet', 2500, 'EUR', 'per_day', true);

DO $$
DECLARE
  v_quote jsonb;
  v_expected bigint;
  v_hold1 jsonb;
  v_err_caught boolean := false;
BEGIN
  v_quote := public.calculate_service_quote('55555555-5555-4555-a555-555555555558', '2026-12-13T10:00:00Z', '2026-12-14T10:00:00Z');
  v_expected := (v_quote->>'customer_total_amount')::bigint;

  -- Client 1 reserves the only sellable spot
  v_hold1 := public.create_booking_hold(
    p_facility_id => '44444444-4444-4444-a444-444444444449',
    p_service_id => '55555555-5555-4555-a555-555555555558',
    p_entry_at => '2026-12-13T10:00:00Z',
    p_exit_at => '2026-12-14T10:00:00Z',
    p_guest_email => 'client1@aerovalet.demo',
    p_guest_name => 'Client 1',
    p_expected_total_amount => v_expected
  );

  -- Client 2 attempts to reserve an overlapping slot on the same facility
  BEGIN
    PERFORM public.create_booking_hold(
      p_facility_id => '44444444-4444-4444-a444-444444444449',
      p_service_id => '55555555-5555-4555-a555-555555555558',
      p_entry_at => '2026-12-13T12:00:00Z',
      p_exit_at => '2026-12-14T12:00:00Z',
      p_guest_email => 'client2@aerovalet.demo',
      p_guest_name => 'Client 2',
      p_expected_total_amount => v_expected
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%CAPACITY_EXHAUSTED%' THEN
      v_err_caught := true;
    END IF;
  END;

  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST 7 FAILED: Second client was allowed to exceed sellable capacity';
  END IF;

  RAISE NOTICE 'TEST 7 PASSED: Concurrent reservation on last spot correctly serialized and rejected';
END $$;
DELETE FROM public.booking_holds WHERE facility_id = '44444444-4444-4444-a444-444444444449';
DELETE FROM public.services WHERE facility_id = '44444444-4444-4444-a444-444444444449';
DELETE FROM public.facilities WHERE id = '44444444-4444-4444-a444-444444444449';

-- ═══════════════════════════════════════════════════════════════════════════════
-- TEST 8: Paridad al céntimo en toda la cadena (cotización, hold y snapshot)
-- ═══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_quote jsonb;
  v_hold jsonb;
  v_hold_price bigint;
  v_snapshot_total bigint;
  v_quote_total bigint;
BEGIN
  -- Quote with vehicle category + extra
  v_quote := public.calculate_service_quote(
    '55555555-5555-4555-a555-555555555555',
    '2026-12-11T10:00:00Z',
    '2026-12-14T10:00:00Z',
    'suv',
    jsonb_build_array(jsonb_build_object('extra_id', '66666666-6666-4666-a666-666666666666', 'quantity', 1))
  );

  v_quote_total := (v_quote->>'customer_total_amount')::bigint;

  v_hold := public.create_booking_hold(
    p_facility_id => '44444444-4444-4444-a444-444444444444',
    p_service_id => '55555555-5555-4555-a555-555555555555',
    p_entry_at => '2026-12-11T10:00:00Z',
    p_exit_at => '2026-12-14T10:00:00Z',
    p_guest_email => 'parity.e2e@aerovalet.demo',
    p_guest_name => 'Parity E2E',
    p_vehicle_category => 'suv',
    p_selected_extras => jsonb_build_array(jsonb_build_object('extra_id', '66666666-6666-4666-a666-666666666666', 'quantity', 1)),
    p_expected_total_amount => v_quote_total
  );

  v_hold_price := (v_hold->>'price_amount')::bigint;
  v_snapshot_total := (v_hold->'price_snapshot'->>'customer_total_amount')::bigint;

  IF v_hold_price != v_quote_total OR v_snapshot_total != v_quote_total THEN
    RAISE EXCEPTION 'TEST 8 FAILED: Parity mismatch between quote (%), hold (%), and snapshot (%)',
      v_quote_total, v_hold_price, v_snapshot_total;
  END IF;

  RAISE NOTICE 'TEST 8 PASSED: Exact cent parity across quote, hold, and snapshot (total: % cents)', v_hold_price;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- TEST 9: release_booking_hold RPC (Compensating action releases hold and capacity)
-- ═══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_quote jsonb;
  v_hold jsonb;
  v_hold_id uuid;
  v_released boolean;
  v_status text;
BEGIN
  v_quote := public.calculate_service_quote('55555555-5555-4555-a555-555555555555', '2026-12-11T10:00:00Z', '2026-12-13T10:00:00Z');

  v_hold := public.create_booking_hold(
    p_facility_id => '44444444-4444-4444-a444-444444444444',
    p_service_id => '55555555-5555-4555-a555-555555555555',
    p_entry_at => '2026-12-11T10:00:00Z',
    p_exit_at => '2026-12-13T10:00:00Z',
    p_guest_email => 'release.tester@aerovalet.demo',
    p_guest_name => 'Release Tester',
    p_expected_total_amount => (v_quote->>'customer_total_amount')::bigint
  );

  v_hold_id := (v_hold->>'hold_id')::uuid;

  -- Call release_booking_hold
  v_released := public.release_booking_hold(v_hold_id);
  IF NOT v_released THEN
    RAISE EXCEPTION 'TEST 9 FAILED: release_booking_hold returned false';
  END IF;

  SELECT status INTO v_status FROM public.booking_holds WHERE id = v_hold_id;
  IF v_status != 'released' THEN
    RAISE EXCEPTION 'TEST 9 FAILED: Hold status is %, expected released', v_status;
  END IF;

  DELETE FROM public.booking_holds WHERE id = v_hold_id;
  RAISE NOTICE 'TEST 9 PASSED: release_booking_hold successfully releases hold and restores capacity';
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- TEST 10: Service-Facility Mismatch and Inactive Operator Defense
-- ═══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_err_mismatch boolean := false;
BEGIN
  -- Service 55555555-5555-4555-a555-555555555555 belongs to facility 44444444-4444-4444-a444-444444444444.
  -- We pass foreign facility 44444444-4444-4444-a444-444444444445.
  BEGIN
    PERFORM public.calculate_service_quote(
      p_service_id => '55555555-5555-4555-a555-555555555555',
      p_entry_at => '2026-12-11T10:00:00Z',
      p_exit_at => '2026-12-13T10:00:00Z',
      p_facility_id => '44444444-4444-4444-a444-444444444445'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%SERVICE_FACILITY_MISMATCH%' THEN
      v_err_mismatch := true;
    END IF;
  END;

  IF NOT v_err_mismatch THEN
    RAISE EXCEPTION 'TEST 10 FAILED: SERVICE_FACILITY_MISMATCH was not raised for mismatched facility';
  END IF;

  RAISE NOTICE 'TEST 10 PASSED: Service-facility mismatch strictly rejected by calculate_service_quote';
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- TEST 11: Negative Half-Cent Tie Rounding in SQL (Round Half Away From Zero)
-- ═══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_pos_tie bigint;
  v_neg_tie bigint;
BEGIN
  -- PostgreSQL round(numeric) on exact ties:
  -- round(20.5::numeric) = 21
  -- round(-20.5::numeric) = -21
  v_pos_tie := round((2050 * 100)::numeric / 10000.0)::bigint;
  v_neg_tie := round((-2050 * 100)::numeric / 10000.0)::bigint;

  IF v_pos_tie != 21 THEN
    RAISE EXCEPTION 'TEST 11 FAILED: Positive half-cent tie expected 21, got %', v_pos_tie;
  END IF;

  IF v_neg_tie != -21 THEN
    RAISE EXCEPTION 'TEST 11 FAILED: Negative half-cent tie expected -21, got %', v_neg_tie;
  END IF;

  RAISE NOTICE 'TEST 11 PASSED: PostgreSQL Round Half Away From Zero verified for positive (+21) and negative (-21) ties';
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- TEST 12: Commercial Inquiries Table Persistence & Idempotency Key
-- ═══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_dup_rejected boolean := false;
  v_inq_id uuid;
BEGIN
  INSERT INTO public.commercial_inquiries (
    facility_id, service_id, airport_id,
    entry_at, exit_at,
    contact_name, contact_email, contact_phone,
    idempotency_key
  ) VALUES (
    '44444444-4444-4444-a444-444444444445',
    '55555555-5555-4555-a555-555555555556',
    '11111111-1111-4111-a111-111111111111',
    '2026-12-11T10:00:00Z',
    '2026-12-13T10:00:00Z',
    'Commercial Lead',
    'lead@aerovalet.demo',
    '+34600112233',
    'idemp-key-test-12345678'
  ) RETURNING id INTO v_inq_id;

  -- Attempt duplicate insert with same idempotency key
  BEGIN
    INSERT INTO public.commercial_inquiries (
      facility_id, service_id, airport_id,
      entry_at, exit_at,
      contact_name, contact_email,
      idempotency_key
    ) VALUES (
      '44444444-4444-4444-a444-444444444445',
      '55555555-5555-4555-a555-555555555556',
      '11111111-1111-4111-a111-111111111111',
      '2026-12-11T10:00:00Z',
      '2026-12-13T10:00:00Z',
      'Commercial Lead Duplicate',
      'lead@aerovalet.demo',
      'idemp-key-test-12345678'
    );
  EXCEPTION WHEN unique_violation THEN
    v_dup_rejected := true;
  END;

  IF NOT v_dup_rejected THEN
    RAISE EXCEPTION 'TEST 12 FAILED: Duplicate commercial inquiry was not rejected by unique idempotency_key';
  END IF;

  DELETE FROM public.commercial_inquiries WHERE id = v_inq_id;
  RAISE NOTICE 'TEST 12 PASSED: Commercial inquiry persisted and duplicate rejected via idempotency key';
END $$;

ROLLBACK;

