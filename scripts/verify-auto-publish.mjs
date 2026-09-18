import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFile(resolve(root, path), 'utf8')

const [migration, cronMigration, worker, entry, wrangler, publishCenter, commerceAdmin, types, autoClient] = await Promise.all([
  read('supabase/migrations/20260918161500_commerce_auto_publish.sql'),
  read('supabase/migrations/20260918164200_commerce_auto_publish_cron.sql'),
  read('workers/r2-upload/src/index.ts'),
  read('workers/r2-upload/src/one4c-entry.ts'),
  read('workers/r2-upload/wrangler.jsonc'),
  read('src/components/PublishCenter.tsx'),
  read('src/components/CommerceAdmin.tsx'),
  read('src/types/product.ts'),
  read('src/lib/autoPublish.ts'),
])

const checks = [
  ['Auto publish defaults ON', migration.includes('auto_publish_enabled boolean not null default true')],
  ['Auto publish default delay is 180 seconds', migration.includes('auto_publish_delay_seconds integer not null default 180')],
  ['Queue is durable server-side', migration.includes('create table if not exists public.commerce_auto_publish_queue')],
  ['Queue writes are service-only', migration.includes('revoke insert, update, delete on table public.commerce_auto_publish_queue from authenticated') && migration.includes('grant select, insert, update, delete on table public.commerce_auto_publish_queue to service_role')],
  ['Eligibility reuses ONE readiness', migration.includes('one_photos_complete') && migration.includes('one_specs_complete') && migration.includes('one_listing_content_complete') && migration.includes('private.one2c_specs_complete') && migration.includes('private.one2c_listing_content_complete')],
  ['Eligibility requires public cover and minimum photo count', migration.includes('v_image_count < 2') && migration.includes('is_cover and public_url is not null')],
  ['Queue starts a stabilization timer from readiness', migration.includes("make_interval(secs => coalesce(v_delay, 180))")],
  ['Claim uses SKIP LOCKED', migration.includes('for update skip locked')],
  ['Auto publish execution is service-role only', migration.includes('revoke all on function public.execute_commerce_auto_publish(uuid,text) from authenticated') && migration.includes('grant execute on function public.execute_commerce_auto_publish(uuid,text) to service_role')],
  ['Auto publish does not mutate ONE availability', !/set\s+one_availability/i.test(migration) && !/one_availability\s*=/.test(migration)],
  ['Auto publish preserves explicit index governance', migration.includes("when public.commerce_listings.index_policy = 'HOLD' then 'INDEX'")],
  ['Retry policy exists', migration.includes('website_auto_publish_retry_scheduled') && migration.includes('q.attempt_count >= 5')],
  ['Database Cron runs auto publish every minute', cronMigration.includes("create extension if not exists pg_cron") && cronMigration.includes("'commerce-auto-publish-minute'") && cronMigration.includes("'* * * * *'")],
  ['Database Cron calls the same locked claim/execute/fail flow', cronMigration.includes('claim_commerce_auto_publish') && cronMigration.includes('execute_commerce_auto_publish') && cronMigration.includes('fail_commerce_auto_publish')],
  ['Database Cron processor is not exposed to app roles', cronMigration.includes('revoke all on function private.process_commerce_auto_publish_batch(integer) from authenticated')],
  ['Worker claims queue from server-side RPC', worker.includes("rpc/claim_commerce_auto_publish") && worker.includes('runCommerceAutoPublishSweep')],
  ['Worker executes and marks failed jobs through RPC', worker.includes("rpc/execute_commerce_auto_publish") && worker.includes("rpc/fail_commerce_auto_publish")],
  ['Worker separates one-minute auto publish from five-minute reservation sweep', worker.includes("cron === '* * * * *'") && worker.includes("cron === '*/5 * * * *'")],
  ['ONE-4 stock command drain keeps five-minute cadence', entry.includes("cron === '*/5 * * * *'")],
  ['Wrangler schedules both cadences', wrangler.includes('"* * * * *"') && wrangler.includes('"*/5 * * * *"')],
  ['Hub exposes Auto Publish settings', types.includes('autoPublish?:') && commerceAdmin.includes('เปิด Auto Publish ไป AMPHON SHOP') && commerceAdmin.includes('3 นาที — กันข้อมูลระหว่างแก้ไข')],
  ['Publish Center shows automatic status and keeps manual fallback', publishCenter.includes('Auto Publish เปิดอยู่') && publishCenter.includes('ลงสินค้าที่พร้อมแล้วทั้งหมด')],
  ['Hub queue client is read-only', autoClient.includes(".from('commerce_auto_publish_queue')") && !autoClient.includes('.insert(') && !autoClient.includes('.update(') && !autoClient.includes('.delete(')],
]

const failed = checks.filter(([, ok]) => !ok)
for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`)

if (failed.length) {
  console.error(`AUTO PUBLISH verification failed: ${failed.map(([label]) => label).join(', ')}`)
  process.exit(1)
}

console.log('AUTO PUBLISH verification PASS — readiness waits three minutes, publishes server-side, retries safely, and never changes ONE availability')
