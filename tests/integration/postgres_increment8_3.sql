-- Integration Test Suite for AeroValet PostgreSQL Database (Increment 8.3)
-- Covers:
-- 1. Anonymous read of commercial_inquiries strictly denied (insufficient_privilege)
-- 2. Authenticated user cannot read commercial_inquiries of others (insufficient_privilege)
-- 3. submit_commercial_inquiry RPC creates/upserts idempotently and returns ONLY UUID
-- 4. Tariff bands with review_status = 'pending_review' are rejected by calculate_service_quote
-- 5. Tariff bands with review_status = 'stale' or 'flagged_ambiguous' are rejected by calculate_service_quote
-- 6. Real persistence into market_candidates and market_candidate_tariff_bands via ingest_market_candidate
-- 7. Atomic rollback of ingestion RPC when any stage fails

\set ON_ERROR_STOP on

BEGIN;

-- Seed base fixtures
INSERT INTO public.airports (id, iata_code, name, city, country_code, timezone, active)
VALUES ('11111111-1111-4111-a111-111111111111', 'MAD', 'Adolfo Suárez Madrid-Barajas', 'Madrid', 'ES', 'Europe/Madrid', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email, role)
VALUES ('22222222-2222-4222-a222-222222222222', 'op.owner@aerovalet.test', 'authenticated')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.operators (id, owner_user_id, name, slug, legal_name, country_code, currency, status, platform_fee_bps)
VALUES ('33333333-3333-4333-a333-333333333333', '22222222-2222-4222-a222-222222222222', 'Valet Test SL', 'valet-test', 'Valet Test SL', 'ES', 'EUR', 'active', 1500)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.facilities (id, operator_id, airport_id, name, address, total_capacity, operational_buffer, modality, active)
VALUES ('44444444-4444-4444-a444-444444444444', '33333333-3333-4333-a333-333333333333', '11111111-1111-4111-a111-111111111111', 'Parking VIP T4', 'Terminal 4 Salidas', 50, 5, 'valet', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.operator_tariff_sources (id, operator_id, source_name, source_type, source_url, verification_status, valid_from, valid_until)
VALUES ('77777777-7777-4777-a777-777777777771', '33333333-3333-4333-a333-333333333333', 'Web Oficial Verificada', 'official_website', 'https://valettest.es/tarifas', 'verified', '2026-01-01T00:00:00Z', '2027-12-31T23:59:59Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.services (id, facility_id, source_id, name, description, price_amount, currency, pricing_unit, active)
VALUES ('55555555-5555-4555-a555-555555555555', '44444444-4444-4444-a444-444444444444', null, 'Valet Solo Bandas', 'Sin tarifa diaria fallback', 0, 'EUR', 'per_day', true)
ON CONFLICT (id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════════
-- TEST 1 & 2 & 3: Commercial Inquiries Privacy (anon & authenticated denied SELECT)
-- ═══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_id1 uuid;
  v_id2 uuid;
  v_denied boolean := false;
BEGIN
  -- Create inquiry via secure server RPC as anon
  SET LOCAL ROLE anon;
  v_id1 := public.submit_commercial_inquiry(
    p_facility_id => '44444444-4444-4444-a444-444444444444',
    p_entry_at => '2026-12-10T10:00:00Z',
    p_exit_at => '2026-12-12T10:00:00Z',
    p_idempotency_key => '83-test-idempotency-key-0001',
    p_contact_name => 'Persona Privada',
    p_contact_email => 'privado@aerovalet.test',
    p_contact_phone => '+34600999888',
    p_notes => 'Nota confidencial'
  );

  -- Idempotent second call returns exact same UUID
  v_id2 := public.submit_commercial_inquiry(
    p_facility_id => '44444444-4444-4444-a444-444444444444',
    p_entry_at => '2026-12-10T10:00:00Z',
    p_exit_at => '2026-12-12T10:00:00Z',
    p_idempotency_key => '83-test-idempotency-key-0001',
    p_contact_name => 'Persona Privada',
    p_contact_email => 'privado@aerovalet.test'
  );

  IF v_id1 IS NULL OR v_id1 != v_id2 THEN
    RAISE EXCEPTION 'TEST 3 FAILED: submit_commercial_inquiry did not preserve idempotency (% vs %)', v_id1, v_id2;
  END IF;

  -- Test 1: anon SELECT MUST fail with insufficient_privilege
  v_denied := false;
  BEGIN
    PERFORM * FROM public.commercial_inquiries;
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;

  IF NOT v_denied THEN
    RAISE EXCEPTION 'TEST 1 FAILED: anon was allowed to SELECT commercial_inquiries';
  END IF;
  RAISE NOTICE 'TEST 1 PASSED: anon SELECT on commercial_inquiries strictly denied';

  -- Test 2: authenticated SELECT MUST fail with insufficient_privilege
  RESET ROLE;
  SET LOCAL ROLE authenticated;
  v_denied := false;
  BEGIN
    PERFORM * FROM public.commercial_inquiries;
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;

  IF NOT v_denied THEN
    RAISE EXCEPTION 'TEST 2 FAILED: authenticated was allowed to SELECT commercial_inquiries';
  END IF;
  RAISE NOTICE 'TEST 2 PASSED: authenticated SELECT on commercial_inquiries strictly denied';

  RESET ROLE;
  RAISE NOTICE 'TEST 3 PASSED: submit_commercial_inquiry RPC preserves idempotency and returns only UUID';
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- TEST 4 & 5: Tariff bands pending_review, stale, flagged_ambiguous rejected
-- ═══════════════════════════════════════════════════════════════════════════════
INSERT INTO public.service_tariff_bands (id, service_id, source_id, name, min_duration_hours, max_duration_hours, price_amount, currency, pricing_unit, active, review_status, evidence_snippet)
VALUES
  ('99999999-9999-4999-a999-999999999901', '55555555-5555-4555-a555-555555555555', '77777777-7777-4777-a777-777777777771', 'Banda Pending', 0, 48, 2200, 'EUR', 'flat_stay', true, 'pending_review', 'Pendiente'),
  ('99999999-9999-4999-a999-999999999902', '55555555-5555-4555-a555-555555555555', '77777777-7777-4777-a777-777777777771', 'Banda Stale', 49, 72, 3300, 'EUR', 'flat_stay', true, 'stale', 'Caducada'),
  ('99999999-9999-4999-a999-999999999903', '55555555-5555-4555-a555-555555555555', '77777777-7777-4777-a777-777777777771', 'Banda Ambiguous', 73, 96, 4400, 'EUR', 'flat_stay', true, 'flagged_ambiguous', 'Ambigua');

DO $$
DECLARE
  v_rejected boolean;
BEGIN
  -- 4a: pending_review (24h)
  v_rejected := false;
  BEGIN
    PERFORM public.calculate_service_quote('55555555-5555-4555-a555-555555555555', '2026-12-10T10:00:00Z', '2026-12-11T10:00:00Z');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%NO_VERIFIED_TARIFF_SOURCE%' THEN v_rejected := true; END IF;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'TEST 4 FAILED: pending_review band generated a quote'; END IF;
  RAISE NOTICE 'TEST 4 PASSED: pending_review band rejected by calculate_service_quote';

  -- 5a: stale (60h)
  v_rejected := false;
  BEGIN
    PERFORM public.calculate_service_quote('55555555-5555-4555-a555-555555555555', '2026-12-10T10:00:00Z', '2026-12-12T22:00:00Z');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%NO_VERIFIED_TARIFF_SOURCE%' THEN v_rejected := true; END IF;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'TEST 5a FAILED: stale band generated a quote'; END IF;

  -- 5b: flagged_ambiguous (80h)
  v_rejected := false;
  BEGIN
    PERFORM public.calculate_service_quote('55555555-5555-4555-a555-555555555555', '2026-12-10T10:00:00Z', '2026-12-13T18:00:00Z');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%NO_VERIFIED_TARIFF_SOURCE%' THEN v_rejected := true; END IF;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'TEST 5b FAILED: flagged_ambiguous band generated a quote'; END IF;

  -- 5c: Excess duration over a verified band must NOT fallback to 2000c/day when service has no verified daily rate
  INSERT INTO public.service_tariff_bands (id, service_id, source_id, name, min_duration_hours, max_duration_hours, price_amount, currency, pricing_unit, active, review_status, evidence_snippet)
  VALUES ('99999999-9999-4999-a999-999999999904', '55555555-5555-4555-a555-555555555555', '77777777-7777-4777-a777-777777777771', 'Banda Verificada 1d', 0, 24, 2500, 'EUR', 'flat_stay', true, 'verified', '1 día 25 EUR');

  v_rejected := false;
  BEGIN
    -- 120h exceeds 24h max_duration_hours, and service has no verified source_id -> must reject
    PERFORM public.calculate_service_quote('55555555-5555-4555-a555-555555555555', '2026-12-10T10:00:00Z', '2026-12-15T10:00:00Z');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%NO_VERIFIED_TARIFF_SOURCE%' THEN v_rejected := true; END IF;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'TEST 5c FAILED: excess stay used fallback price instead of failing closed'; END IF;

  RAISE NOTICE 'TEST 5 PASSED: stale, flagged_ambiguous, and unverified excess stay strictly rejected';
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- TEST 6 & 7: Transactional market_candidates ingestion & rollback on failure
-- ═══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_cand_id uuid;
  v_band_count integer;
  v_op_count_before integer;
  v_op_count_after integer;
  v_cand_count_before integer;
  v_cand_count_after integer;
  v_err boolean := false;
BEGIN
  SELECT count(*) INTO v_op_count_before FROM public.operators;

  v_cand_id := public.ingest_market_candidate(jsonb_build_object(
    'domain', 'parkingrealmad.es',
    'company_name', 'Parking Real Madrid SL',
    'airport_iata', 'MAD',
    'modality', 'valet',
    'source_url', 'https://parkingrealmad.es/tarifas',
    'discovery_provider', 'GoogleCustomSearchProvider',
    'content_hash', repeat('a', 64),
    'review_status', 'pending_review',
    'tariff_bands', jsonb_build_array(
      jsonb_build_object(
        'name', '1 Día',
        'min_duration_hours', 0,
        'max_duration_hours', 24,
        'price_amount', 2100,
        'currency', 'EUR',
        'pricing_unit', 'flat_stay',
        'evidence_snippet', '1 día: 21 EUR'
      )
    )
  ));

  SELECT count(*) INTO v_op_count_after FROM public.operators;
  IF v_op_count_after != v_op_count_before THEN
    RAISE EXCEPTION 'TEST 6 FAILED: ingest_market_candidate must NOT create active operators directly';
  END IF;

  SELECT count(*) INTO v_band_count FROM public.market_candidate_tariff_bands WHERE candidate_id = v_cand_id;
  IF v_band_count != 1 THEN
    RAISE EXCEPTION 'TEST 6 FAILED: expected 1 candidate tariff band, got %', v_band_count;
  END IF;
  RAISE NOTICE 'TEST 6 PASSED: market_candidates persisted transactionally without creating active operator';

  -- Test 7: Atomic rollback when band stage fails (negative price_amount violates CHECK price_amount > 0)
  SELECT count(*) INTO v_cand_count_before FROM public.market_candidates;
  BEGIN
    PERFORM public.ingest_market_candidate(jsonb_build_object(
      'domain', 'rollbacktest.es',
      'company_name', 'Rollback Test',
      'airport_iata', 'MAD',
      'modality', 'shuttle',
      'source_url', 'https://rollbacktest.es/tarifas',
      'discovery_provider', 'GoogleCustomSearchProvider',
      'content_hash', repeat('b', 64),
      'review_status', 'pending_review',
      'tariff_bands', jsonb_build_array(
        jsonb_build_object(
          'name', 'Banda Invalida',
          'min_duration_hours', 0,
          'max_duration_hours', 24,
          'price_amount', -500,
          'currency', 'EUR',
          'pricing_unit', 'flat_stay',
          'evidence_snippet', 'Invalido'
        )
      )
    ));
  EXCEPTION WHEN OTHERS THEN
    v_err := true;
  END;

  IF NOT v_err THEN
    RAISE EXCEPTION 'TEST 7 FAILED: expected exception on invalid band';
  END IF;

  SELECT count(*) INTO v_cand_count_after FROM public.market_candidates;
  IF v_cand_count_after != v_cand_count_before THEN
    RAISE EXCEPTION 'TEST 7 FAILED: candidate row was not rolled back after band failure';
  END IF;
  RAISE NOTICE 'TEST 7 PASSED: ingestion RPC rolled back atomically on band failure';
END $$;

ROLLBACK;
