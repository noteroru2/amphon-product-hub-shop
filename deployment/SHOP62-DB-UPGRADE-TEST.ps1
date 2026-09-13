$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Root = Split-Path -Parent $PSScriptRoot
$ConfigPath = Join-Path $PSScriptRoot 'install.config.ps1'
if (-not (Test-Path $ConfigPath)) { throw 'deployment/install.config.ps1 not found. Copy install.config.example.ps1 and fill it first.' }
. $ConfigPath

function Invoke-Step([string]$What, [scriptblock]$Action) {
  Write-Host "> $What"
  & $Action
  if ($LASTEXITCODE -ne 0) { throw "$What failed with exit code $LASTEXITCODE" }
}

function Secure-ToPlain([Security.SecureString]$Secure) {
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Connect-SupabaseDatabaseWithRetry {
  param(
    [Parameter(Mandatory=$true)][string]$ProjectRef,
    [int]$MaxAttempts = 3
  )

  Invoke-Step "npx supabase@latest link --project-ref $ProjectRef" { npx supabase@latest link --project-ref $ProjectRef }

  for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    $dbSecure = Read-Host "Supabase DATABASE password (attempt $attempt/$MaxAttempts)" -AsSecureString
    $dbPassword = Secure-ToPlain $dbSecure
    $env:SUPABASE_DB_PASSWORD = $dbPassword

    try {
      Write-Host '> Verifying database authentication with migration list...'
      & npx supabase@latest migration list --linked
      if ($LASTEXITCODE -eq 0) {
        Write-Host 'Supabase database authentication - PASS'
        return
      }
    }
    finally {
      $dbPassword = $null
    }

    if ($attempt -lt $MaxAttempts) {
      Write-Host ''
      Write-Host 'Database authentication did not succeed.' -ForegroundColor Yellow
      Write-Host 'Use the project DATABASE password, not your Supabase account password, API key, access token, publishable key, or secret key.' -ForegroundColor Yellow
      Write-Host 'If you recently reset the database password, enter the NEW password.' -ForegroundColor Yellow
      Write-Host ''
    }
  }

  throw 'Supabase database authentication failed after 3 attempts. Reset or confirm the database password in the Supabase Dashboard (Database settings), then rerun SHOP62-DB-UPGRADE-TEST.bat.'
}

if (-not $SupabaseProjectRef -or $SupabaseProjectRef -eq 'YOUR_PROJECT_REF') { throw 'SupabaseProjectRef is not configured.' }

Write-Host ''
Write-Host '================================================================'
Write-Host 'SHOP-6.2 - database upgrade + rollback-safe contract acceptance'
Write-Host '================================================================'
Write-Host 'Public purchase will remain disabled.'

Invoke-Step 'node --version' { node --version }
Invoke-Step 'npm --version' { npm --version }

try {
  Push-Location $Root
  Connect-SupabaseDatabaseWithRetry -ProjectRef $SupabaseProjectRef -MaxAttempts 3

  Invoke-Step 'npx supabase@latest db push --linked --include-all' { npx supabase@latest db push --linked --include-all }

  $contract = Join-Path $Root 'supabase/shop_6_2_contract_test.sql'
  $verify = Join-Path $Root 'supabase/shop_6_2_verify.sql'
  Invoke-Step 'SHOP-6.2 rollback-safe DB contract test' { npx supabase@latest db query --linked -f $contract }
  Invoke-Step 'SHOP-6.2 DB readiness verify' { npx supabase@latest db query --linked -f $verify }

  Push-Location (Join-Path $Root 'shop')
  Invoke-Step 'npm run verify:shop62' { npm run verify:shop62 }
  Pop-Location

  Write-Host ''
  Write-Host 'SHOP-6.2 DATABASE UPGRADE + CONTRACT ACCEPTANCE: PASS'
  Write-Host 'NEXT: configure intended Commerce settings with purchase_enabled=false, then run SHOP62-PROVIDER-E2E.bat'
}
finally {
  if ((Get-Location).Path -ne $Root) { try { Pop-Location } catch {} }
  Remove-Item Env:SUPABASE_DB_PASSWORD -ErrorAction SilentlyContinue
}
