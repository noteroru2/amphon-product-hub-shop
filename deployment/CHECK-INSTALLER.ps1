param(
  [Parameter(Mandatory = $true)]
  [Alias('Target')]
  [string]$Path
)

$ErrorActionPreference = 'Stop'
$resolved = (Resolve-Path $Path).Path
$tokens = $null
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile($resolved, [ref]$tokens, [ref]$errors) | Out-Null
if ($errors -and $errors.Count -gt 0) {
  Write-Host "PowerShell parser check - FAILED" -ForegroundColor Red
  foreach ($err in $errors) {
    $line = $err.Extent.StartLineNumber
    $col = $err.Extent.StartColumnNumber
    Write-Host ("Line {0}, Column {1}: {2}" -f $line, $col, $err.Message) -ForegroundColor Red
  }
  exit 10
}
Write-Host "PowerShell parser check - PASS" -ForegroundColor Green
exit 0
