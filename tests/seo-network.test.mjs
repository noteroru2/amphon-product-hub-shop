import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../src/lib/seoNetworkSignals.ts', import.meta.url), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
const { sourceState, networkIssues } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const now = Date.parse('2026-10-10T05:00:00Z')

test('missing, paused, stale and invalid GSC must never be reported as fresh', () => {
  assert.equal(sourceState({ source_at: null, gsc_state: 'READY' }, now), 'MISSING')
  assert.equal(sourceState({ source_at: '2026-10-04T00:00:00Z', gsc_state: 'READY' }, now), 'STALE')
  assert.equal(sourceState({ source_at: 'invalid', gsc_state: 'READY' }, now), 'STALE')
  assert.equal(sourceState({ source_at: '2026-11-01T00:00:00Z', gsc_state: 'READY' }, now), 'STALE')
  assert.equal(sourceState({ source_at: '2026-10-10T00:00:00Z', gsc_state: 'BLOCKED' }, now), 'BLOCKED')
  assert.equal(sourceState({ source_at: '2026-10-10T00:00:00Z', gsc_state: 'READY' }, now), 'FRESH')
})

test('noindex and failures take priority, while unknown checks are not inferred to be errors', () => {
  const site = { source_at: null, gsc_state: 'BLOCKED', gsc_note: 'provider paused', home_status: null, robots_status: null, sitemap_status: null }
  assert.equal(networkIssues(site).filter(x => x.level === 'critical').length, 0)
  assert.equal(networkIssues({ ...site, noindex: true })[0].level, 'critical')
  assert.equal(networkIssues({ ...site, home_status: 503 })[0].level, 'critical')
  assert.equal(networkIssues({ ...site, robots_blocks_all: true })[0].level, 'critical')
  assert.ok(networkIssues({ ...site, sitemap_error: 'HTML fallback' }).some(x => x.text.includes('HTML fallback')))
})

test('scheduled checks that stop running remain visible even if the last HTTP response was 200', () => {
  assert.ok(networkIssues({ source_at: null, health_state: 'STALE', home_status: 200 }).some(x => x.text.includes('เกินรอบ')))
})
