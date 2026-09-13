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

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir
if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
  $ConfigPath = Join-Path $ScriptDir 'install.config.ps1'
}
if (-not (Test-Path $ConfigPath)) {
  throw "Missing deployment/install.config.ps1."
}
. $ConfigPath

Write-Step "AMPHON SHOP-6.1 - resume live HTTP acceptance only"
$nodeVersion = (& node --version 2>$null)
if ($LASTEXITCODE -ne 0) { throw 'Node.js is not installed.' }
Write-Host "Node $nodeVersion - PASS" -ForegroundColor Green
Write-Host "Shop deploy is not repeated in this mode." -ForegroundColor Green

$ShopDir = Join-Path $Root 'shop'
$shopEnvPath = Join-Path $ShopDir '.env'
$acceptanceScript = Join-Path $ShopDir 'scripts/live-acceptance.mjs'
if (-not (Test-Path $shopEnvPath)) { throw "Missing Shop environment: $shopEnvPath" }
if (-not (Test-Path $acceptanceScript)) { throw "Missing live acceptance script: $acceptanceScript" }

$storeApi = Read-DotEnvValue $shopEnvPath 'PUBLIC_AMPHON_STORE_API'
if ([string]::IsNullOrWhiteSpace($storeApi)) {
  throw 'PUBLIC_AMPHON_STORE_API is missing from shop/.env.'
}
if ([string]::IsNullOrWhiteSpace([string]$ShopUrl)) {
  throw 'ShopUrl is missing from deployment/install.config.ps1.'
}

$oldApi = $env:AMPHON_STORE_API
$oldShop = $env:AMPHON_SHOP_URL
$oldRetries = $env:LIVE_ACCEPTANCE_RETRIES
$oldDelay = $env:LIVE_ACCEPTANCE_DELAY_MS
try {
  $env:AMPHON_STORE_API = $storeApi.TrimEnd('/')
  $env:AMPHON_SHOP_URL = ([string]$ShopUrl).TrimEnd('/')
  if ([string]::IsNullOrWhiteSpace($env:LIVE_ACCEPTANCE_RETRIES)) { $env:LIVE_ACCEPTANCE_RETRIES = '20' }
  if ([string]::IsNullOrWhiteSpace($env:LIVE_ACCEPTANCE_DELAY_MS)) { $env:LIVE_ACCEPTANCE_DELAY_MS = '15000' }
  Write-Step "7/7 - Live HTTP smoke test with custom-domain readiness retry"
  Push-Location $ShopDir
  try { Invoke-External 'npm' @('run','acceptance:live') 'Live HTTP smoke' } finally { Pop-Location }
} finally {
  $env:AMPHON_STORE_API = $oldApi
  $env:AMPHON_SHOP_URL = $oldShop
  $env:LIVE_ACCEPTANCE_RETRIES = $oldRetries
  $env:LIVE_ACCEPTANCE_DELAY_MS = $oldDelay
}

Write-Host ""
Write-Host "LIVE HTTP ACCEPTANCE COMPLETE." -ForegroundColor Green
Write-Host "Do not enable purchase_enabled until manual Stripe/payment/fulfillment acceptance is complete." -ForegroundColor Yellow
