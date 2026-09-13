$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Root = Split-Path -Parent $PSScriptRoot
$ConfigPath = Join-Path $PSScriptRoot 'install.config.ps1'
$ReportPath = Join-Path $Root 'SHOP6_4_OWNER_ACTIVATION_REPORT.md'
$ReportsPath = Join-Path $Root 'reports'
if (-not (Test-Path $ConfigPath)) { throw 'deployment/install.config.ps1 not found.' }
. $ConfigPath

function Secure-ToPlain([Security.SecureString]$Secure) {
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Add-Check([string]$Name, [bool]$Passed, [string]$Detail) {
  $script:Checks.Add([pscustomobject]@{ Check=$Name; Status=$(if ($Passed) { 'PASS' } else { 'FAIL' }); Detail=$Detail })
  if (-not $Passed) { $script:PreflightFailed = $true }
}

function Get-SupabaseResponse([string]$Path, [bool]$ExactCount = $false) {
  $headers = @{}
  foreach ($key in $script:ReadHeaders.Keys) { $headers[$key] = $script:ReadHeaders[$key] }
  if ($ExactCount) { $headers['Prefer'] = 'count=exact' }
  Invoke-WebRequest -UseBasicParsing -Method Get -Uri ($script:RestBase + $Path) -Headers $headers
}

function Get-SupabaseCount([string]$Path) {
  $response = Get-SupabaseResponse $Path $true
  $contentRange = [string]$response.Headers['Content-Range']
  if ($contentRange -notmatch '/(\d+)$') { throw "Supabase exact count missing for $Path" }
  return [int64]$Matches[1]
}

function Get-Settings {
  $response = Get-SupabaseResponse 'commerce_store_settings?id=eq.1&select=*'
  return ($response.Content | ConvertFrom-Json | Select-Object -First 1)
}

function Get-Http([string]$Name, [string]$Url) {
  $response = Invoke-WebRequest -UseBasicParsing -Method Get -Uri $Url -MaximumRedirection 5 -Headers @{ 'User-Agent'='AMPHON-SHOP64-Owner-Activation/1.0' }
  $script:HttpResults.Add([pscustomobject]@{ Name=$Name; StatusCode=[int]$response.StatusCode; Url=$Url })
  return $response
}

function Get-ObjectPropertyValue([object]$Object, [string]$Name) {
  if ($null -eq $Object) { return $null }
  if ($Object -is [System.Collections.IDictionary]) {
    if ($Object.Contains($Name)) { return $Object[$Name] }
    return $null
  }
  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property) { return $null }
  return $property.Value
}

function Get-EvidenceObject([object]$InputObject) {
  if ($null -eq $InputObject) { return $null }
  if ($InputObject -is [string]) {
    try { $InputObject = [string]$InputObject | ConvertFrom-Json -ErrorAction Stop }
    catch { return $null }
  }
  if ($InputObject -is [System.Collections.IDictionary] -or $InputObject -is [pscustomobject]) { return $InputObject }
  return $null
}

function Protect-ReportText([object]$Value) {
  $safe = [string]$Value
  if (-not [string]::IsNullOrEmpty([string]$script:SupabaseSecret)) {
    $safe = $safe.Replace([string]$script:SupabaseSecret, '[REDACTED]')
  }
  $safe = $safe -replace '(?i)sb_secret_[A-Za-z0-9_-]+','[REDACTED]'
  $safe = $safe -replace '(?i)sk_(?:live|test)_[A-Za-z0-9_-]+','[REDACTED]'
  $safe = $safe -replace '(?i)whsec_[A-Za-z0-9_-]+','[REDACTED]'
  return ($safe -replace '[\r\n]+',' ')
}

function Write-ActivationReport([string]$Result, [object]$Snapshot, [object]$FinalPurchaseEnabled, [string]$Failure = '') {
  $reportTimestamp = [DateTimeOffset]::Now
  $lines = [System.Collections.Generic.List[string]]::new()
  $lines.Add('# SHOP-6.4 Owner Activation Report')
  $lines.Add('')
  $lines.Add("- Timestamp: $($reportTimestamp.ToString('o'))")
  $lines.Add("- Result: $(Protect-ReportText $Result)")
  $lines.Add("- Live Stripe owner confirmation received: $script:StripeConfirmed")
  $lines.Add("- Owner activation phrase received: $script:ActivationConfirmed")
  $lines.Add("- Final purchase_enabled: $FinalPurchaseEnabled")
  if ($Failure) { $lines.Add("- Failure: $(Protect-ReportText $Failure)") }
  $lines.Add('')
  $lines.Add('## Preflight')
  $lines.Add('')
  $lines.Add('| Check | Status | Detail |')
  $lines.Add('|---|---|---|')
  foreach ($check in $script:Checks) {
    $detail = (Protect-ReportText $check.Detail) -replace '\|','/'
    $lines.Add("| $($check.Check) | $($check.Status) | $detail |")
  }
  $lines.Add('')
  $lines.Add('## Configuration snapshot (no secrets)')
  $lines.Add('')
  if ($null -ne $Snapshot) {
    foreach ($property in $Snapshot.PSObject.Properties) { $lines.Add("- $($property.Name): $(Protect-ReportText $property.Value)") }
  }
  $lines.Add('')
  $lines.Add('## HTTP results')
  $lines.Add('')
  if ($script:HttpResults.Count -eq 0) { $lines.Add('- Not run') }
  foreach ($item in $script:HttpResults) { $lines.Add("- $($item.Name): HTTP $($item.StatusCode) - $(Protect-ReportText $item.Url)") }
  $encoding = New-Object System.Text.UTF8Encoding($false)
  $reportErrors = [System.Collections.Generic.List[string]]::new()
  try { [System.IO.File]::WriteAllLines($ReportPath, $lines, $encoding) }
  catch { $reportErrors.Add("latest report: $($_.Exception.Message)") }
  try {
    if (-not (Test-Path $ReportsPath)) { New-Item -ItemType Directory -Path $ReportsPath -Force | Out-Null }
    $safeResult = $Result -replace '[^A-Za-z0-9_-]','_'
    $archiveStamp = $reportTimestamp.ToString('yyyyMMdd-HHmmss-fff')
    $archiveNonce = [Guid]::NewGuid().ToString('N').Substring(0,8)
    $archiveName = "SHOP6_4_OWNER_ACTIVATION_${archiveStamp}_${archiveNonce}_${safeResult}.md"
    [System.IO.File]::WriteAllLines((Join-Path $ReportsPath $archiveName), $lines, $encoding)
  }
  catch { $reportErrors.Add("archive report: $($_.Exception.Message)") }
  if ($reportErrors.Count -gt 0) {
    Write-Warning ('Activation report write was incomplete; production state was not changed because of this reporting error. ' + ($reportErrors -join '; '))
  }
}

$Checks = [System.Collections.Generic.List[object]]::new()
$HttpResults = [System.Collections.Generic.List[object]]::new()
$PreflightFailed = $false
$StripeConfirmed = $false
$ActivationConfirmed = $false
$SupabaseSecret = $null
$RestBase = $null
$ReadHeaders = $null
$Snapshot = $null
$activationRequestAttempted = $false
$failureResult = 'FAILED_OR_CANCELLED_BEFORE_WRITE'
$lastKnownPurchaseEnabled = 'UNKNOWN'

Write-Host ''
Write-Host '================================================================'
Write-Host 'SHOP-6.4 - OWNER ACTIVATION'
Write-Host '================================================================'
Write-Host 'The script begins read-only. It stops if any readiness gate fails.'
Write-Host 'It never asks for or displays Stripe, webhook, or Turnstile secret values.'

try {
  $secure = Read-Host 'Supabase Secret key (server-only)' -AsSecureString
  $SupabaseSecret = Secure-ToPlain $secure
  if (-not $SupabaseSecret) { throw 'Supabase server secret is required.' }
  $RestBase = ([string]$SupabaseUrl).TrimEnd('/') + '/rest/v1/'
  $ReadHeaders = @{ apikey=$SupabaseSecret; 'User-Agent'='AMPHON-SHOP64-Owner-Activation/1.0' }

  $settings = Get-Settings
  if ($null -eq $settings) { throw 'Commerce store settings row id=1 not found.' }
  $lastKnownPurchaseEnabled = [bool]$settings.purchase_enabled
  $evidence = Get-EvidenceObject $settings.shop62_acceptance_evidence

  Add-Check 'purchase_enabled is closed before activation' ($settings.purchase_enabled -eq $false) "purchase_enabled=$($settings.purchase_enabled)"
  Add-Check 'SHOP-6.2 acceptance version' ([string]$settings.shop62_acceptance_version -eq 'SHOP-6.2' -and $null -ne $settings.shop62_accepted_at) ([string]$settings.shop62_acceptance_version)
  $expectedEvidence = [ordered]@{
    provider='STRIPE'; mode='test'; harness='isolated-workers-dev'; card='PASS'; signedWebhook='PASS'
    duplicateEvent='PASS'; amountMismatch='PASS'; currencyMismatch='PASS'; reservationExpiry='PASS'
    shippingLifecycle='PASS'; pickupLifecycle='PASS'; documentSnapshot='PASS'; warrantySnapshot='PASS'
    refundReturned='PASS'; warrantyVoided='PASS'; promptPay='SKIPPED_DISABLED'
  }
  foreach ($key in $expectedEvidence.Keys) {
    $value = Get-ObjectPropertyValue $evidence $key
    Add-Check ("Provider evidence: " + $key) ([string]$value -ceq [string]$expectedEvidence[$key]) $(if ($null -eq $value) { 'MISSING' } else { [string]$value })
  }

  $fixtureResponse = Get-SupabaseResponse ('products?sku=like.AT-TST-%25&select=' +
    'id,sku,status,product_publications(channel,status),commerce_listings(slug,index_policy,merchant_enabled)')
  $fixtureRows = $fixtureResponse.Content | ConvertFrom-Json
  $fixtureProducts = 0; $activeProducts = 0; $publishedRelations = 0; $enabledListings = 0
  foreach ($product in $fixtureRows) {
    $fixtureProducts++
    if ([string]$product.status -notin @('sold','returned','cancelled')) { $activeProducts++ }
    foreach ($publication in $product.product_publications) {
      if ([string]$publication.channel -eq 'website' -and [string]$publication.status -eq 'published') { $publishedRelations++ }
    }
    foreach ($listing in $product.commerce_listings) {
      if ($listing.merchant_enabled -eq $true -or [string]$listing.index_policy -eq 'INDEX') { $enabledListings++ }
    }
  }
  $historicalItems = Get-SupabaseCount 'commerce_order_items?sku=like.AT-TST-%25&select=order_id&limit=1'
  $activeFixtures = $activeProducts + $publishedRelations + $enabledListings
  Add-Check 'No active AT-TST fixtures' ($activeFixtures -eq 0) "active=$activeFixtures; products(all states)=$fixtureProducts; historical orderItems=$historicalItems"
  Add-Check 'No DB SHOP62 test token' ($null -eq $settings.shop62_test_token_hash -and $null -eq $settings.shop62_test_token_expires_at) 'Token hash/expiry must be null.'

  Add-Check 'Stripe enabled' ($settings.stripe_enabled -eq $true) "stripe_enabled=$($settings.stripe_enabled)"
  Add-Check 'PromptPay disabled' ($settings.stripe_promptpay_enabled -eq $false) "stripe_promptpay_enabled=$($settings.stripe_promptpay_enabled)"
  $shippingComplete = $settings.shipping_enabled -eq $true -and [string]$settings.shipping_country -eq 'TH' -and
    $null -ne $settings.shipping_rate -and [decimal]$settings.shipping_rate -ge 0 -and
    $null -ne $settings.handling_min_days -and $null -ne $settings.handling_max_days -and
    $null -ne $settings.transit_min_days -and $null -ne $settings.transit_max_days -and
    [int]$settings.handling_min_days -ge 0 -and [int]$settings.handling_min_days -le [int]$settings.handling_max_days -and
    [int]$settings.transit_min_days -ge 0 -and [int]$settings.transit_min_days -le [int]$settings.transit_max_days
  Add-Check 'Shipping configuration complete' $shippingComplete "enabled=$($settings.shipping_enabled); $($settings.shipping_country); rate=$($settings.shipping_rate); handling=$($settings.handling_min_days)-$($settings.handling_max_days); transit=$($settings.transit_min_days)-$($settings.transit_max_days)"
  $returnComplete = $settings.return_policy_enabled -eq $true -and
    @('FINITE','NOT_PERMITTED','UNLIMITED') -contains [string]$settings.return_policy_category -and
    @('MAIL','IN_STORE','MAIL_AND_IN_STORE') -contains [string]$settings.return_method -and
    @('FREE','CUSTOMER_RESPONSIBILITY') -contains [string]$settings.return_fees -and
    ([string]$settings.return_policy_category -ne 'FINITE' -or ($null -ne $settings.return_days -and [int]$settings.return_days -ge 0))
  Add-Check 'Return policy complete' $returnComplete "$($settings.return_policy_category); days=$($settings.return_days); method=$($settings.return_method); fees=$($settings.return_fees)"
  Add-Check 'Turnstile browser configuration' ($settings.checkout_turnstile_enabled -eq $true -and -not [string]::IsNullOrWhiteSpace([string]$settings.turnstile_site_key)) 'Enabled with public site key.'
  Add-Check 'Pickup enabled' ($settings.pickup_enabled -eq $true) "pickup_enabled=$($settings.pickup_enabled)"
  Add-Check 'Reservation protects Stripe Checkout' ([int]$settings.reservation_minutes -ge 45 -and [int]$settings.reservation_minutes -le 240) "reservation_minutes=$($settings.reservation_minutes)"
  Add-Check 'Document mode' ([string]$settings.document_mode -eq 'RECEIPT_ONLY') "document_mode=$($settings.document_mode)"
  Add-Check 'Warranty configuration' ($null -ne $settings.default_warranty_days -and [int]$settings.default_warranty_days -ge 0 -and [int]$settings.default_warranty_days -le 3650) "default_warranty_days=$($settings.default_warranty_days)"

  $shopEnvPath = Join-Path $Root 'shop/.env'
  $storeApiLine = Get-Content $shopEnvPath | Where-Object { $_ -match '^PUBLIC_AMPHON_STORE_API=' } | Select-Object -First 1
  if (-not $storeApiLine) { throw 'PUBLIC_AMPHON_STORE_API is missing from shop/.env.' }
  $storeApi = ($storeApiLine -replace '^PUBLIC_AMPHON_STORE_API=','').Trim().TrimEnd('/')
  $workerBase = $storeApi -replace '/store$',''
  $storeHealth = Get-Http 'Production Store Worker health' ($storeApi + '/health')
  $storeHealthBody = $storeHealth.Content | ConvertFrom-Json
  Add-Check 'Production Store Worker health' ($storeHealth.StatusCode -eq 200 -and $storeHealthBody.ok -eq $true -and [int]$storeHealthBody.version -ge 6) "HTTP $($storeHealth.StatusCode)"
  $workerHealth = Get-Http 'Production API Worker health' ($workerBase + '/health')
  Add-Check 'Production API Worker health' ($workerHealth.StatusCode -eq 200) "HTTP $($workerHealth.StatusCode)"
  foreach ($path in @('/','/robots.txt','/sitemap.xml','/sitemap-products.xml')) {
    $response = Get-Http ("Shop " + $path) (([string]$ShopUrl).TrimEnd('/') + $path)
    Add-Check ("Shop HTTP " + $path) ($response.StatusCode -eq 200) "HTTP $($response.StatusCode)"
  }

  Push-Location (Join-Path $Root 'workers/r2-upload')
  try {
    $secretJson = (& npx wrangler secret list --name $WorkerName --format json 2>$null | Out-String)
    if ($LASTEXITCODE -ne 0) { throw 'Could not list production Worker secret bindings.' }
    $secretNames = @($secretJson | ConvertFrom-Json | ForEach-Object { $_.name })
    foreach ($name in @('SUPABASE_SECRET_KEY','STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','TURNSTILE_SECRET_KEY')) {
      Add-Check ("Production Worker secret: " + $name) ($secretNames -contains $name) 'Binding name only; value was not read.'
    }
    Add-Check 'No production SHOP62 test secret' (-not ($secretNames -contains 'SHOP62_TEST_TOKEN')) 'Production Worker must not expose test token.'
    $productionConfig = Get-Content -Raw (Join-Path $Root 'workers/r2-upload/wrangler.jsonc')
    Add-Check 'No production SHOP62 mode' ($productionConfig -notmatch 'SHOP62_TEST_MODE|SHOP62_TEST_TOKEN') 'Production Wrangler config contains no test mode/token.'
    $savedEap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $temporaryLookup = (& npx wrangler deployments list --name amphon-shop62-e2e --json 2>&1 | Out-String)
    $temporaryLookupCode = $LASTEXITCODE
    $ErrorActionPreference = $savedEap
    Add-Check 'Temporary E2E Worker removed' ($temporaryLookupCode -ne 0 -and $temporaryLookup -match 'not found|does not exist|10090') 'amphon-shop62-e2e must not exist.'
  }
  finally { Pop-Location }

  $Snapshot = [pscustomobject]@{
    stripe_cards='ENABLED'; promptpay='DISABLED'; shipping_country=$settings.shipping_country
    shipping_rate_thb=$settings.shipping_rate; handling_days="$($settings.handling_min_days)-$($settings.handling_max_days)"
    transit_days="$($settings.transit_min_days)-$($settings.transit_max_days)"; return_category=$settings.return_policy_category
    return_days=$settings.return_days; return_method=$settings.return_method; return_fees=$settings.return_fees
    turnstile='ENABLED'; pickup='ENABLED'; reservation_minutes=$settings.reservation_minutes
    document_mode=$settings.document_mode; default_warranty_days=$settings.default_warranty_days
    turnstile_site_key_configured=(-not [string]::IsNullOrWhiteSpace([string]$settings.turnstile_site_key))
  }

  Write-Host ''
  $Checks | Format-Table -AutoSize -Wrap
  if ($PreflightFailed) {
    $failureResult = 'FAILED_PREFLIGHT'
    throw 'SHOP-6.4 activation stopped: readiness gate failed.'
  }

  Write-Host ''
  Write-Host 'Before activation confirm:' -ForegroundColor Yellow
  Write-Host '1. Production Worker STRIPE_SECRET_KEY was intentionally set from Stripe LIVE mode.'
  Write-Host '2. Production Worker STRIPE_WEBHOOK_SECRET belongs to the LIVE webhook endpoint.'
  Write-Host '3. No Stripe TEST key is being used for production checkout.'
  $stripePhrase = (Read-Host 'Type I CONFIRM STRIPE LIVE').Trim()
  if ($stripePhrase -cne 'I CONFIRM STRIPE LIVE') {
    $failureResult = 'CANCELLED'
    throw 'Live Stripe owner confirmation not received. No setting was changed.'
  }
  $StripeConfirmed = $true

  Write-Host ''
  Write-Host 'SHOP-6.4 OWNER ACTIVATION PLAN' -ForegroundColor Cyan
  Write-Host "Stripe cards: ENABLED"
  Write-Host "PromptPay: DISABLED"
  Write-Host "Shipping: $($settings.shipping_country) / $($settings.shipping_rate) THB"
  Write-Host "Handling: $($settings.handling_min_days)-$($settings.handling_max_days) days"
  Write-Host "Transit: $($settings.transit_min_days)-$($settings.transit_max_days) days"
  Write-Host "Return: $($settings.return_policy_category) / $($settings.return_days) days"
  Write-Host "Return method: $($settings.return_method)"
  Write-Host "Return fees: $($settings.return_fees)"
  Write-Host 'Turnstile: ENABLED'
  Write-Host 'Pickup: ENABLED'
  Write-Host "Reservation: $($settings.reservation_minutes) minutes"
  Write-Host "Document mode: $($settings.document_mode)"
  Write-Host 'Current: purchase_enabled=false'
  Write-Host 'Proposed: purchase_enabled=true' -ForegroundColor Yellow
  $activationPhrase = (Read-Host 'Type ACTIVATE AMPHON SHOP').Trim()
  if ($activationPhrase -cne 'ACTIVATE AMPHON SHOP') {
    $failureResult = 'CANCELLED'
    throw 'Owner activation phrase not received. No setting was changed.'
  }
  $ActivationConfirmed = $true

  $writeUri = $RestBase + 'commerce_store_settings?id=eq.1'
  $writeHeaders = @{ apikey=$SupabaseSecret; Prefer='return=representation'; 'Content-Type'='application/json'; 'User-Agent'='AMPHON-SHOP64-Owner-Activation/1.0' }
  $activationBody = @{ purchase_enabled=$true } | ConvertTo-Json -Compress
  $activationRequestAttempted = $true
  $writeResponse = Invoke-WebRequest -UseBasicParsing -Method Patch -Uri $writeUri -Headers $writeHeaders -Body $activationBody
  $written = $writeResponse.Content | ConvertFrom-Json | Select-Object -First 1
  if ($null -eq $written -or $written.purchase_enabled -ne $true) { throw 'Activation write did not return purchase_enabled=true.' }
  $readBack = Get-Settings
  if ($null -eq $readBack -or $readBack.purchase_enabled -ne $true) { throw 'Activation read-back did not verify purchase_enabled=true.' }

  $postStoreHealth = Get-Http 'Post-activation Store API health' ($storeApi + '/health')
  if ($postStoreHealth.StatusCode -ne 200) { throw 'Post-activation Store API health failed.' }
  $publicSettingsResponse = Get-Http 'Post-activation Store settings' ($storeApi + '/settings')
  $publicSettings = $publicSettingsResponse.Content | ConvertFrom-Json
  if ($publicSettingsResponse.StatusCode -ne 200 -or $publicSettings.settings.purchaseEnabled -ne $true) { throw 'Public store settings do not show purchasing enabled.' }
  foreach ($path in @('/','/robots.txt','/sitemap.xml','/sitemap-products.xml')) {
    $response = Get-Http ("Post-activation Shop " + $path) (([string]$ShopUrl).TrimEnd('/') + $path)
    if ($response.StatusCode -ne 200) { throw "Post-activation HTTP check failed: $path" }
  }
  $finalSettings = Get-Settings
  if ($finalSettings.purchase_enabled -ne $true) { throw 'Final DB state is not purchase_enabled=true.' }
  try { Write-ActivationReport 'ACTIVATED' $Snapshot $true }
  catch { Write-Warning 'Activation report generation failed. Production state was not changed because of this reporting error.' }
  Write-Host ''
  Write-Host 'SHOP-6.4 ACTIVATION: PASS' -ForegroundColor Green
  Write-Host 'purchase_enabled=true verified. No order or charge was created.'
}
catch {
  $failure = $_.Exception.Message
  $rolledBack = $false
  $rollbackFailed = $false
  $finalPurchaseEnabled = $lastKnownPurchaseEnabled
  # Safety invariant: a preflight failure or cancellation in this execution must
  # never close a shop that was already enabled before this script started.
  if ($activationRequestAttempted) {
    try {
      $rollbackUri = $RestBase + 'commerce_store_settings?id=eq.1'
      $rollbackHeaders = @{ apikey=$SupabaseSecret; Prefer='return=representation'; 'Content-Type'='application/json'; 'User-Agent'='AMPHON-SHOP64-Automatic-Rollback/1.0' }
      $rollbackBody = @{ purchase_enabled=$false } | ConvertTo-Json -Compress
      Invoke-WebRequest -UseBasicParsing -Method Patch -Uri $rollbackUri -Headers $rollbackHeaders -Body $rollbackBody | Out-Null
      $closed = Get-Settings
      if ($null -eq $closed -or $closed.purchase_enabled -ne $false) { throw 'Rollback read-back did not verify false.' }
      $rolledBack = $true
      $finalPurchaseEnabled = $false
    }
    catch {
      $rollbackFailed = $true
      $finalPurchaseEnabled = 'UNKNOWN'
      $failure = "$failure; ROLLBACK FAILED: $($_.Exception.Message)"
    }
  }
  $result = $(if ($rollbackFailed) { 'ROLLBACK_FAILED' } elseif ($rolledBack) { 'ROLLED_BACK' } else { $failureResult })
  try { Write-ActivationReport $result $Snapshot $finalPurchaseEnabled $failure }
  catch { Write-Warning 'Activation report generation failed. Production state was not changed because of this reporting error.' }
  if ($rolledBack) { Write-Host 'SHOP-6.4 ACTIVATION: ROLLED_BACK' -ForegroundColor Red }
  if ($rollbackFailed) { Write-Host 'CRITICAL: automatic checkout rollback could not be verified.' -ForegroundColor Red }
  throw
}
finally { $SupabaseSecret = $null }
