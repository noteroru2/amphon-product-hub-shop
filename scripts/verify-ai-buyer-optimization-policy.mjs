import fs from 'node:fs'

const jsonPath = 'workers/ai-buyer/data/optimization-policy-v1.json'
const specPath = 'docs/ai-buyer/A_IMPLEMENTATION_SPEC.md'
const rulesPath = 'docs/ai-buyer/B_CATEGORY_RULES.md'

for (const path of [jsonPath, specPath, rulesPath]) {
  if (!fs.existsSync(path)) throw new Error('AI Buyer optimization artifact missing: ' + path)
}

const policy = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
if (policy.version !== 'AMPHON_AI_BUYER_OPTIMIZATION_V1') throw new Error('Optimization policy version mismatch')
if (policy.runtime?.aiPausedDuringOptimization !== true) throw new Error('Optimization policy must keep AI paused')
if (policy.global?.rules?.neverAskForSameEvidenceTwice !== true) throw new Error('Duplicate evidence guard missing')
if (policy.global?.rules?.photosAreOptionalWhenPricingEvidenceSufficient !== true) throw new Error('Photo optionality rule missing')
if (policy.batteryPolicy?.badThresholdPercentExclusive !== 80) throw new Error('Battery threshold must remain 80')

for (const category of ['NOTEBOOK','DESKTOP_PC','SMARTPHONE','TABLET','MACBOOK','CAMERA','OTHER']) {
  if (!policy.categories?.[category]) throw new Error('Missing category optimization rule: ' + category)
}

if (policy.categories.NOTEBOOK.adjustmentsThb.BATTERY_BAD !== -800) throw new Error('Notebook battery adjustment mismatch')
if (policy.categories.SMARTPHONE.adjustmentsThb.BATTERY_BAD !== -800) throw new Error('Smartphone battery adjustment mismatch')
if (policy.categories.MACBOOK.adjustmentsThb.BATTERY_BAD !== -1500) throw new Error('MacBook battery adjustment mismatch')
if (policy.acceptance?.completeSpecStillWaitingForPhoto !== 0) throw new Error('Acceptance gate mismatch')
if (policy.acceptance?.knownBatteryBadPricedAsNormal !== 0) throw new Error('Battery acceptance gate mismatch')

console.log('AI BUYER OPTIMIZATION POLICY V1: PASS')
