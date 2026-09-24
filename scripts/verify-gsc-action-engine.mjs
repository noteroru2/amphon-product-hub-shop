import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

const [migration, app, center, client] = await Promise.all([
  read('../supabase/migrations/20260924153000_gsc_action_engine.sql'),
  read('../src/App.tsx'),
  read('../src/components/SeoOpportunityCenter.tsx'),
  read('../src/lib/seoOpportunities.ts'),
])

const checks = [
  ['queue is page-clustered instead of query-spam', migration.includes('unique (property, page)') && migration.includes('query_count integer')],
  ['fresh opportunities only', migration.includes("fetched_at >= now() - interval '3 days'")],
  ['action execution is scoped to main site and Shop only', migration.includes("page like 'https://amphon.co.th/%'") && migration.includes("page like 'https://shop.amphon.co.th/%'")],
  ['brand queries are guarded from SEO rewrites', migration.includes("'BRAND_WATCH'") && migration.includes("lower(p.primary_query) ~ '(amphon|amphontd|อำพล|อําพล)'")],
  ['protect actions are auto-guarded', migration.includes("'PROTECT_PAGE'") && migration.includes("'AUTO_GUARD'") && migration.includes("'PROTECTED'")],
  ['CTR actions explicitly forbid automatic rewrite', migration.includes('ห้าม auto-rewrite')],
  ['action queue is owner/admin only', migration.includes("public.current_user_role() in ('owner','admin')")],
  ['action status mutation is constrained', migration.includes('set_gsc_action_status') && migration.includes('INVALID_GSC_ACTION_STATUS')],
  ['15-minute SEO cron refreshes action queue', migration.includes('refresh_commerce_gsc_action_queue()')],
  ['Hub exposes owner/admin SEO center', app.includes('SeoOpportunityCenter') && app.includes('seo-opportunities') && app.includes('SEO Action Center')],
  ['Hub shows GSC metrics and guarded recommendation', center.includes('Impressions') && center.includes('Position') && center.includes('ระบบแนะนำ') && center.includes('Guard เปิดอยู่')],
  ['Hub can approve or dismiss without editing SEO fields directly', center.includes("'APPROVED'") && center.includes("'DISMISSED'") && !center.includes('.from(')],
  ['browser client uses guarded RPC for status', client.includes("rpc('set_gsc_action_status'") && client.includes("from('commerce_gsc_action_queue')")],
]

const failed = checks.filter(([, ok]) => !ok)
for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`)
if (failed.length) {
  console.error(`GSC ACTION ENGINE verification failed: ${failed.map(([label]) => label).join(', ')}`)
  process.exit(1)
}
console.log('GSC ACTION ENGINE PASS — clustered opportunities, review guard, protect guard and Hub controls are protected')
