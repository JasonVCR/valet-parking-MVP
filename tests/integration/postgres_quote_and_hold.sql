-- Integration Test Suite for AeroValet PostgreSQL Database (Increment 7)
-- Tests:
-- 1. Setup seed data (airport, operator, facility, service, extra, tariff source, tariff bands)
-- 2. Dynamic rule: override
-- 3. Dynamic rule: fixed_addition
-- 4. Dynamic rule: percentage_bps
-- 5. Dynamic rule: Two matching rules with different priorities (priority precedence)
-- 6. Dynamic rule: Two matching rules with same priority (deterministic tie-breaking by created_at, id)
-- 7. No matching rules (base price fallback)
-- 8. Verified tariff band vs unverified tariff band
-- 9. Extras: valid extra vs invalid extra
-- 10. B2B Commission: 10% on 205 cents base produces 21 cents (Round Half-Up)
-- 11. B2B Commission hardening: unprivileged caller cannot override operator platform_fee_bps
-- 12. Full flow: calculate_service_quote followed by create_booking_hold with p_vehicle_category,
--     verifying exact price_amount and price_snapshot.customer_total_amount parity.

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

-- Seed Operator with platform_fee_bps = 1500 (15%)
INSERT INTO public.operators (id, owner_user_id, name, slug, legal_name, country_code, currency, status, platform_fee_bps)
VALUES ('33333333-3333-4333-a333-333333333333', '22222222-2222-4222-a222-222222222222', 'Valet Test SL', 'valet-test', 'Valet Test SL', 'ES', 'EUR', 'active', 1500)
ON CONFLICT (id) DO NOTHING;

-- Seed Facility
INSERT INTO public.facilities (id, operator_id, airport_id, name, address, total_capacity, operational_buffer, active)
VALUES ('44444444-4444-4444-a444-444444444444', '33333333-3333-4333-a333-333333333333', '11111111-1111-4111-a111-111111111111', 'Parking VIP T4', 'Terminal 4 Salidas', 50, 5, true)
ON CONFLICT (id) DO NOTHING;

-- Seed Service (price_amount = 2000 cents / 20.00 EUR per day)
INSERT INTO public.services (id, facility_id, name, description, price_amount, currency, pricing_unit, active)
VALUES ('55555555-5555-4555-a555-555555555555', '44444444-4444-4444-a444-444444444444', 'Valet Express 24h', 'Entrega en terminal', 2000, 'EUR', 'per_day', true)
ON CONFLICT (id) DO NOTHING;

-- Seed Extra: Wash (1500 cents)
INSERT INTO public.service_extras (id, facility_id, service_id, name, price_amount, currency, pricing_unit, is_mandatory, max_quantity, active)
VALUES ('66666666-6666-4666-a666-666666666666', '44444444-4444-4444-a444-444444444444', '55555555-5555-4555-a555-555555555555', 'Lavado Exterior VIP', 1500, 'EUR', 'per_stay', false, 1, true)
ON CONFLICT (id) DO NOTHING;

-- Seed Tariff Sources
INSERT INTO public.operator_tariff_sources (id, operator_id, source_name, source_type, source_url, verification_status)
VALUES 
  ('77777777-7777-4777-a777-777777777771', '33333333-3333-4333-a333-333333333333', 'Web Oficial Verificada', 'official_website', 'https://valettest.es/tarifas', 'verified'),
  ('77777777-7777-4777-a777-777777777772', '33333333-3333-4333-a333-333333333333', 'Tarifa no contrastada', 'manual_verified', 'https://externo.com/tarifas', 'pending_review')
ON CONFLICT (id) DO NOTHING;

-- TEST 1: Base Fallback when no band and no rule exists
DO $$
DECLARE
  v_res jsonb;
BEGIN
  v_res := public.calculate_service_quote(
    '55555555-5555-4555-a555-555555555555',
    '2026-11-15T10:00:00Z',
    '2026-11-17T10:00:00Z' -- 48h = 2 days
  );

  -- 2 days * 2000 = 4000 supplier_base. Markup = 800. Fee = 199. Customer total = 4999
  IF (v_res->>'supplier_base_amount')::bigint != 4000 THEN
    RAISE EXCEPTION 'TEST 1 FAILED: Expected supplier_base_amount 4000, got %', v_res->>'supplier_base_amount';
  END IF;
  IF (v_res->>'customer_total_amount')::bigint != 4999 THEN
    RAISE EXCEPTION 'TEST 1 FAILED: Expected customer_total_amount 4999, got %', v_res->>'customer_total_amount';
  END IF;
  RAISE NOTICE 'TEST 1 PASSED: Base fallback quote';
END $$;

-- TEST 2: Dynamic Rule - Override
INSERT INTO public.service_price_rules (id, service_id, name, rule_type, priority, adjustment_type, fixed_amount, active)
VALUES ('88888888-8888-4888-a888-888888888881', '55555555-5555-4555-a555-555555555555', 'Promo Override', 'season', 10, 'override', 1500, true);

DO $$
DECLARE
  v_res jsonb;
BEGIN
  v_res := public.calculate_service_quote(
    '55555555-5555-4555-a555-555555555555',
    '2026-11-15T10:00:00Z',
    '2026-11-17T10:00:00Z' -- 2 days
  );

  -- 2 days * 1500 (override) = 3000 supplier_base. Markup = 800. Fee = 199. Total = 3999
  IF (v_res->>'supplier_base_amount')::bigint != 3000 THEN
    RAISE EXCEPTION 'TEST 2 FAILED: Expected supplier_base_amount 3000, got %', v_res->>'supplier_base_amount';
  END IF;
  IF (v_res->>'customer_total_amount')::bigint != 3999 THEN
    RAISE EXCEPTION 'TEST 2 FAILED: Expected customer_total_amount 3999, got %', v_res->>'customer_total_amount';
  END IF;
  RAISE NOTICE 'TEST 2 PASSED: Rule override applied';
END $$;
DELETE FROM public.service_price_rules WHERE id = '88888888-8888-4888-a888-888888888881';

-- TEST 3: Dynamic Rule - Fixed Addition
INSERT INTO public.service_price_rules (id, service_id, name, rule_type, priority, adjustment_type, fixed_amount, active)
VALUES ('88888888-8888-4888-a888-888888888882', '55555555-5555-4555-a555-555555555555', 'Suplemento Fin de Semana', 'weekday', 10, 'fixed_addition', 500, true);

DO $$
DECLARE
  v_res jsonb;
BEGIN
  v_res := public.calculate_service_quote(
    '55555555-5555-4555-a555-555555555555',
    '2026-11-15T10:00:00Z',
    '2026-11-17T10:00:00Z'
  );

  -- 2 days * (2000 + 500) = 5000 supplier_base. Markup = 800. Fee = 199. Total = 5999
  IF (v_res->>'supplier_base_amount')::bigint != 5000 THEN
    RAISE EXCEPTION 'TEST 3 FAILED: Expected supplier_base_amount 5000, got %', v_res->>'supplier_base_amount';
  END IF;
  IF (v_res->>'customer_total_amount')::bigint != 5999 THEN
    RAISE EXCEPTION 'TEST 3 FAILED: Expected customer_total_amount 5999, got %', v_res->>'customer_total_amount';
  END IF;
  RAISE NOTICE 'TEST 3 PASSED: Rule fixed_addition applied';
END $$;
DELETE FROM public.service_price_rules WHERE id = '88888888-8888-4888-a888-888888888882';

-- TEST 4: Dynamic Rule - Percentage BPS (+20% = +2000 bps)
INSERT INTO public.service_price_rules (id, service_id, name, rule_type, priority, adjustment_type, percentage_bps, active)
VALUES ('88888888-8888-4888-a888-888888888883', '55555555-5555-4555-a555-555555555555', 'Temporada Alta +20%', 'season', 10, 'percentage_bps', 2000, true);

DO $$
DECLARE
  v_res jsonb;
BEGIN
  v_res := public.calculate_service_quote(
    '55555555-5555-4555-a555-555555555555',
    '2026-11-15T10:00:00Z',
    '2026-11-17T10:00:00Z'
  );

  -- 2000 * 12000 / 10000 = 2400. 2 days * 2400 = 4800 supplier_base. Total = 4800 + 999 = 5799
  IF (v_res->>'supplier_base_amount')::bigint != 4800 THEN
    RAISE EXCEPTION 'TEST 4 FAILED: Expected supplier_base_amount 4800, got %', v_res->>'supplier_base_amount';
  END IF;
  IF (v_res->>'customer_total_amount')::bigint != 5799 THEN
    RAISE EXCEPTION 'TEST 4 FAILED: Expected customer_total_amount 5799, got %', v_res->>'customer_total_amount';
  END IF;
  RAISE NOTICE 'TEST 4 PASSED: Rule percentage_bps applied';
END $$;
DELETE FROM public.service_price_rules WHERE id = '88888888-8888-4888-a888-888888888883';

-- TEST 5: Two matching rules with different priorities (priority 20 vs priority 10)
INSERT INTO public.service_price_rules (id, service_id, name, rule_type, priority, adjustment_type, fixed_amount, active)
VALUES 
  ('88888888-8888-4888-a888-888888888884', '55555555-5555-4555-a555-555555555555', 'Regla Baja Prioridad', 'season', 10, 'override', 1000, true),
  ('88888888-8888-4888-a888-888888888885', '55555555-5555-4555-a555-555555555555', 'Regla Alta Prioridad', 'season', 20, 'override', 1800, true);

DO $$
DECLARE
  v_res jsonb;
BEGIN
  v_res := public.calculate_service_quote(
    '55555555-5555-4555-a555-555555555555',
    '2026-11-15T10:00:00Z',
    '2026-11-17T10:00:00Z'
  );

  -- Priority 20 wins -> unit price 1800 -> 2 days = 3600
  IF (v_res->>'supplier_base_amount')::bigint != 3600 THEN
    RAISE EXCEPTION 'TEST 5 FAILED: Expected priority 20 rule (supplier_base = 3600), got %', v_res->>'supplier_base_amount';
  END IF;
  RAISE NOTICE 'TEST 5 PASSED: Priority ordering strictly respected';
END $$;
DELETE FROM public.service_price_rules WHERE id IN ('88888888-8888-4888-a888-888888888884', '88888888-8888-4888-a888-888888888885');

-- TEST 6: Two matching rules with equal priority (deterministic tie-breaking by created_at asc, id asc)
INSERT INTO public.service_price_rules (id, service_id, name, rule_type, priority, adjustment_type, fixed_amount, active, created_at)
VALUES 
  ('88888888-8888-4888-a888-888888888886', '55555555-5555-4555-a555-555555555555', 'Regla Antigua', 'season', 15, 'override', 1200, true, '2026-10-01T00:00:00Z'),
  ('88888888-8888-4888-a888-888888888887', '55555555-5555-4555-a555-555555555555', 'Regla Nueva', 'season', 15, 'override', 1700, true, '2026-10-15T00:00:00Z');

DO $$
DECLARE
  v_res jsonb;
BEGIN
  v_res := public.calculate_service_quote(
    '55555555-5555-4555-a555-555555555555',
    '2026-11-15T10:00:00Z',
    '2026-11-17T10:00:00Z'
  );

  -- Oldest rule (created_at asc) wins -> unit price 1200 -> 2 days = 2400
  IF (v_res->>'supplier_base_amount')::bigint != 2400 THEN
    RAISE EXCEPTION 'TEST 6 FAILED: Expected oldest rule (supplier_base = 2400), got %', v_res->>'supplier_base_amount';
  END IF;
  RAISE NOTICE 'TEST 6 PASSED: Deterministic tie-breaker respected';
END $$;
DELETE FROM public.service_price_rules WHERE id IN ('88888888-8888-4888-a888-888888888886', '88888888-8888-4888-a888-888888888887');

-- TEST 7: Verified tariff band vs unverified tariff band
INSERT INTO public.service_tariff_bands (id, service_id, source_id, name, min_duration_hours, max_duration_hours, price_amount, currency, pricing_unit, active)
VALUES 
  ('99999999-9999-4999-a999-999999999991', '55555555-5555-4555-a555-555555555555', '77777777-7777-4777-a777-777777777772', 'Banda No Verificada', 25, 48, 1000, 'EUR', 'flat_stay', true),
  ('99999999-9999-4999-a999-999999999992', '55555555-5555-4555-a555-555555555555', '77777777-7777-4777-a777-777777777771', 'Banda Oficial Verificada', 25, 48, 3500, 'EUR', 'flat_stay', true);

DO $$
DECLARE
  v_res jsonb;
BEGIN
  v_res := public.calculate_service_quote(
    '55555555-5555-4555-a555-555555555555',
    '2026-11-15T10:00:00Z',
    '2026-11-17T10:00:00Z' -- 48h
  );

  -- Only verified source band (3500) can match
  IF (v_res->>'supplier_base_amount')::bigint != 3500 THEN
    RAISE EXCEPTION 'TEST 7 FAILED: Expected verified band (3500), got %', v_res->>'supplier_base_amount';
  END IF;
  IF (v_res->'tariff_source'->>'verification_status') != 'verified' THEN
    RAISE EXCEPTION 'TEST 7 FAILED: Expected verified status in tariff_source';
  END IF;
  RAISE NOTICE 'TEST 7 PASSED: Verified tariff band gating enforced';
END $$;
DELETE FROM public.service_tariff_bands WHERE id IN ('99999999-9999-4999-a999-999999999991', '99999999-9999-4999-a999-999999999992');

-- TEST 8: Extras: valid extra selection and invalid extra rejection
DO $$
DECLARE
  v_res jsonb;
  v_failed boolean := false;
BEGIN
  -- Valid selection
  v_res := public.calculate_service_quote(
    '55555555-5555-4555-a555-555555555555',
    '2026-11-15T10:00:00Z',
    '2026-11-17T10:00:00Z',
    null,
    jsonb_build_array(jsonb_build_object('extra_id', '66666666-6666-4666-a666-666666666666', 'quantity', 1))
  );

  -- base 4000 + extras 1500 = 5500 supplier components; total = 4000 + 999 + 1500 = 6499
  IF (v_res->>'extras_amount')::bigint != 1500 THEN
    RAISE EXCEPTION 'TEST 8 FAILED: Expected extras_amount 1500, got %', v_res->>'extras_amount';
  END IF;
  IF (v_res->>'customer_total_amount')::bigint != 6499 THEN
    RAISE EXCEPTION 'TEST 8 FAILED: Expected customer_total_amount 6499, got %', v_res->>'customer_total_amount';
  END IF;

  -- Invalid selection (extra that does not exist)
  BEGIN
    PERFORM public.calculate_service_quote(
      '55555555-5555-4555-a555-555555555555',
      '2026-11-15T10:00:00Z',
      '2026-11-17T10:00:00Z',
      null,
      jsonb_build_array(jsonb_build_object('extra_id', '00000000-0000-0000-0000-000000000000', 'quantity', 1))
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;

  IF NOT v_failed THEN
    RAISE EXCEPTION 'TEST 8 FAILED: Expected exception for invalid extra selection';
  END IF;
  RAISE NOTICE 'TEST 8 PASSED: Valid and invalid extra checks';
END $$;

-- TEST 9: B2B Commission Round Half-Up with 205 cents base (10% = 1000 bps)
-- Create temporary service with 205 cents flat stay
INSERT INTO public.services (id, facility_id, name, price_amount, currency, pricing_unit, active)
VALUES ('55555555-5555-4555-a555-555555555559', '44444444-4444-4444-a444-444444444444', 'Micro Service', 205, 'EUR', 'per_stay', true);

DO $$
DECLARE
  v_res jsonb;
BEGIN
  -- We execute with service_role / superuser to supply explicit rate of 1000 bps
  v_res := public.calculate_service_quote(
    '55555555-5555-4555-a555-555555555559',
    '2026-11-15T10:00:00Z',
    '2026-11-17T10:00:00Z',
    null,
    '[]'::jsonb,
    1000
  );

  -- 205 * 0.10 = 20.5 -> rounds half-up to 21
  IF (v_res->'b2b_settlement'->>'commission_amount')::bigint != 21 THEN
    RAISE EXCEPTION 'TEST 9 FAILED: Expected commission 21 for 205 cents, got %', v_res->'b2b_settlement'->>'commission_amount';
  END IF;
  IF (v_res->'b2b_settlement'->>'operator_payout_amount')::bigint != 184 THEN
    RAISE EXCEPTION 'TEST 9 FAILED: Expected payout 184, got %', v_res->'b2b_settlement'->>'operator_payout_amount';
  END IF;
  RAISE NOTICE 'TEST 9 PASSED: Round Half-Up commission math identical to TypeScript';
END $$;
DELETE FROM public.services WHERE id = '55555555-5555-4555-a555-555555555559';

-- TEST 10: B2B Commission hardening: unprivileged caller cannot override operator platform_fee_bps
DO $$
DECLARE
  v_res jsonb;
BEGIN
  -- In unprivileged context (auth.role() is anon/authenticated)
  -- The operator platform_fee_bps is 1500 (15%)
  -- Even if caller passes p_b2b_commission_rate_bps = 500, it MUST be ignored
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  v_res := public.calculate_service_quote(
    '55555555-5555-4555-a555-555555555555',
    '2026-11-15T10:00:00Z',
    '2026-11-17T10:00:00Z',
    null,
    '[]'::jsonb,
    500 -- Attempted unprivileged override to 5%
  );

  -- Since caller is authenticated (not service_role/superuser), operator's 1500 bps is enforced
  IF (v_res->'b2b_settlement'->>'commission_rate_bps')::integer != 1500 THEN
    RAISE EXCEPTION 'TEST 10 FAILED: Expected operator commission 1500 bps, got %', v_res->'b2b_settlement'->>'commission_rate_bps';
  END IF;
  RAISE NOTICE 'TEST 10 PASSED: Hardened B2B commission derived from operator';
END $$;

-- TEST 11: End-to-End flow: calculate_service_quote followed by create_booking_hold with p_vehicle_category
DO $$
DECLARE
  v_quote jsonb;
  v_hold jsonb;
  v_hold_price bigint;
  v_snapshot_total bigint;
BEGIN
  -- 1. Calculate authoritative quote
  v_quote := public.calculate_service_quote(
    '55555555-5555-4555-a555-555555555555',
    '2026-11-20T10:00:00Z',
    '2026-11-23T10:00:00Z', -- 3 days = 6000 base + 999 = 6999
    'suv',
    jsonb_build_array(jsonb_build_object('extra_id', '66666666-6666-4666-a666-666666666666', 'quantity', 1))
  );

  -- 2. Create booking hold
  v_hold := public.create_booking_hold(
    p_facility_id => '44444444-4444-4444-a444-444444444444',
    p_service_id => '55555555-5555-4555-a555-555555555555',
    p_entry_at => '2026-11-20T10:00:00Z',
    p_exit_at => '2026-11-23T10:00:00Z',
    p_vehicle_id => null,
    p_customer_id => null,
    p_guest_email => 'guest.tester@aerovalet.demo',
    p_guest_name => 'Guest Tester',
    p_guest_phone => '+34600112233',
    p_vehicle_category => 'suv',
    p_selected_extras => jsonb_build_array(jsonb_build_object('extra_id', '66666666-6666-4666-a666-666666666666', 'quantity', 1))
  );

  v_hold_price := (v_hold->>'price_amount')::bigint;
  v_snapshot_total := (v_hold->'price_snapshot'->>'customer_total_amount')::bigint;

  -- 3. Verify exact parity between quote, hold price_amount, and snapshot
  IF v_hold_price != (v_quote->>'customer_total_amount')::bigint THEN
    RAISE EXCEPTION 'TEST 11 FAILED: Hold price_amount (%) does not match quote customer_total_amount (%)',
      v_hold_price, v_quote->>'customer_total_amount';
  END IF;

  IF v_hold_price != v_snapshot_total THEN
    RAISE EXCEPTION 'TEST 11 FAILED: Hold price_amount (%) does not match snapshot customer_total_amount (%)',
      v_hold_price, v_snapshot_total;
  END IF;

  RAISE NOTICE 'TEST 11 PASSED: create_booking_hold end-to-end with 100%% price and snapshot parity';
END $$;

ROLLBACK;
