$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Root = Split-Path -Parent $PSScriptRoot
$ConfigPath = Join-Path $PSScriptRoot 'install.config.ps1'
if (-not (Test-Path $ConfigPath)) { throw 'deployment/install.config.ps1 not found.' }
. $ConfigPath

function Secure-ToPlain([Security.SecureString]$Secure) {
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Invoke-External([string]$What, [scriptblock]$Action) {
  Write-Host "> $What"
  & $Action
  if ($LASTEXITCODE -ne 0) { throw "$What failed with exit code $LASTEXITCODE" }
}


function Write-Utf8NoBom([string]$Path, [string]$Text) {
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Text, $enc)
}

function New-Shop62Token {
  $bytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  # Hex avoids header/JSON/base64url transport ambiguity across PowerShell, Wrangler and Node.
  return (($bytes | ForEach-Object { $_.ToString('x2') }) -join '')
}

$SupabaseUrl = ([string]$SupabaseUrl).Trim()
$SupabasePublishableKey = ([string]$SupabasePublishableKey).Trim()
if (-not $SupabaseUrl -or $SupabaseUrl -notmatch '^https://') { throw 'SupabaseUrl is not configured.' }
if (-not $SupabasePublishableKey) { throw 'SupabasePublishableKey is not configured.' }
if (-not $R2BucketName) { $R2BucketName = 'amphon-product-images' }

Write-Host ''
Write-Host '================================================================'
Write-Host 'SHOP-6.2 - isolated Stripe TEST provider E2E'
Write-Host '================================================================'
Write-Host 'This does NOT deploy over the production API Worker.'
Write-Host 'This does NOT enable purchase_enabled.'
Write-Host 'Stripe sk_live_ keys are rejected.'

$sbSecure = Read-Host 'Supabase Secret key (sb_secret_... / server only)' -AsSecureString
$stripeSecure = Read-Host 'Stripe TEST secret key (sk_test_...)' -AsSecureString
$SupabaseSecret = Secure-ToPlain $sbSecure
$StripeSecret = Secure-ToPlain $stripeSecure
if ($StripeSecret -notmatch '^sk_test_') { throw 'SHOP-6.2 requires a Stripe TEST secret beginning with sk_test_.' }
if (-not $SupabaseSecret) { throw 'Supabase server secret is required.' }

$Token = New-Shop62Token
$WorkerName = 'amphon-shop62-e2e'
$WorkerDir = Join-Path $Root 'workers/r2-upload'
$WranglerPath = Join-Path $WorkerDir '.shop62-e2e.wrangler.jsonc'
$SecretsPath = Join-Path $env:TEMP ("amphon-shop62-secrets-{0}.json" -f ([guid]::NewGuid().ToString('N')))
$WebhookId = $null
$WebhookSecret = $null
$WorkerUrl = $null

$wrangler = [ordered]@{
  '$schema' = 'node_modules/wrangler/config-schema.json'
  name = $WorkerName
  main = 'src/index.ts'
  compatibility_date = '2026-09-12'
  workers_dev = $true
  vars = [ordered]@{
    SUPABASE_URL = $SupabaseUrl
    SUPABASE_PUBLISHABLE_KEY = $SupabasePublishableKey
    ALLOWED_ORIGINS = '*'
    SHOP62_TEST_MODE = 'isolated-e2e'
  }
  r2_buckets = @(@{ binding='IMAGES'; bucket_name=$R2BucketName })
}
Write-Utf8NoBom $WranglerPath ($wrangler | ConvertTo-Json -Depth 8)

try {
  Push-Location $WorkerDir
  if (-not (Test-Path (Join-Path $WorkerDir 'node_modules'))) {
    Invoke-External 'npm install (Worker dependencies)' { npm install }
  }
  Invoke-External 'npx wrangler whoami' { npx wrangler whoami }
  Invoke-External 'npm run typecheck' { npm run typecheck }

  Write-Utf8NoBom $SecretsPath (@{ SUPABASE_SECRET_KEY=$SupabaseSecret; STRIPE_SECRET_KEY=$StripeSecret; SHOP62_TEST_TOKEN=$Token } | ConvertTo-Json)

  Write-Host '> Deploy isolated SHOP-6.2 Worker (first pass)'
  $savedEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $deployLines = @(& npx wrangler deploy --config $WranglerPath --secrets-file $SecretsPath 2>&1)
  $deployCode = $LASTEXITCODE
  $ErrorActionPreference = $savedEap
  $deployLines | ForEach-Object { Write-Host $_ }
  if ($deployCode -ne 0) { throw "Isolated Worker deploy failed with exit code $deployCode" }
  $deployText = ($deployLines | Out-String)
  $match = [regex]::Match($deployText, 'https://[A-Za-z0-9.-]+\.workers\.dev')
  if (-not $match.Success) { throw 'Could not detect isolated workers.dev URL from Wrangler output.' }
  $WorkerUrl = $match.Value.TrimEnd('/')
  Write-Host "Isolated Worker: $WorkerUrl"

  $env:SHOP62_STRIPE_TEST_SECRET = $StripeSecret
  $staleWebhookCleanup = & node (Join-Path $PSScriptRoot 'SHOP62-PROVIDER-E2E.mjs') cleanup-webhooks $WorkerUrl
  if ($LASTEXITCODE -ne 0) { throw 'Stale Stripe TEST webhook cleanup failed.' }
  $staleWebhookResult = $staleWebhookCleanup | ConvertFrom-Json
  if ([int]$staleWebhookResult.deleted -gt 0) {
    Write-Host "Stripe TEST webhook cleanup: removed $($staleWebhookResult.deleted) stale endpoint(s)."
  }

  $webhookRaw = & node (Join-Path $PSScriptRoot 'SHOP62-PROVIDER-E2E.mjs') create-webhook $WorkerUrl
  if ($LASTEXITCODE -ne 0) { throw 'Stripe TEST webhook creation failed.' }
  $webhook = $webhookRaw | ConvertFrom-Json
  $WebhookId = [string]$webhook.id
  $WebhookSecret = [string]$webhook.secret
  if (-not $WebhookId -or -not $WebhookSecret) { throw 'Stripe TEST webhook did not return id/secret.' }
  Write-Host 'Stripe TEST webhook: created.'

  Write-Utf8NoBom $SecretsPath (@{ SUPABASE_SECRET_KEY=$SupabaseSecret; STRIPE_SECRET_KEY=$StripeSecret; STRIPE_WEBHOOK_SECRET=$WebhookSecret; SHOP62_TEST_TOKEN=$Token } | ConvertTo-Json)

  Write-Host '> Redeploy isolated Worker with webhook signing secret'
  & npx wrangler deploy --config $WranglerPath --secrets-file $SecretsPath
  if ($LASTEXITCODE -ne 0) { throw "Isolated Worker redeploy failed with exit code $LASTEXITCODE" }

  $secretListRaw = (& npx wrangler secret list --config $WranglerPath --name $WorkerName --format json 2>$null | Out-String)
  if ($LASTEXITCODE -ne 0) { throw 'Could not verify isolated Worker secret binding names.' }
  $isolatedSecretNames = @($secretListRaw | ConvertFrom-Json | ForEach-Object { $_.name })
  foreach ($requiredName in @('SUPABASE_SECRET_KEY','STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','SHOP62_TEST_TOKEN')) {
    if ($isolatedSecretNames -notcontains $requiredName) { throw "Isolated Worker secret binding missing: $requiredName" }
  }
  Write-Host 'Isolated Worker secret binding names: PASS (values were not read).'

  $env:SHOP62_SUPABASE_URL = $SupabaseUrl
  $env:SHOP62_SUPABASE_SECRET = $SupabaseSecret
  $env:SHOP62_STRIPE_TEST_SECRET = $StripeSecret
  $env:SHOP62_STRIPE_WEBHOOK_SECRET = $WebhookSecret
  $env:SHOP62_WORKER_URL = $WorkerUrl
  $env:SHOP62_TEST_TOKEN = $Token

  Pop-Location
  Push-Location $Root
  Invoke-External 'SHOP-6.2 Stripe TEST provider matrix' { node (Join-Path $PSScriptRoot 'SHOP62-PROVIDER-E2E.mjs') run }

  Write-Host ''
  Write-Host 'SHOP-6.2 PROVIDER ACCEPTANCE: PASS'
  Write-Host 'purchase_enabled remains FALSE by design.'
  Write-Host 'Next: review LIVE Stripe secret/webhook + production settings, then explicitly activate checkout.'
}
finally {
  try {
    if ($WebhookId) {
      $env:SHOP62_STRIPE_TEST_SECRET = $StripeSecret
      $deletedRaw = & node (Join-Path $PSScriptRoot 'SHOP62-PROVIDER-E2E.mjs') delete-webhook $WebhookId
      if ($LASTEXITCODE -ne 0) { throw 'Stripe TEST webhook deletion failed.' }
      $deleted = $deletedRaw | ConvertFrom-Json
      if ([string]$deleted.deleted -ne $WebhookId) { throw 'Stripe TEST webhook deletion could not be verified.' }
      Write-Host 'Stripe TEST webhook cleanup: VERIFIED.'
    }
  } catch { Write-Warning "Stripe webhook cleanup failed: $($_.Exception.Message)" }
  try {
    Push-Location $WorkerDir
    & npx wrangler delete $WorkerName --force 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Isolated Worker deletion failed.' }
    $savedEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $deletedWorkerLookup = (& npx wrangler deployments list --name $WorkerName --json 2>&1 | Out-String)
    $deletedWorkerLookupCode = $LASTEXITCODE
    $ErrorActionPreference = $savedEap
    if ($deletedWorkerLookupCode -eq 0 -or $deletedWorkerLookup -notmatch 'not found|does not exist|10090') {
      throw 'Isolated Worker absence could not be verified.'
    }
    Pop-Location
    Write-Host 'Isolated Worker cleanup: VERIFIED.'
  } catch { try { Pop-Location } catch {}; Write-Warning "Isolated Worker cleanup failed: $($_.Exception.Message)" }
  Remove-Item $SecretsPath -Force -ErrorAction SilentlyContinue
  Remove-Item $WranglerPath -Force -ErrorAction SilentlyContinue
  foreach ($name in @('SHOP62_SUPABASE_URL','SHOP62_SUPABASE_SECRET','SHOP62_STRIPE_TEST_SECRET','SHOP62_STRIPE_WEBHOOK_SECRET','SHOP62_WORKER_URL','SHOP62_TEST_TOKEN')) {
    Remove-Item ("Env:" + $name) -ErrorAction SilentlyContinue
  }
  $SupabaseSecret = $null
  $StripeSecret = $null
  $WebhookSecret = $null
}
