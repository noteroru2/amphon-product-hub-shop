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
function Run([string]$Label, [scriptblock]$Command) {
  Write-Host ('> ' + $Label)
  & $Command
  if ($LASTEXITCODE -ne 0) { throw "$Label failed with exit code $LASTEXITCODE" }
}

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Heading 'AMPHON PROJECT - NEW LAPTOP SETUP (NO DEPLOY / NO ACTIVATION)'
Write-Host ('Project root: ' + $Root)
Write-Host 'This setup never changes Supabase, Cloudflare, Stripe, or purchase_enabled.'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js is not installed. Install Node 24.14.1 (the last tested environment), reopen PowerShell, and run this file again.'
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'npm is not available.' }

Write-Host ('Node: ' + (& node --version))
Write-Host ('npm: ' + (& npm --version))

$projects = @(
  @{ Name='Product Hub'; Path=$Root },
  @{ Name='API Worker'; Path=(Join-Path $Root 'workers\r2-upload') },
  @{ Name='Shop'; Path=(Join-Path $Root 'shop') }
)
foreach ($p in $projects) {
  if (-not (Test-Path (Join-Path $p.Path 'package.json'))) { throw "Missing package.json: $($p.Path)" }
  Push-Location $p.Path
  try {
    if (Test-Path (Join-Path $p.Path 'package-lock.json')) {
      Run "npm ci [$($p.Name)]" { npm ci }
    } else {
      Run "npm install [$($p.Name)]" { npm install }
    }
  } finally { Pop-Location }
}

Heading 'CLI authentication on the new laptop'
Write-Host 'Supabase and Cloudflare OAuth/access-token caches are intentionally NOT transferred.'
Write-Host 'Run these when you need remote access:'
Write-Host '  npx supabase@latest login'
Write-Host '  npx wrangler login'
Write-Host ''
Write-Host 'Production secrets are already stored remotely in Cloudflare and do not need to be copied into this project.'
Write-Host 'Database passwords / Supabase server secret / Stripe keys should be entered only when a script explicitly prompts for them.'

Heading 'Local configuration presence'
$files = @('deployment\install.config.ps1', '.env', 'shop\.env', 'SHOP64-OWNER-ACTIVATE.bat', 'SHOP64-EMERGENCY-CLOSE.bat')
foreach ($rel in $files) {
  Write-Host (('{0,-48} {1}' -f $rel, $(if (Test-Path (Join-Path $Root $rel)) { 'PRESENT' } else { 'MISSING' })))
}

Write-Host ''
Write-Host 'Setup complete. Next run VERIFY-NEW-LAPTOP.bat.'
Write-Host 'DO NOT run SHOP64-OWNER-ACTIVATE.bat until you intentionally resume owner activation.'
