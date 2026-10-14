import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const rotation = readFileSync(new URL('../supabase/migrations/20261014152000_facebook_arrival_aware_daily_budget.sql', import.meta.url), 'utf8')
const gsc = readFileSync(new URL('../supabase/migrations/20261014154500_gsc_direct_action_measurement_bridge.sql', import.meta.url), 'utf8')

test('arrival jobs win the queue and remain outside the daily rotation cap', () => {
  assert.match(rotation, /case when q\.lane='NEW_ARRIVAL' then 0 else 1 end/)
  assert.match(rotation, /if j\.lane='ROTATION' then/)
  assert.match(rotation, /from public\.facebook_rotation_queue x where x\.connection_key=j\.connection_key and x\.post_id is not null/)
  assert.doesNotMatch(rotation, /where x\.connection_key=j\.connection_key and x\.lane='ROTATION' and x\.post_id is not null/)
})
test('direct GSC data retains the actual fetched timestamp and only main site', () => {
  assert.match(gsc, /snap\.site_id='amphon'/)
  assert.match(gsc, /site\.gsc_property='sc-domain:amphon\.co\.th'/)
  assert.match(gsc, /source=excluded\.source,fetched_at=excluded\.fetched_at/)
  assert.match(gsc, /s\.source_at/)
  assert.match(gsc, /site_id='amphon'/)
  assert.match(gsc, /interval '30 hours'/)
  assert.doesNotMatch(gsc, /drop table|delete from public\.commerce_gsc_action_measurements/i)
})
