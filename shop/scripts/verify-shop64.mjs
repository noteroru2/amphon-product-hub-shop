import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const failures = []
const required = [
  'deployment/SHOP64-OWNER-ACTIVATE.ps1',
  'SHOP64-OWNER-ACTIVATE.bat',
  'deployment/SHOP64-EMERGENCY-CLOSE.ps1',
  'SHOP64-EMERGENCY-CLOSE.bat',
  'SHOP6_4_OWNER_ACTIVATION_REPORT.md',
]

for (const file of required) {
  try { await access(resolve(root, file)) } catch { failures.push(`missing ${file}`) }
}

const activation = await readFile(resolve(root, 'deployment/SHOP64-OWNER-ACTIVATE.ps1'), 'utf8')
const emergency = await readFile(resolve(root, 'deployment/SHOP64-EMERGENCY-CLOSE.ps1'), 'utf8')
const activationBat = await readFile(resolve(root, 'SHOP64-OWNER-ACTIVATE.bat'), 'utf8')
const emergencyBat = await readFile(resolve(root, 'SHOP64-EMERGENCY-CLOSE.bat'), 'utf8')
const report = await readFile(resolve(root, 'SHOP6_4_OWNER_ACTIVATION_REPORT.md'), 'utf8')

function requireText(text, value, label) {
  if (!text.includes(value)) failures.push(`missing ${label}: ${value}`)
}

for (const [value, label] of [
  ["$stripePhrase -cne 'I CONFIRM STRIPE LIVE'", 'exact live Stripe confirmation'],
  ["$activationPhrase -cne 'ACTIVATE AMPHON SHOP'", 'exact activation confirmation'],
  ["$activationBody = @{ purchase_enabled=$true }", 'activation body boundary'],
  ["$rollbackBody = @{ purchase_enabled=$false }", 'rollback body boundary'],
  ["Write-ActivationReport 'ACTIVATED'", 'activation report result'],
  ["'ROLLED_BACK'", 'automatic rollback result'],
  ["'ROLLBACK_FAILED'", 'rollback failure result'],
  ["$finalPurchaseEnabled = 'UNKNOWN'", 'unknown final-state safety report'],
  ["if ($activationRequestAttempted) {", 'rollback attempt-only gate'],
  ["$failureResult = 'FAILED_PREFLIGHT'", 'preflight terminal result'],
  ["$failureResult = 'CANCELLED'", 'cancelled terminal result'],
  ["$ReportsPath = Join-Path $Root 'reports'", 'report archive directory'],
  ['SHOP6_4_OWNER_ACTIVATION_${archiveStamp}_${archiveNonce}_${safeResult}.md', 'timestamped report archive'],
  ['No order or charge was created.', 'non-transactional smoke contract'],
  ['Temporary E2E Worker removed', 'isolated Worker cleanup gate'],
  ['No production SHOP62 test secret', 'production bypass-secret gate'],
  ['Provider evidence:', 'provider evidence gate'],
  ['No active AT-TST fixtures', 'test fixture gate'],
  ['Post-activation Store settings', 'post-activation public read-back'],
]) requireText(activation, value, label)

for (const [value, label] of [
  ["$confirmation -cne 'CLOSE'", 'exact emergency confirmation'],
  ["$closeBody = @{ purchase_enabled=$false }", 'emergency close body boundary'],
  ['purchase_enabled=false verified', 'emergency read-back'],
]) requireText(emergency, value, label)

function inspectMutationBoundary(text, expectedPatchCount, label) {
  const mutationCalls = [...text.matchAll(/Invoke-WebRequest\b[^\r\n]*?-Method\s+(Patch|Post|Put|Delete)\b[^\r\n]*/gi)]
  if (mutationCalls.length !== expectedPatchCount) {
    failures.push(`${label}: expected ${expectedPatchCount} mutating HTTP call(s), found ${mutationCalls.length}`)
  }
  if (mutationCalls.some((match) => match[1].toLowerCase() !== 'patch')) {
    failures.push(`${label}: remote mutation verb other than PATCH found`)
  }

  const mutationBodies = [...text.matchAll(/\$(activationBody|rollbackBody|closeBody)\s*=\s*@\{([^}]*)\}/g)]
  if (mutationBodies.length !== expectedPatchCount) {
    failures.push(`${label}: expected ${expectedPatchCount} explicit mutation body/bodies, found ${mutationBodies.length}`)
  }
  for (const [, name, body] of mutationBodies) {
    const keys = [...body.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*=/g)].map((match) => match[1])
    if (keys.length !== 1 || keys[0] !== 'purchase_enabled') {
      failures.push(`${label}: $${name} may mutate fields other than purchase_enabled (${keys.join(', ') || 'unparseable'})`)
    }
  }
}

inspectMutationBoundary(activation, 2, 'owner activation')
inspectMutationBoundary(emergency, 1, 'emergency close')

const outerCatchIndex = activation.lastIndexOf('\ncatch {')
const outerCatch = outerCatchIndex >= 0 ? activation.slice(outerCatchIndex) : ''
const attemptedTrueIndexes = [...activation.matchAll(/\$activationRequestAttempted\s*=\s*\$true/g)].map((match) => match.index)
const activationPatchIndex = activation.indexOf('Invoke-WebRequest -UseBasicParsing -Method Patch -Uri $writeUri')
if (outerCatchIndex < 0 || !outerCatch.includes('if ($activationRequestAttempted) {')) {
  failures.push('pre-write failure guard missing: rollback must be gated only by activationRequestAttempted')
}
if (/if\s*\([^\r\n]*\$activationRequestAttempted[^\r\n]*-or/i.test(outerCatch) ||
    /current\.purchase_enabled/i.test(outerCatch)) {
  failures.push('unsafe rollback gate: current purchase_enabled must not independently trigger rollback')
}
if (attemptedTrueIndexes.length !== 1 || activationPatchIndex < 0 || attemptedTrueIndexes[0] > activationPatchIndex) {
  failures.push('activationRequestAttempted must become true exactly once, immediately before the activation PATCH can run')
}
const mutationIndexes = [...activation.matchAll(/Invoke-WebRequest\b[^\r\n]*?-Method\s+(?:Patch|Post|Put|Delete)\b/gi)].map((match) => match.index)
if (mutationIndexes.some((index) => index < attemptedTrueIndexes[0])) {
  failures.push('pre-write/preflight path contains a remote mutation before activationRequestAttempted=true')
}
if (!activation.includes('[System.IO.File]::WriteAllLines((Join-Path $ReportsPath $archiveName)') ||
    !activation.includes("try { Write-ActivationReport 'ACTIVATED' $Snapshot $true }") ||
    !activation.includes('production state was not changed because of this reporting error')) {
  failures.push('best-effort timestamped report archival contract missing')
}

if (/purchase_enabled\s*=\s*\$true/i.test(emergency)) failures.push('emergency close must never enable purchasing')
if (/\b(sk_(?:live|test)|whsec_|sb_secret_)[A-Za-z0-9_-]{8,}/.test(activation + emergency + report)) {
  failures.push('secret-like literal found in SHOP-6.4 artifacts')
}
if (!activationBat.includes('CHECK-INSTALLER.ps1') || !emergencyBat.includes('CHECK-INSTALLER.ps1')) {
  failures.push('BAT wrappers must run the PowerShell parser gate')
}
for (const value of ['Timestamp:', 'Result:', 'confirmation received:', 'Final purchase_enabled:', 'Configuration snapshot (no secrets)', 'HTTP results']) {
  if (!activation.includes(value) && !report.includes(value)) failures.push(`report contract missing: ${value}`)
}

if (failures.length) {
  console.error('SHOP-6.4 VERIFY: FAIL')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('SHOP-6.4 VERIFY: PASS')
console.log(`Required files: ${required.length}/${required.length}`)
console.log('Owner confirmations: PASS')
console.log('Remote mutation boundary (purchase_enabled only): PASS')
console.log('Automatic rollback/read-back contract: PASS')
console.log('Pre-write failure mutation guard: PASS')
console.log('Timestamped report archival: PASS')
console.log('Emergency close contract: PASS')
console.log('Activation execution: NOT RUN')
