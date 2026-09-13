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

function Read-Enum([string]$Label, [string[]]$Allowed) {
  while ($true) {
    Write-Host ("Allowed: " + ($Allowed -join ', '))
    $value = (Read-Host $Label).Trim().ToUpperInvariant()
    if ($Allowed -contains $value) { return $value }
    Write-Host 'Invalid value.' -ForegroundColor Yellow
  }
}

function Read-NonnegativeInt([string]$Label, [int]$Minimum = 0, [int]$Maximum = [int]::MaxValue) {
  while ($true) {
    $raw = (Read-Host $Label).Trim()
    $value = 0
    if ([int]::TryParse($raw, [ref]$value) -and $value -ge $Minimum -and $value -le $Maximum) { return $value }
    Write-Host "Enter a whole number from $Minimum to $Maximum." -ForegroundColor Yellow
  }
}

function Read-NonnegativeDecimal([string]$Label) {
  while ($true) {
    $raw = (Read-Host $Label).Trim()
    $value = [decimal]0
    if ([decimal]::TryParse($raw, [Globalization.NumberStyles]::Number, [Globalization.CultureInfo]::InvariantCulture, [ref]$value) -and $value -ge 0) { return $value }
    Write-Host 'Enter a nonnegative decimal using a dot, for example 50 or 50.00.' -ForegroundColor Yellow
  }
}

function Read-PublicSiteKey([string]$Label) {
  while ($true) {
    $value = (Read-Host $Label).Trim()
    if ($value.Length -ge 10 -and $value -notmatch '\s') { return $value }
    Write-Host 'Enter the public Turnstile site key (not the secret key).' -ForegroundColor Yellow
  }
}

function Is-NonnegativeInt($Value) {
  return $null -ne $Value -and [int]$Value -ge 0
}

$SupabaseSecret = $null
Write-Host ''
Write-Host '================================================================'
Write-Host 'SHOP-6.3 - CONFIGURE PRODUCTION READINESS'
Write-Host '================================================================'
Write-Host 'This tool configures readiness only. purchase_enabled remains FALSE.'
Write-Host 'PromptPay remains disabled. Document mode remains RECEIPT_ONLY.'
Write-Host 'No secret value is read from or written to source/DB/browser.'

try {
  Push-Location (Join-Path $Root 'workers/r2-upload')
  try {
    $secretJson = (& npx wrangler secret list --name $WorkerName --format json 2>$null | Out-String)
    if ($LASTEXITCODE -ne 0) { throw 'Could not list production Worker secret bindings.' }
    $secretNames = @($secretJson | ConvertFrom-Json | ForEach-Object { $_.name })
  }
  finally { Pop-Location }

  $requiredBindings = @('SUPABASE_SECRET_KEY','STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','TURNSTILE_SECRET_KEY')
  $missingBindings = @($requiredBindings | Where-Object { $secretNames -notcontains $_ })
  if ($missingBindings.Count -gt 0) {
    Write-Host ("Missing production Worker secret bindings: " + ($missingBindings -join ', ')) -ForegroundColor Red
    Write-Host 'Set each missing binding interactively (secret value is never a command argument):'
    foreach ($name in $missingBindings) { Write-Host "  npx wrangler secret put $name --name $WorkerName" }
    throw 'Production Worker secret bindings are incomplete. No DB setting was changed.'
  }
  Write-Host 'Production Worker binding names: PASS (values are write-only and were not read).'

  $secure = Read-Host 'Supabase Secret key (server-only)' -AsSecureString
  $SupabaseSecret = Secure-ToPlain $secure
  if (-not $SupabaseSecret) { throw 'Supabase server secret is required.' }
  $restUri = ([string]$SupabaseUrl).TrimEnd('/') + '/rest/v1/commerce_store_settings?id=eq.1'
  $headers = @{ apikey=$SupabaseSecret; 'User-Agent'='AMPHON-SHOP63-Production-Config/1.0' }
  $response = Invoke-WebRequest -UseBasicParsing -Method Get -Uri ($restUri + '&select=*') -Headers $headers
  $rows = $response.Content | ConvertFrom-Json
  $current = $rows | Select-Object -First 1
  if ($null -eq $current) { throw 'Commerce store settings row id=1 not found.' }
  if ($current.purchase_enabled -ne $false) { throw 'SAFETY STOP: purchase_enabled is not false.' }

  Write-Host ''
  Write-Host 'Current values:'
  [pscustomobject]@{
    purchase_enabled=$current.purchase_enabled; stripe_enabled=$current.stripe_enabled
    stripe_promptpay_enabled=$current.stripe_promptpay_enabled; shipping_enabled=$current.shipping_enabled
    shipping_country=$current.shipping_country; shipping_rate=$current.shipping_rate
    handling_days="$($current.handling_min_days)-$($current.handling_max_days)"
    transit_days="$($current.transit_min_days)-$($current.transit_max_days)"
    shipping_policy_url=$current.shipping_policy_url; return_policy_enabled=$current.return_policy_enabled
    return_policy_category=$current.return_policy_category; return_days=$current.return_days
    return_method=$current.return_method; return_fees=$current.return_fees
    return_policy_url=$current.return_policy_url; checkout_turnstile_enabled=$current.checkout_turnstile_enabled
    turnstile_site_key=$(if ([string]::IsNullOrWhiteSpace([string]$current.turnstile_site_key)) { '(missing)' } else { '(configured public value)' })
    pickup_enabled=$current.pickup_enabled; reservation_minutes=$current.reservation_minutes
    document_mode=$current.document_mode; default_warranty_days=$current.default_warranty_days
  } | Format-List

  $stripeEnabled = [bool]$current.stripe_enabled
  if (-not $stripeEnabled) {
    Write-Host 'Stripe secret binding contents cannot be inspected. Confirm they are intentional PRODUCTION-mode credentials/webhook.' -ForegroundColor Yellow
    $stripeConfirmation = (Read-Host 'Type PRODUCTION STRIPE to enable Stripe readiness').Trim()
    if ($stripeConfirmation -cne 'PRODUCTION STRIPE') { throw 'Stripe production intent was not confirmed. No setting was changed.' }
    $stripeEnabled = $true
  }

  $shippingRate = $current.shipping_rate
  if ($null -eq $shippingRate -or [decimal]$shippingRate -lt 0) { $shippingRate = Read-NonnegativeDecimal 'Shipping fee THB' }
  $handlingMin = $current.handling_min_days
  if (-not (Is-NonnegativeInt $handlingMin)) { $handlingMin = Read-NonnegativeInt 'Handling minimum days' }
  $handlingMax = $current.handling_max_days
  if (-not (Is-NonnegativeInt $handlingMax) -or [int]$handlingMax -lt [int]$handlingMin) {
    do { $handlingMax = Read-NonnegativeInt 'Handling maximum days' } while ([int]$handlingMax -lt [int]$handlingMin)
  }
  $transitMin = $current.transit_min_days
  if (-not (Is-NonnegativeInt $transitMin)) { $transitMin = Read-NonnegativeInt 'Transit minimum days' }
  $transitMax = $current.transit_max_days
  if (-not (Is-NonnegativeInt $transitMax) -or [int]$transitMax -lt [int]$transitMin) {
    do { $transitMax = Read-NonnegativeInt 'Transit maximum days' } while ([int]$transitMax -lt [int]$transitMin)
  }
  # shipping_policy_url is nullable in the actual schema, so it is preserved and not fabricated.

  $returnCategories = @('FINITE','NOT_PERMITTED','UNLIMITED')
  $returnMethods = @('MAIL','IN_STORE','MAIL_AND_IN_STORE')
  $returnFeesAllowed = @('FREE','CUSTOMER_RESPONSIBILITY')
  $returnCategory = [string]$current.return_policy_category
  if ($returnCategories -notcontains $returnCategory) { $returnCategory = Read-Enum 'Return policy category' $returnCategories }
  $returnDays = $current.return_days
  if ($returnCategory -eq 'FINITE' -and -not (Is-NonnegativeInt $returnDays)) { $returnDays = Read-NonnegativeInt 'Return days' }
  $returnMethod = [string]$current.return_method
  if ($returnMethods -notcontains $returnMethod) { $returnMethod = Read-Enum 'Return method' $returnMethods }
  $returnFees = [string]$current.return_fees
  if ($returnFeesAllowed -notcontains $returnFees) { $returnFees = Read-Enum 'Return fees' $returnFeesAllowed }
  # return_policy_url is nullable when a valid category exists; preserve it rather than invent owner policy.

  $siteKey = [string]$current.turnstile_site_key
  if ([string]::IsNullOrWhiteSpace($siteKey)) { $siteKey = Read-PublicSiteKey 'Turnstile public SITE KEY (never secret)' }
  $reservationMinutes = $current.reservation_minutes
  if ($null -eq $reservationMinutes -or [int]$reservationMinutes -lt 45 -or [int]$reservationMinutes -gt 240) {
    $reservationMinutes = Read-NonnegativeInt 'Reservation minutes for Stripe (45-240)' 45 240
  }

  $patch = [ordered]@{
    purchase_enabled=$false
    stripe_enabled=$stripeEnabled
    stripe_promptpay_enabled=$false
    shipping_enabled=$true
    shipping_country='TH'
    shipping_rate=[decimal]$shippingRate
    handling_min_days=[int]$handlingMin
    handling_max_days=[int]$handlingMax
    transit_min_days=[int]$transitMin
    transit_max_days=[int]$transitMax
    shipping_policy_url=$current.shipping_policy_url
    return_policy_enabled=$true
    return_policy_category=$returnCategory
    return_days=$returnDays
    return_method=$returnMethod
    return_fees=$returnFees
    return_policy_url=$current.return_policy_url
    checkout_turnstile_enabled=$true
    turnstile_site_key=$siteKey
    pickup_enabled=$true
    reservation_minutes=[int]$reservationMinutes
    document_mode='RECEIPT_ONLY'
  }

  Write-Host ''
  Write-Host 'Proposed configuration (Turnstile site key masked; no secrets):'
  [pscustomobject]@{
    purchase_enabled=$patch.purchase_enabled; stripe_enabled=$patch.stripe_enabled
    stripe_promptpay_enabled=$patch.stripe_promptpay_enabled; shipping_enabled=$patch.shipping_enabled
    shipping_country=$patch.shipping_country; shipping_rate=$patch.shipping_rate
    handling_days="$($patch.handling_min_days)-$($patch.handling_max_days)"
    transit_days="$($patch.transit_min_days)-$($patch.transit_max_days)"
    shipping_policy_url=$patch.shipping_policy_url; return_policy_enabled=$patch.return_policy_enabled
    return_policy_category=$patch.return_policy_category; return_days=$patch.return_days
    return_method=$patch.return_method; return_fees=$patch.return_fees
    return_policy_url=$patch.return_policy_url; checkout_turnstile_enabled=$patch.checkout_turnstile_enabled
    turnstile_site_key='(configured public value)'; pickup_enabled=$patch.pickup_enabled
    reservation_minutes=$patch.reservation_minutes; document_mode=$patch.document_mode
  } | Format-List
  Write-Host 'purchase_enabled will remain FALSE. This is not activation.' -ForegroundColor Yellow
  Write-Host 'Critical setting changes intentionally invalidate SHOP-6.2 provider evidence in the DB.' -ForegroundColor Yellow
  Write-Host 'After this write, rerun SHOP62-PROVIDER-E2E.bat before the final readiness check.' -ForegroundColor Yellow
  $confirmation = (Read-Host 'Owner: type APPLY SHOP-6.3 to write this readiness configuration').Trim()
  if ($confirmation -cne 'APPLY SHOP-6.3') { throw 'Owner confirmation not received. No setting was changed.' }

  $writeHeaders = @{ apikey=$SupabaseSecret; Prefer='return=representation'; 'Content-Type'='application/json'; 'User-Agent'='AMPHON-SHOP63-Production-Config/1.0' }
  $body = $patch | ConvertTo-Json -Depth 4 -Compress
  $writeResponse = Invoke-WebRequest -UseBasicParsing -Method Patch -Uri $restUri -Headers $writeHeaders -Body $body
  $writtenRows = $writeResponse.Content | ConvertFrom-Json
  $written = $writtenRows | Select-Object -First 1
  if ($null -eq $written -or $written.purchase_enabled -ne $false) { throw 'SAFETY STOP: could not verify purchase_enabled=false after write.' }
  if ($written.stripe_enabled -ne $true -or $written.shipping_enabled -ne $true -or
      $written.return_policy_enabled -ne $true -or $written.checkout_turnstile_enabled -ne $true -or
      $written.pickup_enabled -ne $true -or [string]$written.document_mode -ne 'RECEIPT_ONLY' -or
      $written.stripe_promptpay_enabled -ne $false) {
    throw 'Production readiness write did not verify all required values.'
  }

  Write-Host ''
  Write-Host 'SHOP-6.3 PRODUCTION READINESS CONFIGURED: PASS' -ForegroundColor Green
  Write-Host 'purchase_enabled=false (verified). Checkout was not activated.'
  Write-Host 'Next: run SHOP62-FINAL-ACTIVATION-CHECK.bat'
}
finally { $SupabaseSecret = $null }
