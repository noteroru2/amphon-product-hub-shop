[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Heading([string]$Text) {
  Write-Host ''
  Write-Host ('=' * 72)
  Write-Host $Text
  Write-Host ('=' * 72)
}

function Fail([string]$Message) { throw $Message }

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Required = @(
  'package.json',
  'shop\package.json',
  'workers\r2-upload\package.json',
  'deployment',
  'supabase'
)

Heading 'AMPHON PROJECT - CREATE PORTABLE TRANSFER ZIP'
Write-Host ('Project root: ' + $Root)

foreach ($rel in $Required) {
  if (-not (Test-Path (Join-Path $Root $rel))) {
    Fail "This toolkit must be extracted into the CURRENT AMPHON project root. Missing: $rel"
  }
}

$shop64 = Join-Path $Root 'SHOP64-OWNER-ACTIVATE.bat'
if (Test-Path $shop64) {
  Write-Host 'SHOP-6.4 tooling detected - PASS'
} else {
  Write-Warning 'SHOP64-OWNER-ACTIVATE.bat was not found. The ZIP will still be created, but verify this is the latest repo before moving machines.'
}

# Local settings are allowed only when they contain public/non-secret configuration.
$settingsFiles = @(
  (Join-Path $Root 'deployment\install.config.ps1'),
  (Join-Path $Root '.env'),
  (Join-Path $Root 'shop\.env')
) | Where-Object { Test-Path $_ }

$secretPatterns = @(
  'sk_live_[A-Za-z0-9_\-]+',
  'sk_test_[A-Za-z0-9_\-]+',
  'whsec_[A-Za-z0-9_\-]+',
  'sb_secret_[A-Za-z0-9_\-]+',
  '(?im)^\s*(SUPABASE_SECRET_KEY|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|TURNSTILE_SECRET_KEY|SUPABASE_DB_PASSWORD)\s*=\s*[^\s#]+'
)

foreach ($file in $settingsFiles) {
  $text = Get-Content -Raw -LiteralPath $file
  foreach ($pattern in $secretPatterns) {
    if ($text -match $pattern) {
      Fail "Secret-like value detected in local settings file: $file`nRemove the secret from the file before creating a transfer ZIP. Production secrets should stay in Cloudflare/Supabase/Stripe, not in the project ZIP."
    }
  }
}
Write-Host 'Local settings secret scan - PASS'

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$parent = Split-Path $Root -Parent
$projectName = Split-Path $Root -Leaf
$outZip = Join-Path $parent ("AMPHON-PROJECT-TRANSFER-$timestamp.zip")
$stageBase = Join-Path $env:TEMP ("amphon-transfer-$timestamp")
$stageRoot = Join-Path $stageBase $projectName

if (Test-Path $stageBase) { Remove-Item -LiteralPath $stageBase -Recurse -Force }
New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null

Heading 'Copy current source and local public settings'

$excludeDirs = @(
  'node_modules', 'dist', '.astro', '.wrangler', '.cache', '.vite', '.turbo', '.vercel', '.output',
  '.parcel-cache', 'coverage', '.temp'
)
$excludeFiles = @(
  '*.log', '*.tmp', '*.shop62-routefix.bak',
  'amphon-worker-secrets-*.json', 'amphon-stripe-webhook-*.json', 'amphon-shop62-*.secret*'
)

$robocopyArgs = @(
  $Root, $stageRoot,
  '/E', '/COPY:DAT', '/DCOPY:DAT', '/R:1', '/W:1', '/XJ', '/NFL', '/NDL', '/NJH', '/NJS', '/NP'
)
foreach ($d in $excludeDirs) { $robocopyArgs += '/XD'; $robocopyArgs += $d }
foreach ($f in $excludeFiles) { $robocopyArgs += '/XF'; $robocopyArgs += $f }

& robocopy.exe @robocopyArgs | Out-Null
$rc = $LASTEXITCODE
if ($rc -gt 7) { Fail "robocopy failed with exit code $rc" }

# Add a transfer manifest for the new machine.
$manifest = New-Object System.Collections.Generic.List[string]
$manifest.Add('AMPHON PROJECT TRANSFER MANIFEST')
$manifest.Add(('Created: ' + (Get-Date).ToString('o')))
$manifest.Add(('Source: ' + $Root))
$manifest.Add('Purpose: continue development on another laptop; no production activation is performed.')
$manifest.Add('')
$manifest.Add('IMPORTANT CURRENT SAFETY STATE')
$manifest.Add('- SHOP-6.3 final activation readiness passed before handoff.')
$manifest.Add('- SHOP-6.2 isolated Stripe TEST provider E2E passed before handoff.')
$manifest.Add('- SHOP-6.4 tooling was prepared, but owner activation was intentionally NOT executed.')
$manifest.Add('- purchase_enabled should remain FALSE until the owner explicitly resumes SHOP-6.4.')
$manifest.Add('')

try { $manifest.Add(('Node on old laptop: ' + (& node --version))) } catch { $manifest.Add('Node on old laptop: unavailable') }
try { $manifest.Add(('npm on old laptop: ' + (& npm --version))) } catch { $manifest.Add('npm on old laptop: unavailable') }

if ((Test-Path (Join-Path $Root '.git')) -and (Get-Command git -ErrorAction SilentlyContinue)) {
  $manifest.Add('')
  $manifest.Add('GIT STATUS AT EXPORT')
  Push-Location $Root
  try {
    $gitLines = & git status --short --branch 2>&1
    foreach ($line in $gitLines) { $manifest.Add([string]$line) }
  } finally { Pop-Location }
} else {
  $manifest.Add('')
  $manifest.Add('Git metadata/status not available. If .git exists, it is still copied unless excluded by filesystem behavior.')
}

$critical = @(
  'deployment\install.config.ps1', '.env', 'shop\.env',
  'SHOP62-PROVIDER-E2E.bat', 'SHOP62-FINAL-ACTIVATION-CHECK.bat',
  'SHOP63-CONFIGURE-PRODUCTION.bat', 'SHOP64-OWNER-ACTIVATE.bat', 'SHOP64-EMERGENCY-CLOSE.bat',
  'deployment\SHOP64-OWNER-ACTIVATE.ps1', 'deployment\SHOP64-EMERGENCY-CLOSE.ps1'
)
$manifest.Add('')
$manifest.Add('CRITICAL FILE PRESENCE')
foreach ($rel in $critical) {
  $manifest.Add(('{0} : {1}' -f $rel, $(if (Test-Path (Join-Path $Root $rel)) { 'PRESENT' } else { 'MISSING' })))
}

$manifestPath = Join-Path $stageRoot 'TRANSFER-MANIFEST.txt'
[System.IO.File]::WriteAllLines($manifestPath, $manifest, (New-Object System.Text.UTF8Encoding($false)))

# The transfer package carries setup helpers inside the project too.
$toolRoot = Split-Path $PSScriptRoot -Parent
Copy-Item -LiteralPath (Join-Path $toolRoot 'SETUP-NEW-LAPTOP.bat') -Destination (Join-Path $stageRoot 'SETUP-NEW-LAPTOP.bat') -Force
Copy-Item -LiteralPath (Join-Path $toolRoot 'VERIFY-NEW-LAPTOP.bat') -Destination (Join-Path $stageRoot 'VERIFY-NEW-LAPTOP.bat') -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'SETUP-NEW-LAPTOP.ps1') -Destination (Join-Path $stageRoot 'deployment\SETUP-NEW-LAPTOP.ps1') -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'VERIFY-NEW-LAPTOP.ps1') -Destination (Join-Path $stageRoot 'deployment\VERIFY-NEW-LAPTOP.ps1') -Force
Copy-Item -LiteralPath (Join-Path $toolRoot 'NEW-LAPTOP-README_TH.md') -Destination (Join-Path $stageRoot 'NEW-LAPTOP-README_TH.md') -Force

Heading 'Create ZIP'
if (Test-Path $outZip) { Remove-Item -LiteralPath $outZip -Force }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($stageBase, $outZip, [System.IO.Compression.CompressionLevel]::Optimal, $false)

$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $outZip).Hash.ToLowerInvariant()
$sizeMB = [Math]::Round((Get-Item -LiteralPath $outZip).Length / 1MB, 2)
Write-Host ('Transfer ZIP: ' + $outZip)
Write-Host ('Size: ' + $sizeMB + ' MB')
Write-Host ('SHA256: ' + $hash)
Write-Host ''
Write-Host 'Copy THIS ZIP to the new laptop.'
Write-Host 'Do not copy node_modules/dist. They will be rebuilt there.'
Write-Host 'Do not copy Cloudflare/Supabase CLI credential caches. Login again on the new laptop.'

Remove-Item -LiteralPath $stageBase -Recurse -Force
