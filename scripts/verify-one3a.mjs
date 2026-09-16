import { readFile } from 'node:fs/promises';

const one3 = JSON.parse(await readFile(new URL('../config/amphon-one3.json', import.meta.url), 'utf8'));
const flow = JSON.parse(await readFile(new URL('../config/amphon-one-product-flow.json', import.meta.url), 'utf8'));
const docs = await readFile(new URL('../docs/ONE_3_UNIFIED_SALE_STOCK_STATE.md', import.meta.url), 'utf8');
const backend = await readFile(new URL('../src/lib/backend.ts', import.meta.url), 'utf8');

const expectedStates = ['IN_STOCK', 'RESERVED', 'SOLD', 'REPAIR', 'RETURNED', 'WRITTEN_OFF'];
const expectedCommands = ['product.reserve_requested', 'product.release_requested', 'product.mark_sold_requested'];
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

check(one3.contractVersion === 'ONE-3.0', 'ONE3_CONTRACT_VERSION');
check(one3.status === 'SOURCE_LOCKED_FAIL_CLOSED', 'ONE3_FAIL_CLOSED_STATUS');
check(one3.authority?.inventoryAvailability === 'amphon_system', 'ONE3_SYSTEM_AVAILABILITY_AUTHORITY');
check(one3.authority?.hubAvailabilityRole === 'projection', 'ONE3_HUB_PROJECTION_ROLE');
check(one3.authority?.shopAvailabilityRole === 'requester_only', 'ONE3_SHOP_REQUESTER_ROLE');
check(one3.authority?.hubBrowserMayMutateOneManagedAvailabilityDirectly === false, 'ONE3_BROWSER_DIRECT_ONE_AVAILABILITY_PROHIBITED');
check(JSON.stringify(one3.states) === JSON.stringify(expectedStates), 'ONE3_CANONICAL_STATES');
check(expectedCommands.every((name) => one3.systemToHubCommands?.includes(name)), 'ONE3_REQUIRED_PROJECTION_COMMANDS');
check(one3.hubToSystemEvents?.includes('product.availability_changed'), 'ONE3_AVAILABILITY_ACK_EVENT');
check(one3.commandContract?.availabilityVersionRequired === true, 'ONE3_MONOTONIC_VERSION_REQUIRED');
check(one3.commandContract?.staleVersionPolicy === 'IGNORE_AS_DUPLICATE_OR_STALE', 'ONE3_STALE_VERSION_POLICY');
check(one3.featureFlags?.hubStockConsumer === 'ONE3_STOCK_CONSUMER_ENABLED', 'ONE3_HUB_FLAG_NAME');
check(one3.featureFlags?.default === false, 'ONE3_FLAGS_DEFAULT_FALSE');

check(flow.flowVersion === 'ONE-3.0', 'ONE3_FLOW_VERSION');
check(flow.availability?.masterAfterHubSync === 'amphon_system', 'ONE3_FLOW_SYSTEM_MASTER');
check(flow.availability?.hubRole === 'projection', 'ONE3_FLOW_HUB_PROJECTION');
check(flow.availability?.versionOwner === 'amphon_system', 'ONE3_FLOW_VERSION_OWNER');
check(flow.hubEnrichment?.qcStage === false, 'ONE3_NO_QC_STAGE');
check(flow.hubEnrichment?.technicalInspectionStage === false, 'ONE3_NO_TECHNICAL_INSPECTION_STAGE');

check(docs.includes('supersedes the earlier rule'), 'ONE3_EXPLICIT_AUTHORITY_AMENDMENT');
check(docs.includes('ONE3_STOCK_CONSUMER_ENABLED=false'), 'ONE3_DOC_HUB_FLAG_FAIL_CLOSED');
check(docs.includes('Shop checkout/order integration remains ONE-4'), 'ONE3_DOC_ONE4_BOUNDARY');

// ONE-3A documents the existing legacy direct status path as migration debt.
// ONE-3C will replace direct ONE-managed reserved/sold writes with the Bridge projection path.
check(backend.includes('export async function quickChangeProductStatus'), 'ONE3_KNOWN_HUB_STATUS_PATH_PRESENT_FOR_3C_MIGRATION');

if (failures.length) {
  console.error('AMPHON ONE-3A HUB: FAIL');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('AMPHON ONE-3A HUB: PASS — Hub is locked as System availability projection, Shop is requester-only and runtime remains fail-closed');
