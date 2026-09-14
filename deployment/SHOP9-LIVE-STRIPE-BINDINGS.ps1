$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Root = Split-Path -Parent $PSScriptRoot
$WorkerDir = Join-Path $Root 'workers/r2-upload'
$WorkerName = 'amphon-product-images'
$ExpectedStripeAccount = 'acct_1UElNlKFSyf2hWLR'
$WebhookUrl = 'https://amphon-product-images.noteroru2.workers.dev/webhooks/stripe'

function Secure-ToPlain([Security.SecureString]$Secure) {
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Put-WranglerSecret([string]$Name, [string]$Value) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = 'cmd.exe'
  $psi.Arguments = "/d /s /c `"npx wrangler secret put $Name --name $WorkerName`""
  $psi.WorkingDirectory = $WorkerDir
  $psi.UseShellExecute = $false
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true

  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $psi
  if (-not $process.Start()) { throw "Could not start Wrangler for $Name" }
  $process.StandardInput.WriteLine($Value)
  $process.StandardInput.Close()
  $stdout = $process.StandardOutput.ReadToEnd()
  $stderr = $process.StandardError.ReadToEnd()
  $process.WaitForExit()

  if ($process.ExitCode -ne 0) {
    $safeError = ($stderr + ' ' + $stdout) -replace '(?i)sk_live_[A-Za-z0-9_-]+','[REDACTED]' -replace '(?i)whsec_[A-Za-z0-9_-]+','[REDACTED]'
    throw "wrangler secret put $Name failed: $safeError"
  }
  Write-Host "PASS - $Name updated on $WorkerName" -ForegroundColor Green
}

Write-Host ''
Write-Host '================================================================'
Write-Host 'SHOP-9 - LIVE STRIPE PRODUCTION BINDING REPAIR'
Write-Host '================================================================'
Write-Host 'This script never writes Stripe secrets to source files.'
Write-Host 'This script does NOT enable purchase_enabled.'
Write-Host 'Only LIVE Stripe credentials are accepted.'
Write-Host ''

if (-not (Test-Path $WorkerDir)) { throw 'workers/r2-upload not found. Run this from the repository checkout.' }

Push-Location $WorkerDir
try {
  & npx wrangler whoami | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'Wrangler is not authenticated.' }
}
finally { Pop-Location }

$stripeSecure = Read-Host 'Stripe LIVE secret key (must start sk_live_)' -AsSecureString
$webhookSecure = Read-Host 'Stripe LIVE webhook signing secret (must start whsec_)' -AsSecureString
$stripeLive = Secure-ToPlain $stripeSecure
$webhookSecret = Secure-ToPlain $webhookSecure

try {
  if ($stripeLive -notmatch '^sk_live_[A-Za-z0-9_-]+$') {
    throw 'Rejected: STRIPE_SECRET_KEY is not an sk_live_ key.'
  }
  if ($webhookSecret -notmatch '^whsec_[A-Za-z0-9_-]+$') {
    throw 'Rejected: STRIPE_WEBHOOK_SECRET is not a whsec_ signing secret.'
  }

  Write-Host '> Verify Stripe LIVE account (read-only)'
  $authHeaders = @{ Authorization = "Bearer $stripeLive"; 'User-Agent'='AMPHON-SHOP9-Live-Binding-Repair/1.0' }
  $account = Invoke-RestMethod -UseBasicParsing -Method Get -Uri 'https://api.stripe.com/v1/account' -Headers $authHeaders
  if ([string]$account.id -ne $ExpectedStripeAccount) {
    throw "Rejected: key belongs to Stripe account $($account.id), expected $ExpectedStripeAccount."
  }
  Write-Host 'PASS - Stripe LIVE key belongs to Amphon Trading' -ForegroundColor Green

  Write-Host '> Verify production webhook endpoint exists (read-only)'
  $endpointList = Invoke-RestMethod -UseBasicParsing -Method Get -Uri 'https://api.stripe.com/v1/webhook_endpoints?limit=100' -Headers $authHeaders
  $endpoint = @($endpointList.data) | Where-Object { [string]$_.url -eq $WebhookUrl -and [string]$_.status -eq 'enabled' } | Select-Object -First 1
  if ($null -eq $endpoint) {
    throw "No enabled LIVE webhook endpoint found for $WebhookUrl"
  }
  Write-Host "PASS - LIVE webhook endpoint exists ($($endpoint.id))" -ForegroundColor Green

  Write-Host '> Replace production Worker secret bindings'
  Put-WranglerSecret 'STRIPE_SECRET_KEY' $stripeLive
  Put-WranglerSecret 'STRIPE_WEBHOOK_SECRET' $webhookSecret

  Write-Host '> Verify Worker binding names only (values remain unreadable)'
  Push-Location $WorkerDir
  try {
    $secretJson = (& npx wrangler secret list --name $WorkerName --format json 2>$null | Out-String)
    if ($LASTEXITCODE -ne 0) { throw 'Could not list Worker secret bindings.' }
    $names = @($secretJson | ConvertFrom-Json | ForEach-Object { $_.name })
  }
  finally { Pop-Location }
  foreach ($required in @('STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET')) {
    if ($names -notcontains $required) { throw "Worker binding missing after update: $required" }
  }

  Write-Host ''
  Write-Host 'SHOP-9 LIVE STRIPE BINDINGS: PASS' -ForegroundColor Green
  Write-Host 'purchase_enabled remains FALSE by design.'
  Write-Host 'Next: return to ChatGPT and say: LIVE bindings PASS'
}
finally {
  $stripeLive = $null
  $webhookSecret = $null
  $stripeSecure = $null
  $webhookSecure = $null
}
