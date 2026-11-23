$ErrorActionPreference = "Stop"

$pgBin = "C:\Program Files\PostgreSQL\17\bin"
$pgData = "$env:TEMP\pg_test"
$port = "54329"

Write-Host "Starting PostgreSQL on port $port..."
& "$pgBin\pg_ctl.exe" -D $pgData -o "-p $port" -l "$env:TEMP\pg_test.log" start
Start-Sleep -Seconds 2

try {
    Write-Host "Recreating database test_aerovalet..."
    & "$pgBin\psql.exe" -p $port -U postgres -d postgres -c "DROP DATABASE IF EXISTS test_aerovalet;"
    & "$pgBin\psql.exe" -p $port -U postgres -d postgres -c "CREATE DATABASE test_aerovalet;"

    Write-Host "Applying Supabase Auth mock bootstrap..."
    & "$pgBin\psql.exe" -p $port -U postgres -d test_aerovalet -v ON_ERROR_STOP=1 -f "tests/integration/bootstrap_supabase_mock.sql"
    if ($LASTEXITCODE -ne 0) { throw "Bootstrap failed" }

    $migrations = Get-ChildItem -Path "supabase/migrations" -Filter "*.sql" | Sort-Object Name
    foreach ($m in $migrations) {
        Write-Host "Applying migration: $($m.Name)..."
        & "$pgBin\psql.exe" -p $port -U postgres -d test_aerovalet -v ON_ERROR_STOP=1 -f $m.FullName
        if ($LASTEXITCODE -ne 0) { throw "Migration $($m.Name) failed" }
    }
    Write-Host "All 9 migrations applied successfully!"

    Write-Host "Running postgres_permissions.sql..."
    & "$pgBin\psql.exe" -p $port -U postgres -d test_aerovalet -v ON_ERROR_STOP=1 -f "tests/integration/postgres_permissions.sql"
    if ($LASTEXITCODE -ne 0) { throw "postgres_permissions.sql failed" }

    Write-Host "Running postgres_quote_and_hold.sql..."
    & "$pgBin\psql.exe" -p $port -U postgres -d test_aerovalet -v ON_ERROR_STOP=1 -f "tests/integration/postgres_quote_and_hold.sql"
    if ($LASTEXITCODE -ne 0) { throw "postgres_quote_and_hold.sql failed" }

    Write-Host "Running postgres_increment8.sql..."
    & "$pgBin\psql.exe" -p $port -U postgres -d test_aerovalet -v ON_ERROR_STOP=1 -f "tests/integration/postgres_increment8.sql"
    if ($LASTEXITCODE -ne 0) { throw "postgres_increment8.sql failed" }

    Write-Host "ALL POSTGRESQL INTEGRATION TESTS PASSED!"
} finally {
    Write-Host "Stopping PostgreSQL..."
    & "$pgBin\pg_ctl.exe" -D $pgData stop
}
