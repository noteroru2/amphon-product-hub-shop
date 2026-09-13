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

function Read-DotEnvValue([string]$Path, [string]$Name) {
  if (-not (Test-Path $Path)) { return $null }
  foreach ($line in Get-Content $Path) {
    if ($line -match ('^' + [regex]::Escape($Name) + '=(.*)$')) {
      return ([string]$Matches[1]).Trim()
    }
  }
  return $null
}

function Write-Utf8NoBom([string]$Path, [string]$Text) {
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Text, $enc)
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

Write-Step "AMPHON SHOP-6.1 - resume from build/QA"
$nodeVersion = (& node --version 2>$null)
if ($LASTEXITCODE -ne 0) { throw 'Node.js is not installed.' }
Write-Host "Node $nodeVersion - PASS" -ForegroundColor Green

$required = @(
  (Join-Path $Root 'node_modules'),
  (Join-Path $Root 'shop/node_modules'),
  (Join-Path $Root 'workers/r2-upload/node_modules'),
  (Join-Path $Root '.env'),
  (Join-Path $Root 'shop/.env')
)
foreach ($path in $required) {
  if (-not (Test-Path $path)) {
    throw "Resume prerequisite missing: $path. Use RESUME-FROM-CLOUDFLARE.bat instead."
  }
}
Write-Host "Previous database/Worker/Stripe/dependency steps detected - PASS" -ForegroundColor Green

Write-Step "6/7 - Regression, typecheck and production builds"
Push-Location $Root
try {
  Invoke-External 'npm' @('run','typecheck') 'Product Hub typecheck'
  Invoke-External 'npm' @('run','build') 'Product Hub build'
} finally { Pop-Location }

$ShopDir = Join-Path $Root 'shop'
$shopConfig = Join-Path $ShopDir 'wrangler.jsonc'
$wranglerPatcher = Join-Path $PSScriptRoot 'PATCH-SHOP-WRANGLER.cjs'
if (-not (Test-Path $wranglerPatcher)) { throw "Missing Wrangler JSON patcher: $wranglerPatcher" }
$shopHostArg = if ($AttachShopCustomDomain) { ([Uri]$ShopUrl).Host } else { '-' }
Invoke-External 'node' @($wranglerPatcher,$shopConfig,'source',$shopHostArg) 'Astro source Wrangler config patch'
Write-Host "Astro source Wrangler config - PASS" -ForegroundColor Green
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
Write-Host "BUILD/QA RESUME COMPLETE." -ForegroundColor Green
Write-Host "Next: run manual Stripe card/PromptPay, duplicate webhook, refund, shipping/pickup, receipt and warranty acceptance before enabling purchase_enabled." -ForegroundColor Yellow
