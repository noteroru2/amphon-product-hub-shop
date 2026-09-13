[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
function Heading([string]$Text) { Write-Host ''; Write-Host ('='*72); Write-Host $Text; Write-Host ('='*72) }
function Run([string]$Label, [string]$Path, [scriptblock]$Command) {
  Write-Host ('> ' + $Label)
  Push-Location $Path
  try { & $Command; if ($LASTEXITCODE -ne 0) { throw "$Label failed with exit code $LASTEXITCODE" } } finally { Pop-Location }
}
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Heading 'AMPHON PROJECT - NEW LAPTOP LOCAL VERIFICATION'
Write-Host 'No deploy, no DB write, no activation.'

Run 'Product Hub typecheck' $Root { npm run typecheck }
Run 'Product Hub build' $Root { npm run build }
Run 'API Worker typecheck' (Join-Path $Root 'workers\r2-upload') { npm run typecheck }
$Shop = Join-Path $Root 'shop'
$shopScripts = @('verify:foundation','verify:shop2','verify:shop3','verify:shop4','verify:shop5','verify:shop6','verify:production-closeout','verify:shop62')
foreach ($s in $shopScripts) {
  $pkg = Get-Content -Raw (Join-Path $Shop 'package.json') | ConvertFrom-Json
  if ($null -ne $pkg.scripts.PSObject.Properties[$s]) {
    Run ("Shop $s") $Shop { npm run $s }
  }
}
Run 'Shop build' $Shop { npm run build }

Heading 'LOCAL VERIFY PASS'
Write-Host 'The project is ready to continue development on this laptop.'
Write-Host 'Production purchase activation was NOT performed.'
