import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
const source = readFileSync(new URL('../src/lib/seoGrowthSignals.ts', import.meta.url), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
const { activeOpportunity, guardNotes, guardLabels } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const now = Date.parse('2026-10-12T03:00:00Z')
test('stale, invalid, future and dismissed evidence cannot become an actionable opportunity', () => {
  assert.equal(activeOpportunity({ source_at: '2026-10-10T00:00:00Z', status: 'OPEN' }, now), true)
  for (const source_at of ['invalid', '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z']) assert.equal(activeOpportunity({ source_at, status: 'OPEN' }, now), false)
  for (const status of ['DISMISSED', 'REVIEWED', 'STALE']) assert.equal(activeOpportunity({ source_at: '2026-10-10T00:00:00Z', status }, now), false)
})
test('pending checks are unknown rather than missing metadata or indexed', () => {
  assert.deepEqual(guardNotes({ completed_at: null }), ['รอผลตรวจ • ยังสรุปไม่ได้'])
  assert.ok(!guardLabels.HTTP_OK.includes('ดัชนี'))
})
test('guard findings distinguish noindex and metadata changes from parse gaps', () => {
  const row = { completed_at: '2026-10-12', error: null, noindex: true, title: 'Title', canonical: 'https://example.com/', h1_count: 1, changed: true }
  assert.equal(guardNotes(row).length, 2)
  assert.equal(guardNotes({ ...row, noindex: false, changed: false }).length, 0)
})
test('growth proposals cannot enter the legacy executor and service-only helpers stay private', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261012031909_seo_growth_engine.sql', import.meta.url), 'utf8')
  assert.ok(!/insert into public\.commerce_gsc_action_queue/i.test(sql))
  assert.match(sql, /role_name<>'owner'/)
  assert.match(sql, /security_invoker=true/)
  assert.match(sql, /revoke all on function private\.seo_keyword/)
  assert.match(sql, /on conflict\(site_id,query,page,kind\)/)
  assert.match(sql, /g\.coverage='SITE_TOTAL'/)
})
