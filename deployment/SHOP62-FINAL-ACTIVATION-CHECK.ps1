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

function Add-Check([string]$Name, [bool]$Passed, [string]$Detail) {
  $script:Checks.Add([pscustomobject]@{ Check=$Name; Status=$(if ($Passed) { 'PASS' } else { 'FAIL' }); Detail=$Detail })
  if (-not $Passed) { $script:Failed = $true }
}

function Resolve-EvidenceObject([object]$InputObject) {
  if ($null -eq $InputObject) {
    return [pscustomobject]@{ Value=$null; Error='MISSING'; Json='null' }
  }

  $candidate = $InputObject
  if ($candidate -is [string]) {
    if ([string]::IsNullOrWhiteSpace([string]$candidate)) {
      return [pscustomobject]@{ Value=$null; Error='MALFORMED: empty JSON string'; Json='(malformed)' }
    }
    try { $candidate = [string]$candidate | ConvertFrom-Json -ErrorAction Stop }
    catch { return [pscustomobject]@{ Value=$null; Error=('MALFORMED JSON: ' + $_.Exception.Message); Json='(malformed)' } }
  }

  if ($null -eq $candidate -or $candidate -is [System.Array] -or
      (-not ($candidate -is [System.Collections.IDictionary]) -and -not ($candidate -is [pscustomobject]))) {
    return [pscustomobject]@{ Value=$null; Error='MALFORMED: evidence must be a JSON object'; Json='(malformed)' }
  }

  try { $json = $candidate | ConvertTo-Json -Depth 12 -Compress -ErrorAction Stop }
  catch { return [pscustomobject]@{ Value=$null; Error=('MALFORMED OBJECT: ' + $_.Exception.Message); Json='(malformed)' } }
  return [pscustomobject]@{ Value=$candidate; Error=$null; Json=$json }
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

function Get-EvidenceDetail([object]$State, [object]$Value) {
  if ($null -ne $State.Error) { return [string]$State.Error }
  if ($null -eq $Value) { return 'MISSING' }
  return [string]$Value
}

function Get-SupabaseResponse([string]$Path, [bool]$ExactCount = $false) {
  $headers = @{}
  foreach ($key in $script:RestHeaders.Keys) { $headers[$key] = $script:RestHeaders[$key] }
  if ($ExactCount) { $headers['Prefer'] = 'count=exact' }
  Invoke-WebRequest -UseBasicParsing -Method Get -Uri ($script:RestBase + $Path) -Headers $headers
}

function Get-SupabaseCount([string]$Path) {
  $response = Get-SupabaseResponse $Path $true
  $contentRange = [string]$response.Headers['Content-Range']
  if ($contentRange -notmatch '/(\d+)$') { throw "Supabase exact count missing for $Path" }
  return [int64]$Matches[1]
}

function Get-Http([string]$Url) {
  Invoke-WebRequest -UseBasicParsing -Method Get -Uri $Url -MaximumRedirection 5 -Headers @{ 'User-Agent'='AMPHON-SHOP63-Activation-Readiness/1.0' }
}

$Checks = [System.Collections.Generic.List[object]]::new()
$Failed = $false
$SupabaseSecret = $null

Write-Host ''
Write-Host '================================================================'
Write-Host 'SHOP-6.3 - FINAL ACTIVATION READ-ONLY READINESS CHECK'
Write-Host '================================================================'
Write-Host 'This script never changes purchase_enabled or any remote setting.'
Write-Host 'It stops after reporting readiness. SHOP-6.4 activation requires owner approval.'

try {
  $secure = Read-Host 'Supabase Secret key (server-only; read-only readiness check)' -AsSecureString
  $SupabaseSecret = Secure-ToPlain $secure
  if (-not $SupabaseSecret) { throw 'Supabase server secret is required.' }

  $RestBase = ([string]$SupabaseUrl).TrimEnd('/') + '/rest/v1/'
  # Server keys belong in apikey, never in Authorization: Bearer.
  $RestHeaders = @{ apikey=$SupabaseSecret; 'User-Agent'='AMPHON-SHOP63-Activation-Readiness/1.0' }

  $settingsResponse = Get-SupabaseResponse 'commerce_store_settings?id=eq.1&select=*'
  $settingsRows = $settingsResponse.Content | ConvertFrom-Json
  $settings = $settingsRows | Select-Object -First 1
  if ($null -eq $settings) { throw 'Commerce store settings row id=1 not found.' }
  $evidenceState = Resolve-EvidenceObject $settings.shop62_acceptance_evidence
  $evidence = $evidenceState.Value

  Add-Check 'purchase_enabled guard' ($settings.purchase_enabled -eq $false) 'Must remain false before SHOP-6.4 owner activation.'
  $acceptanceVersionDetail = $(if ([string]::IsNullOrWhiteSpace([string]$settings.shop62_acceptance_version)) { 'MISSING' } else { [string]$settings.shop62_acceptance_version })
  Add-Check 'Provider acceptance version' ($settings.shop62_acceptance_version -eq 'SHOP-6.2' -and $null -ne $settings.shop62_accepted_at) $acceptanceVersionDetail
  $expectedEvidence = [ordered]@{
    provider='STRIPE'; mode='test'; harness='isolated-workers-dev'
    card='PASS'; signedWebhook='PASS'; duplicateEvent='PASS'
    amountMismatch='PASS'; currencyMismatch='PASS'; reservationExpiry='PASS'
    shippingLifecycle='PASS'; pickupLifecycle='PASS'; documentSnapshot='PASS'
    warrantySnapshot='PASS'; refundReturned='PASS'; warrantyVoided='PASS'
  }
  foreach ($key in $expectedEvidence.Keys) {
    $expectedValue = [string]$expectedEvidence[$key]
    $actualValue = Get-ObjectPropertyValue $evidence $key
    Add-Check ("Provider evidence: " + $key) ([string]$actualValue -ceq $expectedValue) (Get-EvidenceDetail $evidenceState $actualValue)
  }
  $promptPayExpected = $(if ($settings.stripe_promptpay_enabled) { 'PASS' } else { 'SKIPPED_DISABLED' })
  $promptPayValue = Get-ObjectPropertyValue $evidence 'promptPay'
  Add-Check 'PromptPay evidence' ([string]$promptPayValue -ceq $promptPayExpected) (Get-EvidenceDetail $evidenceState $promptPayValue)

  # Historical order/payment rows are immutable audit evidence. They are reported,
  # but only an active product/publication/listing fails readiness.
  $fixtureResponse = Get-SupabaseResponse ('products?sku=like.AT-TST-%25&select=' +
    'id,sku,status,product_publications(channel,status),commerce_listings(slug,index_policy,merchant_enabled)')
  $fixtureRows = $fixtureResponse.Content | ConvertFrom-Json
  $fixtureProducts = 0
  $activeFixtureProducts = 0
  $publishedFixtureRelations = 0
  $enabledFixtureListings = 0
  foreach ($product in $fixtureRows) {
    $fixtureProducts++
    if ([string]$product.status -notin @('sold','returned','cancelled')) { $activeFixtureProducts++ }
    foreach ($publication in $product.product_publications) {
      if ([string]$publication.channel -eq 'website' -and [string]$publication.status -eq 'published') { $publishedFixtureRelations++ }
    }
    foreach ($listing in $product.commerce_listings) {
      if ($listing.merchant_enabled -eq $true -or [string]$listing.index_policy -eq 'INDEX') { $enabledFixtureListings++ }
    }
  }
  $historicalItems = Get-SupabaseCount 'commerce_order_items?sku=like.AT-TST-%25&select=order_id&limit=1'
  $activeFixtureCount = $activeFixtureProducts + $publishedFixtureRelations + $enabledFixtureListings
  Add-Check 'No active AT-TST fixtures' ($activeFixtureCount -eq 0) "active=$activeFixtureCount; products(all states)=$fixtureProducts; historical orderItems=$historicalItems"
  Add-Check 'AT-TST absent from storefront' ($publishedFixtureRelations -eq 0 -and $enabledFixtureListings -eq 0) "published website relations=$publishedFixtureRelations; enabled/indexed listings=$enabledFixtureListings"
  Add-Check 'Temporary DB token cleared' ($null -eq $settings.shop62_test_token_hash -and $null -eq $settings.shop62_test_token_expires_at) 'SHOP62 token hash/expiry must be null.'

  Add-Check 'Stripe enabled' ($settings.stripe_enabled -eq $true) "stripe_enabled=$($settings.stripe_enabled)"
  Add-Check 'PromptPay remains optional' ($settings.stripe_promptpay_enabled -eq $false) "stripe_promptpay_enabled=$($settings.stripe_promptpay_enabled)"
  Add-Check 'Shipping enabled' ($settings.shipping_enabled -eq $true) "shipping_enabled=$($settings.shipping_enabled)"
  $shippingComplete = $settings.shipping_enabled -eq $true -and [string]$settings.shipping_country -eq 'TH' -and
    $null -ne $settings.shipping_rate -and [decimal]$settings.shipping_rate -ge 0 -and
    $null -ne $settings.handling_min_days -and $null -ne $settings.handling_max_days -and
    $null -ne $settings.transit_min_days -and $null -ne $settings.transit_max_days -and
    [int]$settings.handling_min_days -ge 0 -and [int]$settings.handling_min_days -le [int]$settings.handling_max_days -and
    [int]$settings.transit_min_days -ge 0 -and [int]$settings.transit_min_days -le [int]$settings.transit_max_days
  Add-Check 'Shipping configuration complete' $shippingComplete 'TH; nonnegative fee/days; ordered handling/transit windows.'

  $returnCategories = @('FINITE','NOT_PERMITTED','UNLIMITED')
  $returnMethods = @('MAIL','IN_STORE','MAIL_AND_IN_STORE')
  $returnFees = @('FREE','CUSTOMER_RESPONSIBILITY')
  $returnComplete = $settings.return_policy_enabled -eq $true -and $returnCategories -contains [string]$settings.return_policy_category -and
    $returnMethods -contains [string]$settings.return_method -and $returnFees -contains [string]$settings.return_fees -and
    ([string]$settings.return_policy_category -ne 'FINITE' -or ($null -ne $settings.return_days -and [int]$settings.return_days -ge 0))
  Add-Check 'Return policy complete' $returnComplete 'Valid category/method/fees; FINITE requires nonnegative return_days.'

  $turnstileComplete = $settings.checkout_turnstile_enabled -eq $true -and -not [string]::IsNullOrWhiteSpace([string]$settings.turnstile_site_key)
  Add-Check 'Turnstile browser configuration' $turnstileComplete 'Enabled with public site key; secret stays in Worker.'
  Add-Check 'Pickup enabled' ($settings.pickup_enabled -eq $true) "pickup_enabled=$($settings.pickup_enabled)"
  Add-Check 'Stripe reservation race protection' ([int]$settings.reservation_minutes -ge 45 -and [int]$settings.reservation_minutes -le 240) "reservation_minutes=$($settings.reservation_minutes)"
  Add-Check 'Document mode is receipt only' ([string]$settings.document_mode -eq 'RECEIPT_ONLY') "document_mode=$($settings.document_mode); no e-Tax automation implied"
  $warrantyReady = $null -ne $settings.default_warranty_days -and [int]$settings.default_warranty_days -ge 0 -and [int]$settings.default_warranty_days -le 3650
  Add-Check 'Warranty configuration valid' $warrantyReady "default_warranty_days=$($settings.default_warranty_days); per-SKU snapshots remain authoritative"

  $shopEnvPath = Join-Path $Root 'shop/.env'
  $storeApiLine = Get-Content $shopEnvPath | Where-Object { $_ -match '^PUBLIC_AMPHON_STORE_API=' } | Select-Object -First 1
  if (-not $storeApiLine) { throw 'PUBLIC_AMPHON_STORE_API is missing from shop/.env.' }
  $storeApi = ($storeApiLine -replace '^PUBLIC_AMPHON_STORE_API=','').Trim().TrimEnd('/')
  $workerBase = $storeApi -replace '/store$',''
  $storeHealth = Get-Http ($storeApi + '/health')
  $storeHealthBody = $storeHealth.Content | ConvertFrom-Json
  Add-Check 'Production Store Worker health' ($storeHealth.StatusCode -eq 200 -and $storeHealthBody.ok -eq $true -and [int]$storeHealthBody.version -ge 6) "HTTP $($storeHealth.StatusCode), version=$($storeHealthBody.version)"
  $workerHealth = Get-Http ($workerBase + '/health')
  Add-Check 'Production API Worker health' ($workerHealth.StatusCode -eq 200) "HTTP $($workerHealth.StatusCode)"
  foreach ($path in @('/','/robots.txt','/sitemap.xml','/sitemap-products.xml')) {
    $response = Get-Http (([string]$ShopUrl).TrimEnd('/') + $path)
    Add-Check ("Shop HTTP " + $path) ($response.StatusCode -eq 200) "HTTP $($response.StatusCode)"
  }

  Push-Location (Join-Path $Root 'workers/r2-upload')
  try {
    $secretJson = (& npx wrangler secret list --name $WorkerName --format json 2>$null | Out-String)
    if ($LASTEXITCODE -ne 0) { throw 'Could not list production Worker secret bindings.' }
    $secretNames = @($secretJson | ConvertFrom-Json | ForEach-Object { $_.name })
    foreach ($name in @('SUPABASE_SECRET_KEY','STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET')) {
      Add-Check ("Production Worker secret: " + $name) ($secretNames -contains $name) 'Binding name only; secret value is never read.'
    }
    Add-Check 'Production Worker secret: TURNSTILE_SECRET_KEY' ($secretNames -contains 'TURNSTILE_SECRET_KEY') 'Required for production checkout verification.'
    Add-Check 'No production SHOP62 bypass' (-not ($secretNames -contains 'SHOP62_TEST_TOKEN')) 'Production Worker must not expose the SHOP-6.2 test harness token.'
    $savedEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $temporaryLookup = (& npx wrangler deployments list --name amphon-shop62-e2e --json 2>&1 | Out-String)
    $temporaryLookupCode = $LASTEXITCODE
    $ErrorActionPreference = $savedEap
    Add-Check 'Temporary E2E Worker removed' ($temporaryLookupCode -ne 0 -and $temporaryLookup -match 'not found|does not exist|10090') 'amphon-shop62-e2e must not exist.'
  }
  finally { Pop-Location }

  Write-Host ''
  $Checks | Format-Table -AutoSize -Wrap
  Write-Host ''
  Write-Host 'SHOP-6.2 acceptance evidence (read-only):'
  [pscustomobject]@{
    shop62_acceptance_version=$settings.shop62_acceptance_version
    shop62_accepted_at=$settings.shop62_accepted_at
    shop62_acceptance_evidence_json=$evidenceState.Json
    shop62_last_invalidated_at=$settings.shop62_last_invalidated_at
    shop62_last_invalidated_reason=$settings.shop62_last_invalidated_reason
  } | Format-List
  Write-Host ''
  Write-Host 'Current commerce settings (read-only):'
  [pscustomobject]@{
    purchase_enabled=$settings.purchase_enabled; stripe_enabled=$settings.stripe_enabled
    stripe_promptpay_enabled=$settings.stripe_promptpay_enabled; shipping_enabled=$settings.shipping_enabled
    return_policy_enabled=$settings.return_policy_enabled; checkout_turnstile_enabled=$settings.checkout_turnstile_enabled
    pickup_enabled=$settings.pickup_enabled; reservation_minutes=$settings.reservation_minutes
    document_mode=$settings.document_mode; default_warranty_days=$settings.default_warranty_days
  } | Format-List
  if ($Failed) {
    Write-Host 'SHOP-6.3 FINAL ACTIVATION READINESS: FAIL' -ForegroundColor Red
    Write-Host 'No setting was changed.'
    if ([string]$settings.shop62_last_invalidated_reason -eq 'PAYMENT_OR_FULFILLMENT_CONFIG_CHANGED') {
      Write-Host 'SHOP-6.2 evidence was invalidated after critical settings changed. Rerun the isolated Provider E2E before this readiness check.' -ForegroundColor Yellow
    } else {
      Write-Host 'Resolve the failed readiness items and rerun this check.'
    }
    exit 1
  }
  Write-Host 'SHOP-6.3 FINAL ACTIVATION READINESS: PASS' -ForegroundColor Green
  Write-Host 'STOP: checkout remains disabled. SHOP-6.4 owner activation is a separate explicit action.'
  Write-Host 'Cloudflare secret values are write-only; this check verifies binding names, not secret contents.' -ForegroundColor Yellow
}
finally { $SupabaseSecret = $null }
