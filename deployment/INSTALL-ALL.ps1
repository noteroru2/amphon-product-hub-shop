[CmdletBinding()]
param(
  [switch]$DatabaseOnly,
  [switch]$ResumeFromCloudflare,
  [string]$ConfigPath = ""
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Write-Step([string]$Message) {
  Write-Host ""
  Write-Host "================================================================" -ForegroundColor DarkGray
  Write-Host $Message -ForegroundColor Cyan
  Write-Host "================================================================" -ForegroundColor DarkGray
}

function Assert-LastExit([string]$What) {
  if ($LASTEXITCODE -ne 0) { throw "$What failed with exit code $LASTEXITCODE" }
}

function Invoke-External([string]$File, [string[]]$CommandArgs, [string]$What) {
  Write-Host "> $File $($CommandArgs -join ' ')" -ForegroundColor DarkGray
  & $File @CommandArgs
  Assert-LastExit $What
}

function Invoke-Capture([string]$File, [string[]]$CommandArgs, [string]$What) {
  Write-Host "> $File $($CommandArgs -join ' ')" -ForegroundColor DarkGray
  $output = & $File @CommandArgs 2>&1
  $code = $LASTEXITCODE
  $output | ForEach-Object { Write-Host $_ }
  if ($code -ne 0) { throw "$What failed with exit code $code" }
  return ($output -join "`n")
}

function Read-Secret([string]$Prompt, [switch]$Optional) {
  $secure = Read-Host $Prompt -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  }
  if (-not $Optional -and [string]::IsNullOrWhiteSpace($plain)) {
    throw "$Prompt is required."
  }
  return $plain
}

function Escape-Toml([string]$Value) {
  if ($null -eq $Value) { return '' }
  return ($Value -replace '\\','\\\\' -replace '"','\\"')
}

function Write-Utf8NoBom([string]$Path, [string]$Text) {
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($Path, $Text, $utf8)
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir
if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
  $ConfigPath = Join-Path $ScriptDir 'install.config.ps1'
}
if (-not (Test-Path $ConfigPath)) {
  $example = Join-Path $ScriptDir 'install.config.example.ps1'
  Copy-Item $example $ConfigPath -Force
  Write-Host "Created $ConfigPath" -ForegroundColor Yellow
  Write-Host "Edit the public configuration values, then run INSTALL-ALL.bat again." -ForegroundColor Yellow
  exit 2
}
. $ConfigPath

$requiredConfig = @('SupabaseProjectRef','SupabaseUrl','SupabasePublishableKey','AppUrl','ShopUrl','WorkerName','R2BucketName')
foreach ($name in $requiredConfig) {
  $value = Get-Variable -Name $name -ValueOnly -ErrorAction SilentlyContinue
  if ([string]::IsNullOrWhiteSpace([string]$value) -or ([string]$value).Contains('YOUR_')) {
    throw "deployment/install.config.ps1: `$${name} is not configured."
  }
}

# Normalize accidental leading/trailing whitespace introduced by copy/paste.
# Embedded CR/LF is still rejected because it would corrupt URLs/keys in generated env files.
foreach ($name in $requiredConfig) {
  $value = [string](Get-Variable -Name $name -ValueOnly)
  $normalized = $value.Trim()
  Set-Variable -Name $name -Value $normalized -Scope Script
  if ($normalized -match '[\r\n]') {
    throw "deployment/install.config.ps1: `$${name} contains an embedded line break. Re-paste it as one line."
  }
}

Write-Step "AMPHON SHOP-6.1 - preflight"
$nodeVersion = (& node --version 2>$null)
if ($LASTEXITCODE -ne 0) { throw 'Node.js is not installed. Install Node.js 22 first.' }
$major = [int](($nodeVersion -replace '^v','').Split('.')[0])
if ($major -lt 22) { throw "Node.js 22+ is required. Current: $nodeVersion" }
Write-Host "Node $nodeVersion - PASS" -ForegroundColor Green
Invoke-External 'npm' @('--version') 'npm preflight'

if (-not $ResumeFromCloudflare) {
  $DbPassword = Read-Secret 'Supabase database password'
  # Keep the database password out of process arguments and terminal logs.
  # Supabase CLI officially supports SUPABASE_DB_PASSWORD.
  $env:SUPABASE_DB_PASSWORD = $DbPassword

  Write-Step "1/7 - Supabase CLI login, link and ONE-SHOT database setup"
  Push-Location $Root
  try {
    if (-not (Test-Path (Join-Path $Root 'supabase/config.toml'))) {
      Invoke-External 'npx' @('supabase@latest','init','--force') 'Supabase init'
    }

    if ([string]::IsNullOrWhiteSpace($env:SUPABASE_ACCESS_TOKEN)) {
      Write-Host "Supabase CLI authentication: opening login flow..." -ForegroundColor Yellow
      Write-Host "Complete the browser login (or paste a personal access token if prompted), then return here." -ForegroundColor Yellow
      Invoke-External 'npx' @('supabase@latest','login') 'Supabase login'
    } else {
      Write-Host "SUPABASE_ACCESS_TOKEN detected. Skipping interactive Supabase login." -ForegroundColor Green
    }

    Invoke-External 'npx' @('supabase@latest','link','--project-ref',$SupabaseProjectRef) 'Supabase link'

    # One migration contains the complete AMPHON schema + Batch 3.2/3.3/3.4 + Batch 4/4.1 + SHOP-1..6.
    # Guard known PostgreSQL compatibility regressions before touching the remote database.
    $migrationPath = Join-Path $Root 'supabase/migrations/20260912000000_amphon_shop61_full_setup.sql'
    $migrationSql = Get-Content $migrationPath -Raw
    if ($migrationSql -match 'max\s*\(\s*cl\.brand_id\s*\)' -or $migrationSql -match 'max\s*\(\s*cl\.model_id\s*\)') {
      throw 'Unsafe UUID aggregate detected in full migration. Apply SHOP-6.1 hotfix v5+ before continuing.'
    }
    if ($migrationSql -match '(?s)create or replace view public\.commerce_public_store_settings_v.{0,1400}warranty_policy_url,\s*reservation_minutes') {
      throw 'Unsafe store-settings view column order detected. Apply SHOP-6.1 hotfix v5+ before continuing.'
    }
    if ($migrationSql -match '(?s)create or replace view public\.commerce_order_admin_v.{0,700}payment_method\s*,\s*o\.payment_provider\s*,\s*o\.delivery_method') {
      throw 'Unsafe order-admin view column order detected. Apply SHOP-6.1 hotfix v5+ before continuing.'
    }
    if ($migrationSql -match '(?s)create or replace view public\.commerce_listing_editor_v.{0,1100}cl\.mpn\s*,\s*cl\.store_warranty_days') {
      throw 'Unsafe listing-editor view column order detected. Apply SHOP-6.1 hotfix v5+ before continuing.'
    }
    Write-Host "Database SQL safety check - PASS" -ForegroundColor Green

    Invoke-External 'npx' @('supabase@latest','migration','list','--linked') 'Supabase migration list'
    Invoke-External 'npx' @('supabase@latest','db','push','--linked','--include-all') 'Full database migration'

    Write-Host "Running SHOP-6 verification SQL..." -ForegroundColor Yellow
    $verifyPath = Join-Path $Root 'supabase/shop_6_verify.sql'
    Invoke-External 'npx' @('supabase@latest','db','query','--linked','-f',$verifyPath) 'SHOP-6 database verify'

    Write-Host "Running SHOP-6.1 fail-fast database acceptance assertion..." -ForegroundColor Yellow
    $assertPath = Join-Path $Root 'supabase/SHOP61_ACCEPTANCE_ASSERT.sql'
    Invoke-External 'npx' @('supabase@latest','db','query','--linked','-f',$assertPath) 'SHOP-6.1 database acceptance'

    $shop62VerifyPath = Join-Path $Root 'supabase/shop_6_2_verify.sql'
    if (Test-Path $shop62VerifyPath) {
      Write-Host "Running SHOP-6.2 database gate verify..." -ForegroundColor Yellow
      Invoke-External 'npx' @('supabase@latest','db','query','--linked','-f',$shop62VerifyPath) 'SHOP-6.2 database gate verify'
    }
  } finally {
    Pop-Location
  }
  Write-Host "DATABASE CONNECT + MIGRATION + ASSERTION - PASS" -ForegroundColor Green

  if ($DatabaseOnly) {
    Write-Host "DatabaseOnly requested. Finished." -ForegroundColor Green
    exit 0
  }
} else {
  Write-Step "1/7 - Database already accepted - resume mode"
  Write-Host "Skipping Supabase migration because -ResumeFromCloudflare was requested." -ForegroundColor Green
}

$SupabaseSecretKey = Read-Secret 'Supabase Secret key (sb_secret_... / server only)'
$TurnstileSecretKey = Read-Secret 'Cloudflare Turnstile secret key (press Enter to skip for now)' -Optional
$StripeSecretKey = Read-Secret 'Stripe secret key sk_test_... / sk_live_... (press Enter to skip for now)' -Optional

if ($InstallDependencies -and -not $ResumeFromCloudflare) {
  Write-Step "2/7 - Install dependencies"
  Push-Location $Root
  try {
    Invoke-External 'npm' @('install') 'Product Hub npm install'
  } finally { Pop-Location }
  Push-Location (Join-Path $Root 'workers/r2-upload')
  try {
    Invoke-External 'npm' @('install') 'Worker npm install'
  } finally { Pop-Location }
  Push-Location (Join-Path $Root 'shop')
  try {
    Invoke-External 'npm' @('install') 'Shop npm install'
  } finally { Pop-Location }
}

if ($ResumeFromCloudflare) {
  Write-Step "2/7 - Dependencies already installed - resume mode"
  Write-Host "Skipping npm install because the previous run completed dependency installation." -ForegroundColor Green
}

Write-Step "3/7 - Cloudflare login + R2 + API Worker"
$WorkerDir = Join-Path $Root 'workers/r2-upload'

# IMPORTANT: clean legacy TOML BEFORE the first Wrangler invocation.
# Wrangler discovers project config even for commands such as `whoami`, so a
# malformed wrangler.toml left by an older installer can fail before deploy.
$legacyWranglerConfigs = @(
  (Join-Path $WorkerDir 'wrangler.toml'),
  (Join-Path $Root 'wrangler.toml')
)
foreach ($legacyConfig in $legacyWranglerConfigs) {
  if (Test-Path $legacyConfig) {
    Remove-Item $legacyConfig -Force
    Write-Host "Removed legacy Wrangler TOML: $legacyConfig" -ForegroundColor Yellow
  }
}

$origins = @('http://localhost:5173','https://app.amphon.co.th',$AppUrl,$ShopUrl) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique
$allowedOrigins = $origins -join ','

# Generate and validate the Worker JSON config BEFORE any Wrangler command.
$workerConfigPath = Join-Path $WorkerDir 'wrangler.jsonc'
$workerConfig = [ordered]@{
  name = [string]$WorkerName
  main = 'src/index.ts'
  compatibility_date = '2026-09-12'
  r2_buckets = @(
    [ordered]@{
      binding = 'IMAGES'
      bucket_name = [string]$R2BucketName
    }
  )
  vars = [ordered]@{
    SUPABASE_URL = [string]$SupabaseUrl
    SUPABASE_PUBLISHABLE_KEY = [string]$SupabasePublishableKey
    ALLOWED_ORIGINS = [string]$allowedOrigins
  }
  triggers = [ordered]@{
    crons = @('*/5 * * * *')
  }
}
Write-Utf8NoBom $workerConfigPath ($workerConfig | ConvertTo-Json -Depth 20)
try {
  Get-Content $workerConfigPath -Raw | ConvertFrom-Json | Out-Null
} catch {
  throw "Generated Worker JSON config is invalid: $($_.Exception.Message)"
}
Write-Host "Worker JSON config check - PASS" -ForegroundColor Green

Push-Location $WorkerDir
try {
  $whoami = & npx wrangler whoami 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Cloudflare login required..." -ForegroundColor Yellow
    Invoke-External 'npx' @('wrangler','login') 'Cloudflare login'
  } else {
    $whoami | ForEach-Object { Write-Host $_ }
  }

  $bucketList = Invoke-Capture 'npx' @('wrangler','r2','bucket','list') 'R2 bucket list'
  if ($bucketList -notmatch [regex]::Escape($R2BucketName)) {
    Invoke-External 'npx' @('wrangler','r2','bucket','create',$R2BucketName) 'R2 bucket create'
  } else {
    Write-Host "R2 bucket $R2BucketName already exists." -ForegroundColor Green
  }

  if ($InstallDependencies) {
    Invoke-External 'npm' @('run','typecheck') 'Worker typecheck'
  }

  $workerOutput = ''
  if ($DeployWorker) {
    # Cloudflare accepts JSON or .env for --secrets-file. JSON is used here so values
    # containing characters significant to dotenv/TOML cannot corrupt parsing.
    $secretFile = Join-Path $env:TEMP ("amphon-worker-secrets-" + [guid]::NewGuid().ToString('N') + '.json')
    try {
      $secretPayload = [ordered]@{
        SUPABASE_SECRET_KEY = [string]$SupabaseSecretKey
      }
      if (-not [string]::IsNullOrWhiteSpace($TurnstileSecretKey)) {
        $secretPayload['TURNSTILE_SECRET_KEY'] = [string]$TurnstileSecretKey
      }
      if (-not [string]::IsNullOrWhiteSpace($StripeSecretKey)) {
        $secretPayload['STRIPE_SECRET_KEY'] = [string]$StripeSecretKey
      }
      Write-Utf8NoBom $secretFile ($secretPayload | ConvertTo-Json -Depth 5)
      $workerOutput = Invoke-Capture 'npx' @('wrangler','deploy','--config',$workerConfigPath,'--secrets-file',$secretFile) 'Worker deploy'
    } finally {
      if (Test-Path $secretFile) { Remove-Item $secretFile -Force }
    }
  }
} finally { Pop-Location }

$WorkerBaseUrl = $null
if (-not [string]::IsNullOrWhiteSpace($workerOutput)) {
  $match = [regex]::Match($workerOutput, 'https://[A-Za-z0-9.-]+\.workers\.dev')
  if ($match.Success) { $WorkerBaseUrl = $match.Value.TrimEnd('/') }
}
if ([string]::IsNullOrWhiteSpace($WorkerBaseUrl)) {
  $WorkerBaseUrl = (Read-Host 'Paste the deployed API Worker base URL, e.g. https://amphon-product-images.xxx.workers.dev').Trim().TrimEnd('/')
}
if ([string]::IsNullOrWhiteSpace($WorkerBaseUrl)) { throw 'Worker public URL is required to continue.' }
Write-Host "API Worker: $WorkerBaseUrl" -ForegroundColor Green

if (-not [string]::IsNullOrWhiteSpace($StripeSecretKey)) {
  Write-Step "4/7 - Stripe webhook"
  $WebhookUrl = "$WorkerBaseUrl/webhooks/stripe"
  $authRaw = [Text.Encoding]::ASCII.GetBytes($StripeSecretKey + ':')
  $stripeHeaders = @{ Authorization = 'Basic ' + [Convert]::ToBase64String($authRaw) }
  $webhookSecret = $null

  if ($AutoCreateStripeWebhook) {
    try {
      $existing = Invoke-RestMethod -Method Get -Uri 'https://api.stripe.com/v1/webhook_endpoints?limit=100' -Headers $stripeHeaders
      $same = @($existing.data | Where-Object { $_.url -eq $WebhookUrl -and $_.status -eq 'enabled' })
      if ($same.Count -gt 0) {
        Write-Host "Stripe webhook already exists at $WebhookUrl." -ForegroundColor Yellow
        Write-Host "Stripe only returns its signing secret at creation, so enter the existing whsec_... value." -ForegroundColor Yellow
        $webhookSecret = Read-Secret 'Existing Stripe webhook signing secret whsec_...'
      } else {
        $body = @{
          url = $WebhookUrl
          description = 'AMPHON SHOP-6.1 payment webhook'
          'enabled_events[0]' = 'checkout.session.completed'
          'enabled_events[1]' = 'checkout.session.async_payment_succeeded'
          'enabled_events[2]' = 'checkout.session.async_payment_failed'
          'enabled_events[3]' = 'checkout.session.expired'
          'enabled_events[4]' = 'payment_intent.succeeded'
          'enabled_events[5]' = 'payment_intent.payment_failed'
          'enabled_events[6]' = 'charge.refunded'
        }
        $created = Invoke-RestMethod -Method Post -Uri 'https://api.stripe.com/v1/webhook_endpoints' -Headers $stripeHeaders -Body $body -ContentType 'application/x-www-form-urlencoded'
        $webhookSecret = [string]$created.secret
        if ([string]::IsNullOrWhiteSpace($webhookSecret)) { throw 'Stripe did not return a webhook signing secret.' }
        Write-Host "Created Stripe webhook: $WebhookUrl" -ForegroundColor Green
      }
    } catch {
      Write-Host "Automatic Stripe webhook creation failed: $($_.Exception.Message)" -ForegroundColor Yellow
      $webhookSecret = Read-Secret 'Enter Stripe webhook signing secret whsec_...'
    }
  } else {
    Write-Host "Create Stripe webhook manually: $WebhookUrl" -ForegroundColor Yellow
    $webhookSecret = Read-Secret 'Stripe webhook signing secret whsec_...'
  }

  Push-Location $WorkerDir
  try {
    $secretFile2 = Join-Path $env:TEMP ("amphon-stripe-webhook-" + [guid]::NewGuid().ToString('N') + '.json')
    try {
      $stripeSecretPayload = [ordered]@{
        STRIPE_SECRET_KEY = [string]$StripeSecretKey
        STRIPE_WEBHOOK_SECRET = [string]$webhookSecret
      }
      Write-Utf8NoBom $secretFile2 ($stripeSecretPayload | ConvertTo-Json -Depth 5)
      Invoke-External 'npx' @('wrangler','deploy','--config',$workerConfigPath,'--secrets-file',$secretFile2) 'Worker redeploy with Stripe webhook secret'
    } finally {
      if (Test-Path $secretFile2) { Remove-Item $secretFile2 -Force }
    }
  } finally { Pop-Location }
} else {
  Write-Step "4/7 - Stripe skipped"
  Write-Host "Stripe was not configured. Bank transfer / pay-at-store can still be configured in Commerce Admin." -ForegroundColor Yellow
}

Write-Step "5/7 - Generate frontend environment files"
$rootEnv = @"
VITE_SUPABASE_URL=$SupabaseUrl
VITE_SUPABASE_PUBLISHABLE_KEY=$SupabasePublishableKey
VITE_R2_UPLOAD_API=$WorkerBaseUrl
VITE_ALLOW_SIGNUP=false
VITE_PUBLIC_APP_URL=$AppUrl
VITE_SALES_SITE_URL=$ShopUrl
"@
Write-Utf8NoBom (Join-Path $Root '.env') $rootEnv

$shopEnv = @"
PUBLIC_SITE_URL=$ShopUrl
PUBLIC_AMPHON_STORE_API=$WorkerBaseUrl/store
PUBLIC_LINE_URL=$LineUrl
PUBLIC_PHONE=$Phone
"@
Write-Utf8NoBom (Join-Path $Root 'shop/.env') $shopEnv

# Keep Astro canonical site aligned with config.
$astroPath = Join-Path $Root 'shop/astro.config.mjs'
$astroText = Get-Content $astroPath -Raw
$astroText = [regex]::Replace($astroText, "site:\s*'[^']+'", ("site: '{0}'" -f $ShopUrl))
Write-Utf8NoBom $astroPath $astroText

$shopWranglerPath = Join-Path $Root 'shop/wrangler.jsonc'
$wranglerPatcher = Join-Path $PSScriptRoot 'PATCH-SHOP-WRANGLER.cjs'
if (-not (Test-Path $wranglerPatcher)) { throw "Missing Wrangler JSON patcher: $wranglerPatcher" }
$shopHostArg = if ($AttachShopCustomDomain) { ([Uri]$ShopUrl).Host } else { '-' }
Invoke-External 'node' @($wranglerPatcher,$shopWranglerPath,'source',$shopHostArg) 'Astro source Wrangler config patch'

Write-Step "6/7 - Regression, typecheck and production builds"
Push-Location $Root
try {
  Invoke-External 'npm' @('run','typecheck') 'Product Hub typecheck'
  Invoke-External 'npm' @('run','build') 'Product Hub build'
} finally { Pop-Location }

$ShopDir = Join-Path $Root 'shop'
Push-Location $ShopDir
try {
  foreach ($script in @('verify:foundation','verify:shop2','verify:shop3','verify:shop4','verify:shop5','verify:shop6','verify:shop62','verify:production-closeout')) {
    Invoke-External 'npm' @('run',$script) "Shop regression $script"
  }
  Invoke-External 'npm' @('run','build') 'Shop Astro build'
  if ($DeployShop) {
    $generatedServerDir = Join-Path $ShopDir 'dist/server'
    $builtWorker = Join-Path $generatedServerDir 'entry.mjs'
    $generatedConfig = Join-Path $generatedServerDir 'wrangler.json'
    if (-not (Test-Path $builtWorker)) {
      throw "Astro generated Worker entrypoint missing: $builtWorker"
    }
    if (-not (Test-Path $generatedConfig)) {
      throw "Astro generated Wrangler config missing: $generatedConfig"
    }

    $generatedWrangler = Get-Content $generatedConfig -Raw | ConvertFrom-Json
    if ([string]::IsNullOrWhiteSpace([string]$generatedWrangler.main)) {
      throw "Astro generated Wrangler config has no main entrypoint: $generatedConfig"
    }
    $generatedMain = [string]$generatedWrangler.main
    $resolvedGeneratedMain = Join-Path $generatedServerDir $generatedMain
    if (-not (Test-Path $resolvedGeneratedMain)) {
      throw "Generated Wrangler main does not resolve: $generatedMain -> $resolvedGeneratedMain"
    }

    $deployConfig = Join-Path $generatedServerDir 'wrangler.deploy.json'
    try {
      Copy-Item $generatedConfig $deployConfig -Force
      $shopHostArg = if ($AttachShopCustomDomain) { ([Uri]$ShopUrl).Host } else { '-' }
      Invoke-External 'node' @($wranglerPatcher,$deployConfig,'deploy',$shopHostArg) 'Generated Wrangler deploy config patch'
      Write-Host "Astro generated Worker entrypoint - PASS: $builtWorker" -ForegroundColor Green
      Write-Host "Astro generated deploy config - PASS: $generatedConfig" -ForegroundColor Green
      Write-Host "Generated main resolves - PASS: $generatedMain" -ForegroundColor Green
      Invoke-External 'npx' @('wrangler','deploy','--config',$deployConfig) 'Shop deploy'
    } finally {
      if (Test-Path $deployConfig) { Remove-Item $deployConfig -Force }
    }
  }
} finally { Pop-Location }

Write-Step "7/7 - Live HTTP smoke test"
if ($RunLiveHttpSmoke -and $DeployShop) {
  $oldApi = $env:AMPHON_STORE_API
  $oldShop = $env:AMPHON_SHOP_URL
  try {
    $env:AMPHON_STORE_API = "$WorkerBaseUrl/store"
    $env:AMPHON_SHOP_URL = $ShopUrl
    Push-Location $ShopDir
    try { Invoke-External 'npm' @('run','acceptance:live') 'Live HTTP smoke' } finally { Pop-Location }
  } finally {
    $env:AMPHON_STORE_API = $oldApi
    $env:AMPHON_SHOP_URL = $oldShop
  }
}

Write-Host ""
Write-Host "INSTALLATION COMPLETE - CODE/DB/WORKER/SHOP DEPLOYED" -ForegroundColor Green
Write-Host "Product Hub static build: $Root\dist" -ForegroundColor Green
Write-Host "API Worker: $WorkerBaseUrl" -ForegroundColor Green
Write-Host "Shop: $ShopUrl" -ForegroundColor Green
Write-Host ""
Write-Host "IMPORTANT: purchase_enabled is NOT enabled automatically." -ForegroundColor Yellow
Write-Host "Before selling for real, open Product Hub > Commerce Admin and configure:" -ForegroundColor Yellow
Write-Host "- Turnstile site key (if Turnstile secret was installed)" -ForegroundColor Yellow
Write-Host "- Shipping + return policy" -ForegroundColor Yellow
Write-Host "- Payment method (Stripe / bank / pay-at-store)" -ForegroundColor Yellow
Write-Host "- Seller/VAT/document details and warranty defaults" -ForegroundColor Yellow
Write-Host "Then run one real TEST order through payment -> webhook -> sold -> shipment -> complete -> receipt/warranty before enabling production checkout." -ForegroundColor Yellow
