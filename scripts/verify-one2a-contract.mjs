import { readFile } from 'node:fs/promises'

const bridge = JSON.parse(await readFile(new URL('../config/amphon-one-bridge.json', import.meta.url), 'utf8'))

function assert(condition, message) {
  if (!condition) throw new Error(`ONE-2A CONTRACT FAIL: ${message}`)
}

assert(bridge.one2a?.systemIntakeHook?.sourceReady === true, 'System intake hook sourceReady missing')
assert(bridge.one2a?.systemIntakeHook?.productionAccepted === false, 'ONE-2A must not be production accepted yet')
assert(bridge.one2a?.systemIntakeHook?.existingStaffWorkflowChanged === false, 'existing AMPHON System intake workflow must remain unchanged')
assert(bridge.one2a?.systemIntakeHook?.technicalInspectionStageAdded === false, 'Technical Inspection must not be added')
assert(bridge.one2a?.systemIntakeHook?.qcStageAdded === false, 'QC stage must not be added')
assert(bridge.one2a?.physicalIdentity?.oneSkuPerPhysicalUnit === true, 'Hub contract must expect one SKU per physical unit')
assert(bridge.one2a?.physicalIdentity?.quantityFanout === true, 'Hub contract must expect quantity fan-out')
assert(bridge.one2a?.physicalIdentity?.qrPayload === 'SKU', 'QR payload must remain the immutable SKU')
assert(bridge.one2a?.sku?.format === 'AT-{CATEGORY}-{YYMM}-{6_DIGIT_SEQUENCE}', 'SKU format drifted')
assert(bridge.one2a?.sku?.timezone === 'Asia/Bangkok', 'SKU period timezone drifted')
assert(bridge.intakeCreated?.entityType === 'product_intake_unit', 'Hub must consume physical intake unit events')
for (const field of ['productIdentityId', 'unitOrdinal', 'quantityInIntake', 'sku', 'qrPayload', 'name']) {
  assert(bridge.intakeCreated?.requiredPayload?.includes(field), `required intake payload missing ${field}`)
}

console.log('AMPHON ONE-2A CONTRACT: PASS — Hub expects System-owned physical SKU/QR intake units without QC or Technical Inspection stages')
