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
  assert.match(dashboard,/facebookAutomation(?:\?\.|\.)soldSyncPaused/)
  assert.match(dashboard,/Error 368/)
})

test('publish-only migration disables catalog and price candidate fetches but preserves new-post publication',()=>{
  const migration=readFileSync(new URL('../supabase/migrations/20261031210000_facebook_publish_only_pause_existing_post_edits.sql', import.meta.url),'utf8')
  assert.match(migration,/ADD COLUMN IF NOT EXISTS price_sync_paused boolean NOT NULL DEFAULT false/)
  assert.match(migration,/ADD COLUMN IF NOT EXISTS catalog_sync_paused boolean NOT NULL DEFAULT false/)
  assert.match(migration,/sold_sync_paused=true/)
  assert.match(migration,/price_sync_paused=true/)
  assert.match(migration,/catalog_sync_paused=true/)
  assert.match(migration,/s\.catalog_sync_paused=false/)
  assert.match(migration,/s\.price_sync_paused=false/)
  assert.match(migration,/CREATE OR REPLACE FUNCTION public\.facebook_catalog_sync_candidates/)
  assert.match(migration,/CREATE OR REPLACE FUNCTION public\.facebook_price_sync_candidates/)
  assert.doesNotMatch(migration,/UPDATE public\.facebook_page_write_state/)
  assert.doesNotMatch(migration,/UPDATE public\.facebook_rotation_queue/)
  assert.doesNotMatch(migration,/SET enabled=false/)
  assert.doesNotMatch(migration,/SET dry_run=true/)
  assert.doesNotMatch(migration,/SET paused_connection_keys/)
})

test('Control Tower reports three paused edit channels and active rotation separately',()=>{
  const dashboard=readFileSync(new URL('../src/components/DistributionControlTower.tsx', import.meta.url),'utf8')
  const worker=readFileSync(new URL('../workers/r2-upload/src/index.ts', import.meta.url),'utf8')
  assert.match(worker,/priceSyncPaused: Boolean\(facebookSettings\[0\]\?\.price_sync_paused\)/)
  assert.match(worker,/catalogSyncPaused: Boolean\(facebookSettings\[0\]\?\.catalog_sync_paused\)/)
  assert.match(dashboard,/facebookAutomation\.priceSyncPaused/)
  assert.match(dashboard,/facebookAutomation\.catalogSyncPaused/)
  assert.match(dashboard,/โหมดโพสต์สินค้าอย่างเดียว/)
})

test('Meta recovery: single per-page rolling 24h gate enforces conservative pacing across all publishers',()=>{
 const sql=readFileSync(new URL('../supabase/migrations/20261101113000_facebook_pacing_rolling_24h_publish_only.sql',import.meta.url),'utf8')
 assert.match(sql,/rolling_24h_budget=3/)
 assert.match(sql,/min_page_gap_minutes=greatest\(min_page_gap_minutes,120\)/)
 assert.match(sql,/publish_window_start_hour=9,publish_window_end_hour=21/)
 assert.match(sql,/v_count>=least\(s\.page_daily_budget,s\.rolling_24h_budget\)/)
 assert.match(sql,/interval '24 hours'/)
 assert.match(sql,/GROUP BY post_id/)
 assert.match(sql,/facebook_page_publish_gate\(j\.connection_key\)/)
 assert.match(sql,/facebook_page_publish_gate\(p_connection_key\)/)
 assert.doesNotMatch(sql,/UPDATE public\.facebook_page_write_state SET retry_at=/)
 assert.doesNotMatch(sql,/SET enabled=false/)
 assert.doesNotMatch(sql,/SET dry_run=true/)
})

test('Only publish-only actions continue: manual existing-post edits reject before Graph, and errors retain trace',()=>{
 const src=readFileSync(new URL('../workers/r2-upload/src/channel-auth.ts',import.meta.url),'utf8')
 const manual=src.slice(src.indexOf('export async function facebookSyncProduct('))
 assert.ok(manual.indexOf('FACEBOOK_EXISTING_POST_EDITS_PAUSED')<manual.indexOf('graph.facebook.com'))
 assert.match(manual,/sold_sync_paused,price_sync_paused,catalog_sync_paused/)
 assert.match(src,/fbtrace_id=/)
 assert.match(src,/buc_call_pct=/)
 assert.match(src,/buc_recovery_min=/)
 assert.match(src,/PHOTO_UPLOAD_FAILED:'\+\(uj\.error\?\.code/)
 assert.match(src,/\.filter\(Boolean\)\.slice\(0,6\)/)
})

test('stale rotation migration preserves 48h queue history and never touches arrivals or posted IDs',()=>{
 const sql=readFileSync(new URL('../supabase/migrations/20261101115500_facebook_rotation_expire_stale.sql',import.meta.url),'utf8')
 assert.match(sql,/facebook_rotation_expire_stale\(48\)/)
 assert.match(sql,/q\.lane='ROTATION'/)
 assert.match(sql,/status='CANCELLED'/)
 assert.match(sql,/ROTATION_SLOT_EXPIRED_REPLAN_NEXT_WEEK/)
 assert.match(sql,/q\.post_id IS NULL/)
 assert.doesNotMatch(sql,/DELETE FROM public\.facebook_rotation_queue/)
})

test('Meta Graph usage samples and publishing gates are service-role scoped',()=>{
 const sql=readFileSync(new URL('../supabase/migrations/20261101120000_facebook_graph_usage_tracking.sql',import.meta.url),'utf8')
 assert.match(sql,/CREATE TABLE IF NOT EXISTS public\.facebook_graph_usage_samples/)
 assert.match(sql,/ENABLE ROW LEVEL SECURITY/)
 assert.match(sql,/facebook_graph_usage_record/)
 assert.match(sql,/TO service_role/)
 assert.match(sql,/META_USAGE_SAFETY_HOLD/)
 assert.match(sql,/business_recovery_minutes/)
 assert.match(sql,/:80001:/)
 assert.doesNotMatch(sql,/access_token/i)
})
