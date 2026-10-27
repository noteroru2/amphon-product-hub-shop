import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const migration = readFileSync(new URL('../supabase/migrations/20261026182000_facebook_safe_resume_after_meta_368.sql', import.meta.url),'utf8')
const cron = readFileSync(new URL('../workers/r2-upload/src/index.ts', import.meta.url),'utf8')
const publisher = readFileSync(new URL('../workers/r2-upload/src/channel-auth.ts', import.meta.url),'utf8')

test('both publication lanes share one per-page, Bangkok-local daily limit',()=>{
  assert.match(migration,/CREATE OR REPLACE FUNCTION public\.facebook_rotation_claim_due/)
  assert.match(migration,/q2\.post_id FROM public\.facebook_rotation_queue/)
  assert.match(migration,/SELECT l\.post_id FROM public\.facebook_post_ledger/)
  assert.match(migration,/\bUNION\b/)
  assert.match(migration,/s\.page_daily_budget/)
  assert.match(migration,/s\.min_page_gap_minutes/)
  assert.match(migration,/j\.post_id IS NULL/)
  assert.doesNotMatch(migration,/IF j\.lane='ROTATION' THEN/)
})

test('database claim ignores both pages while cooldown is active without consuming attempts',()=>{
  assert.match(migration,/FROM public\.facebook_page_write_state w/)
  assert.match(migration,/w\.retry_at>now\(\)/)
  assert.match(migration,/coalesce\(q\.next_attempt_at,q\.scheduled_at\)<=now\(\)/)
})

test('Meta 368 persists 24h page quiet period and sends a critical dashboard alert',()=>{
  assert.match(migration,/:368:/)
  assert.match(migration,/WHEN v_is_meta_block THEN interval '24 hours'/)
  assert.match(migration,/WHEN p_error IS NULL THEN interval '20 minutes'/)
  assert.match(migration,/FACEBOOK_RATE_LIMITED','CRITICAL'/)
  assert.match(migration,/INSERT INTO public\.distribution_alerts/)
  assert.match(migration,/GREATEST\(retry_at,now\(\)/)
})

test('recovery probes a new post before bulk sold edits and preserves Graph error codes',()=>{
  const scheduled=cron.slice(cron.indexOf('async scheduled('))
  const position=(needle)=>scheduled.indexOf(needle)
  assert.ok(position('runFacebookRotationSweep(env)') >= 0)
  assert.ok(position('runFacebookRotationSweep(env)') < position('runFacebookSoldSyncSweep(env)'))
  assert.ok(position('runFacebookRotationSweep(env)') < position('runFacebookWarrantyRepairSweep(env)'))
  assert.match(publisher,/FACEBOOK_PUBLISH_FAILED:'\+\(j\.error\?\.code/)
  assert.match(publisher,/PHOTO_UPLOAD_FAILED:'\+\(uj\.error\?\.code/)
})

test('a Meta sold-edit restriction pauses only automatic sold editing, never disables posting or clears cooldown',()=>{
  const editPause=readFileSync(new URL('../supabase/migrations/20261027195500_facebook_sold_edit_circuit_breaker.sql', import.meta.url),'utf8')
  assert.match(editPause,/ADD COLUMN IF NOT EXISTS sold_sync_paused boolean NOT NULL DEFAULT false/)
  assert.match(editPause,/SET sold_sync_paused=true/)
  assert.match(editPause,/s\.sold_sync_paused=false/)
  assert.match(editPause,/CREATE OR REPLACE FUNCTION public\.facebook_sold_sync_candidates/)
  assert.doesNotMatch(editPause,/UPDATE public\.facebook_page_write_state/)
  assert.doesNotMatch(editPause,/UPDATE public\.facebook_rotation_queue/)
  assert.doesNotMatch(editPause,/SET enabled=false/)
  assert.doesNotMatch(editPause,/SET dry_run=true/)
})

test('Control Tower tells staff that scheduled publishing stays active while sold edits are paused',()=>{
  const dashboard=readFileSync(new URL('../src/components/DistributionControlTower.tsx', import.meta.url),'utf8')
  const worker=readFileSync(new URL('../workers/r2-upload/src/index.ts', import.meta.url),'utf8')
  assert.match(worker,/facebookAutomation: \{/)
  assert.match(worker,/soldSyncPaused: Boolean\(facebookSettings\[0\]\?\.sold_sync_paused\)/)
  assert.match(dashboard,/facebookAutomation\?\.soldSyncPaused/)
  assert.match(dashboard,/Error 368/)
})
