$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ConfigPath = Join-Path $PSScriptRoot 'install.config.ps1'
if (-not (Test-Path $ConfigPath)) { throw 'deployment/install.config.ps1 not found.' }
. $ConfigPath

function Secure-ToPlain([Security.SecureString]$Secure) {
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

$SupabaseSecret = $null
Write-Host ''
Write-Host 'SHOP-6.4 EMERGENCY CHECKOUT CLOSE' -ForegroundColor Yellow
Write-Host 'This changes only purchase_enabled to false.'
try {
  $secure = Read-Host 'Supabase Secret key (server-only)' -AsSecureString
  $SupabaseSecret = Secure-ToPlain $secure
  if (-not $SupabaseSecret) { throw 'Supabase server secret is required.' }
  $uri = ([string]$SupabaseUrl).TrimEnd('/') + '/rest/v1/commerce_store_settings?id=eq.1'
  $readHeaders = @{ apikey=$SupabaseSecret; 'User-Agent'='AMPHON-SHOP64-Emergency-Close/1.0' }
  $currentResponse = Invoke-WebRequest -UseBasicParsing -Method Get -Uri ($uri + '&select=purchase_enabled') -Headers $readHeaders
  $current = $currentResponse.Content | ConvertFrom-Json | Select-Object -First 1
  if ($null -eq $current) { throw 'Commerce store settings row id=1 not found.' }
  Write-Host "Current purchase_enabled=$($current.purchase_enabled)"
  $confirmation = (Read-Host 'Type CLOSE to close checkout now').Trim()
  if ($confirmation -cne 'CLOSE') { throw 'Emergency close cancelled. No setting was changed.' }
  $writeHeaders = @{ apikey=$SupabaseSecret; Prefer='return=representation'; 'Content-Type'='application/json'; 'User-Agent'='AMPHON-SHOP64-Emergency-Close/1.0' }
  $closeBody = @{ purchase_enabled=$false } | ConvertTo-Json -Compress
  Invoke-WebRequest -UseBasicParsing -Method Patch -Uri $uri -Headers $writeHeaders -Body $closeBody | Out-Null
  $verifyResponse = Invoke-WebRequest -UseBasicParsing -Method Get -Uri ($uri + '&select=purchase_enabled') -Headers $readHeaders
  $verified = $verifyResponse.Content | ConvertFrom-Json | Select-Object -First 1
  if ($null -eq $verified -or $verified.purchase_enabled -ne $false) { throw 'Emergency close read-back did not verify purchase_enabled=false.' }
  Write-Host 'SHOP-6.4 EMERGENCY CLOSE: PASS' -ForegroundColor Green
  Write-Host 'purchase_enabled=false verified. No other setting was changed.'
}
finally { $SupabaseSecret = $null }
