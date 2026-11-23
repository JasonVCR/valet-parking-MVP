# Real Multi-Session Concurrency Test for AeroValet
# Validates PostgreSQL row-level locking (SELECT ... FOR UPDATE) and capacity exhaustion
# across two independent, simultaneous client sessions.

$ErrorActionPreference = "Stop"

$pgBin = "C:\Program Files\PostgreSQL\17\bin"
$port = "54329"
$db = "test_aerovalet"

Write-Host "════════════════════════════════════════════════════════════════════════════════"
Write-Host "AEROVALET — REAL MULTI-SESSION CONCURRENCY TEST"
Write-Host "════════════════════════════════════════════════════════════════════════════════"

# 1. Setup Isolated Test Facility with 1 sellable spot (total=1, buffer=0)
$setupSql = @"
BEGIN;
INSERT INTO public.airports (id, iata_code, name, city, country_code, timezone, active)
VALUES ('11111111-1111-4111-a111-111111111111', 'MAD', 'Adolfo Suárez Madrid-Barajas', 'Madrid', 'ES', 'Europe/Madrid', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email, role)
VALUES ('22222222-2222-4222-a222-222222222222', 'op.concurrency@aerovalet.test', 'authenticated')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.operators (id, owner_user_id, name, slug, legal_name, country_code, currency, status, platform_fee_bps)
VALUES ('33333333-3333-4333-a333-333333333333', '22222222-2222-4222-a222-222222222222', 'Valet Test SL', 'valet-test', 'Valet Test SL', 'ES', 'EUR', 'active', 1500)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.operator_tariff_sources (id, operator_id, source_name, source_type, source_url, verification_status, valid_from, valid_until)
VALUES ('77777777-7777-4777-a777-777777777771', '33333333-3333-4333-a333-333333333333', 'Web Oficial Verificada', 'official_website', 'https://valettest.es/tarifas', 'verified', '2026-01-01T00:00:00Z', '2027-12-31T23:59:59Z')
ON CONFLICT (id) DO NOTHING;

DELETE FROM public.booking_holds WHERE facility_id = '44444444-4444-4444-a444-444444444499';
DELETE FROM public.services WHERE facility_id = '44444444-4444-4444-a444-444444444499';
DELETE FROM public.facilities WHERE id = '44444444-4444-4444-a444-444444444499';

INSERT INTO public.facilities (id, operator_id, airport_id, name, address, total_capacity, operational_buffer, active)
VALUES ('44444444-4444-4444-a444-444444444499', '33333333-3333-4333-a333-333333333333', '11111111-1111-4111-a111-111111111111', 'Concurrency Test Facility (1 Spot)', 'Test Zone', 1, 0, true);

INSERT INTO public.services (id, facility_id, source_id, name, price_amount, currency, pricing_unit, active)
VALUES ('55555555-5555-4555-a555-555555555599', '44444444-4444-4444-a444-444444444499', '77777777-7777-4777-a777-777777777771', 'Valet Concurrency', 3000, 'EUR', 'per_day', true);
COMMIT;
"@

$setupFile = "$env:TEMP\concurrency_setup.sql"
Set-Content -Path $setupFile -Value $setupSql
& "$pgBin\psql.exe" -p $port -U postgres -d $db -v ON_ERROR_STOP=1 -f $setupFile
if ($LASTEXITCODE -ne 0) { throw "Failed to set up concurrency test fixtures" }

# 2. Get authoritative quote
$quoteJson = & "$pgBin\psql.exe" -p $port -U postgres -d $db -t -A -c "SELECT public.calculate_service_quote('55555555-5555-4555-a555-555555555599', '2026-11-28T10:00:00Z', '2026-11-30T10:00:00Z');"
$expectedAmount = (& "$pgBin\psql.exe" -p $port -U postgres -d $db -t -A -c "SELECT (public.calculate_service_quote('55555555-5555-4555-a555-555555555599', '2026-11-28T10:00:00Z', '2026-11-30T10:00:00Z')->>'customer_total_amount')::bigint;").Trim()
Write-Host "Authoritative quote for test service: $expectedAmount cents (2 days * 3000 + 800 + 199 = 6999)"

# 3. Create SQL payloads for Client Alpha and Client Beta
$templateSql = @'
\set ON_ERROR_STOP off
SELECT clock_timestamp() AS start_time, pg_backend_pid() AS session_pid;
DO $$
DECLARE
  v_hold jsonb;
BEGIN
  v_hold := public.create_booking_hold(
    p_facility_id => '44444444-4444-4444-a444-444444444499',
    p_service_id => '55555555-5555-4555-a555-555555555599',
    p_entry_at => '2026-11-28T10:00:00Z',
    p_exit_at => '2026-11-30T10:00:00Z',
    p_guest_email => '__CLIENT_EMAIL__',
    p_guest_name => '__CLIENT_NAME__',
    p_expected_total_amount => __EXPECTED_AMOUNT__
  );
  RAISE NOTICE '__CLIENT_TAG___RESULT: HOLD_SUCCESS hold_id=%', v_hold->>'hold_id';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '__CLIENT_TAG___RESULT: ERROR % (code %)', SQLERRM, SQLSTATE;
END $$;
SELECT clock_timestamp() AS end_time;
'@

$alphaSql = $templateSql.Replace("__CLIENT_EMAIL__", "client.alpha@aerovalet.demo").Replace("__CLIENT_NAME__", "Client Alpha").Replace("__CLIENT_TAG__", "SESSION_ALPHA").Replace("__EXPECTED_AMOUNT__", $expectedAmount)

$betaSql = $templateSql.Replace("__CLIENT_EMAIL__", "client.beta@aerovalet.demo").Replace("__CLIENT_NAME__", "Client Beta").Replace("__CLIENT_TAG__", "SESSION_BETA").Replace("__EXPECTED_AMOUNT__", $expectedAmount)

$alphaFile = "$env:TEMP\client_alpha.sql"
$betaFile = "$env:TEMP\client_beta.sql"
$alphaLog = "$env:TEMP\client_alpha.log"
$betaLog = "$env:TEMP\client_beta.log"

Set-Content -Path $alphaFile -Value $alphaSql
Set-Content -Path $betaFile -Value $betaSql
if (Test-Path $alphaLog) { Remove-Item $alphaLog }
if (Test-Path $betaLog) { Remove-Item $betaLog }

Write-Host "Launching 2 independent PostgreSQL sessions simultaneously..."

# Launch both independent psql processes in parallel
$procAlpha = Start-Process -FilePath "$pgBin\psql.exe" `
  -ArgumentList "-p $port -U postgres -d $db -f `"$alphaFile`"" `
  -RedirectStandardOutput $alphaLog -RedirectStandardError "$env:TEMP\client_alpha_err.log" `
  -PassThru

$procBeta = Start-Process -FilePath "$pgBin\psql.exe" `
  -ArgumentList "-p $port -U postgres -d $db -f `"$betaFile`"" `
  -RedirectStandardOutput $betaLog -RedirectStandardError "$env:TEMP\client_beta_err.log" `
  -PassThru

# Wait for both processes to complete
$procAlpha.WaitForExit()
$procBeta.WaitForExit()

Write-Host "Both client sessions completed."

# Read output logs (both stdout and stderr, since psql RAISE NOTICE prints to stderr)
$outAlpha = (Get-Content -Path $alphaLog -Raw -ErrorAction SilentlyContinue) + "`n" + (Get-Content -Path "$env:TEMP\client_alpha_err.log" -Raw -ErrorAction SilentlyContinue)
$outBeta = (Get-Content -Path $betaLog -Raw -ErrorAction SilentlyContinue) + "`n" + (Get-Content -Path "$env:TEMP\client_beta_err.log" -Raw -ErrorAction SilentlyContinue)

Write-Host "--- CLIENT ALPHA LOG (PID $($procAlpha.Id)) ---"
Write-Host $outAlpha
Write-Host "--- CLIENT BETA LOG (PID $($procBeta.Id)) ---"
Write-Host $outBeta

# Analyze results
$alphaSuccess = $outAlpha -match "HOLD_SUCCESS"
$betaSuccess = $outBeta -match "HOLD_SUCCESS"

$alphaExhausted = $outAlpha -match "CAPACITY_EXHAUSTED"
$betaExhausted = $outBeta -match "CAPACITY_EXHAUSTED"

Write-Host "--- CONCURRENCY ANALYSIS ---"
Write-Host "Client Alpha Success: $alphaSuccess, Exhausted: $alphaExhausted"
Write-Host "Client Beta Success: $betaSuccess, Exhausted: $betaExhausted"

if (($alphaSuccess -and $betaExhausted) -or ($betaSuccess -and $alphaExhausted)) {
  Write-Host ">>> MUTUAL EXCLUSION CONFIRMED: Exactly 1 session succeeded, exactly 1 session was rejected with CAPACITY_EXHAUSTED! <<<" -ForegroundColor Green
} else {
  throw "CONCURRENCY FAILURE: Expected exactly one success and one CAPACITY_EXHAUSTED"
}

# Verify database state in third independent session
$activeHolds = (& "$pgBin\psql.exe" -p $port -U postgres -d $db -t -A -c "SELECT count(*) FROM public.booking_holds WHERE facility_id = '44444444-4444-4444-a444-444444444499' AND status = 'active';").Trim()
Write-Host "Active holds count in PostgreSQL for facility: $activeHolds"

if ($activeHolds -eq "1") {
  Write-Host ">>> PERSISTED STATE CONFIRMED: Exactly 1 active hold remains in database! No overbooking! <<<" -ForegroundColor Green
} else {
  throw "CONCURRENCY STATE FAILURE: Expected 1 active hold in database, found $activeHolds"
}

# Clean up
& "$pgBin\psql.exe" -p $port -U postgres -d $db -c @"
DELETE FROM public.booking_holds WHERE facility_id = '44444444-4444-4444-a444-444444444499';
DELETE FROM public.services WHERE facility_id = '44444444-4444-4444-a444-444444444499';
DELETE FROM public.facilities WHERE id = '44444444-4444-4444-a444-444444444499';
"@ | Out-Null

Write-Host "════════════════════════════════════════════════════════════════════════════════"
Write-Host "REAL MULTI-SESSION CONCURRENCY TEST PASSED 100%!"
Write-Host "════════════════════════════════════════════════════════════════════════════════"
