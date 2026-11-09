-- Verification of permissions for calculate_service_quote and create_booking_hold
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'unauthorized_role') THEN
    CREATE ROLE unauthorized_role NOLOGIN;
  END IF;
END $$;

-- Switch to unauthorized role
SET ROLE unauthorized_role;

DO $$
DECLARE
  v_denied boolean := false;
BEGIN
  BEGIN
    PERFORM public.calculate_service_quote('55555555-5555-4555-a555-555555555555', now(), now() + interval '1 day');
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;

  IF NOT v_denied THEN
    RAISE EXCEPTION 'TEST PERMISSIONS FAILED: unauthorized_role was allowed to execute calculate_service_quote';
  END IF;
  RAISE NOTICE 'PERMISSION TEST 1 PASSED: unauthorized_role denied calculate_service_quote';
END $$;

DO $$
DECLARE
  v_denied boolean := false;
BEGIN
  BEGIN
    PERFORM public.create_booking_hold(
      p_facility_id => '44444444-4444-4444-a444-444444444444',
      p_service_id => '55555555-5555-4555-a555-555555555555',
      p_entry_at => now(),
      p_exit_at => now() + interval '1 day'
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;

  IF NOT v_denied THEN
    RAISE EXCEPTION 'TEST PERMISSIONS FAILED: unauthorized_role was allowed to execute create_booking_hold';
  END IF;
  RAISE NOTICE 'PERMISSION TEST 2 PASSED: unauthorized_role denied create_booking_hold';
END $$;

RESET ROLE;

-- Switch to anon role (should have permission to execute)
SET ROLE anon;
DO $$
BEGIN
  -- calculate_service_quote should be callable by anon (raising NOT_FOUND or validating input rather than insufficient_privilege)
  BEGIN
    PERFORM public.calculate_service_quote('55555555-5555-4555-a555-555555555555', now(), now() + interval '1 day');
  EXCEPTION 
    WHEN insufficient_privilege THEN
      RAISE EXCEPTION 'TEST PERMISSIONS FAILED: anon denied execution';
    WHEN OTHERS THEN
      -- Any other exception (e.g. SERVICE_NOT_AVAILABLE, DURATION_TOO_SHORT) means execution privilege succeeded
      NULL;
  END;
  RAISE NOTICE 'PERMISSION TEST 3 PASSED: anon granted execution privilege';
END $$;

RESET ROLE;

-- Switch to authenticated role (should have permission to execute)
SET ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM public.calculate_service_quote('55555555-5555-4555-a555-555555555555', now(), now() + interval '1 day');
  EXCEPTION 
    WHEN insufficient_privilege THEN
      RAISE EXCEPTION 'TEST PERMISSIONS FAILED: authenticated denied execution';
    WHEN OTHERS THEN
      NULL;
  END;
  RAISE NOTICE 'PERMISSION TEST 4 PASSED: authenticated granted execution privilege';
END $$;

RESET ROLE;

ROLLBACK;
