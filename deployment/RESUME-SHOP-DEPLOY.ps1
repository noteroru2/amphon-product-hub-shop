[CmdletBinding()]
param(
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

function Write-Utf8NoBom([string]$Path, [string]$Text) {
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Text, $enc)
}

function Read-DotEnvValue([string]$Path, [string]$Name) {
  if (-not (Test-Path $Path)) { return $null }
  foreach ($line in Get-Content $Path) {
    if ($line -match ('^' + [regex]::Escape($Name) + '=(.*)$')) {
      return ([string]$Matches[1]).Trim()
    }
  }
  return $null
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir
if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
  $ConfigPath = Join-Path $ScriptDir 'install.config.ps1'
}
if (-not (Test-Path $ConfigPath)) {
  throw "Missing deployment/install.config.ps1. Keep the config file from the previous install run."
}
. $ConfigPath

Write-Step "AMPHON SHOP-6.1 - resume Shop build/deploy only"
$nodeVersion = (& node --version 2>$null)
if ($LASTEXITCODE -ne 0) { throw 'Node.js is not installed.' }
Write-Host "Node $nodeVersion - PASS" -ForegroundColor Green

$ShopDir = Join-Path $Root 'shop'
$required = @(
  (Join-Path $ShopDir 'node_modules'),
  (Join-Path $ShopDir '.env'),
  (Join-Path $ShopDir 'wrangler.jsonc')
)
foreach ($path in $required) {
  if (-not (Test-Path $path)) { throw "Shop resume prerequisite missing: $path" }
}
Write-Host "Previous DB/Worker/Stripe/Product Hub gates remain untouched - PASS" -ForegroundColor Green

# IMPORTANT: Astro 6+/7 needs the adapter package entrypoint while building.
$shopConfig = Join-Path $ShopDir 'wrangler.jsonc'
$wranglerPatcher = Join-Path $PSScriptRoot 'PATCH-SHOP-WRANGLER.cjs'
if (-not (Test-Path $wranglerPatcher)) { throw "Missing Wrangler JSON patcher: $wranglerPatcher" }
$shopHostArg = if ($AttachShopCustomDomain) { ([Uri]$ShopUrl).Host } else { '-' }
Invoke-External 'node' @($wranglerPatcher,$shopConfig,'source',$shopHostArg) 'Astro source Wrangler config patch'
Write-Host "Astro source Wrangler config - PASS" -ForegroundColor Green

Write-Step "6/7 - Astro Shop build + Cloudflare deploy"
Push-Location $ShopDir
try {
  Invoke-External 'npm' @('run','build') 'Shop Astro build'

  # Astro 7 / @astrojs/cloudflare 14 writes the production worker and a deploy-ready
  # Wrangler config under dist/server. The old dist/_worker.js layout is pre-Astro-6.
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

  # Deploy from the generated config, preserving Astro's generated asset paths/bindings.
  # Add the production custom domain only to a same-directory copy so relative paths stay valid.
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
} finally { Pop-Location }

Write-Step "7/7 - Live HTTP smoke test"
if ($RunLiveHttpSmoke -and $DeployShop) {
  $shopEnvPath = Join-Path $ShopDir '.env'
  $storeApi = Read-DotEnvValue $shopEnvPath 'PUBLIC_AMPHON_STORE_API'
  if ([string]::IsNullOrWhiteSpace($storeApi)) {
    throw 'PUBLIC_AMPHON_STORE_API is missing from shop/.env.'
  }
  $oldApi = $env:AMPHON_STORE_API
  $oldShop = $env:AMPHON_SHOP_URL
  try {
    $env:AMPHON_STORE_API = $storeApi.TrimEnd('/')
    $env:AMPHON_SHOP_URL = ([string]$ShopUrl).TrimEnd('/')
    Push-Location $ShopDir
    try { Invoke-External 'npm' @('run','acceptance:live') 'Live HTTP smoke' } finally { Pop-Location }
  } finally {
    $env:AMPHON_STORE_API = $oldApi
    $env:AMPHON_SHOP_URL = $oldShop
  }
} else {
  Write-Host 'Live HTTP smoke skipped by configuration.' -ForegroundColor Yellow
}

Write-Host ""
Write-Host "SHOP BUILD/DEPLOY RESUME COMPLETE." -ForegroundColor Green
Write-Host "Do not enable purchase_enabled until the manual Stripe/payment/fulfillment acceptance is complete." -ForegroundColor Yellow
