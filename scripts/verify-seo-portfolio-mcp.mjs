import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const root = new URL('../', import.meta.url)
const read = (path) => readFile(new URL(path, root), 'utf8')
const [core, handler] = await Promise.all([
  read('supabase/functions/seo-connector/core.ts'),
  read('supabase/functions/seo-connector/index.ts'),
])

assert.match(core, /tool\('seo_portfolio'/, 'tool must be discoverable to ChatGPT')
assert.match(core, /schema\(\{site_id:str,window_days:/, 'site/window arguments must be defined')
assert.match(core, /enum:\[7,14,28\]/, 'GSC windows must be bounded')
assert.match(handler, /if\(name==='seo_portfolio'\)/)
assert.match(handler, /\.eq\('enabled',true\)/, 'disabled/retired sites must not be exposed')
assert.match(handler, /Site disabled or not found/, 'disabled site must fail closed')
assert.match(handler, /commerce_seo_portfolio_projects/)
assert.match(handler, /commerce_seo_portfolio_keyword_roles/)
assert.match(handler, /commerce_seo_portfolio_gsc_windows_v/)
assert.match(handler, /commerce_seo_portfolio_release_events/)
assert.match(handler, /commerce_seo_portfolio_funnel_v/)
assert.match(handler, /commerce_seo_portfolio_gsc_ingest_runs/)
assert.match(handler, /gsc_position_is_average_not_live_rank:true/)
assert.match(handler, /code_write_and_deploy_not_authorized:true/)
assert.match(handler, /keyword_ownership_requires_approved_status:true/)
assert.match(handler, /require_verified_production_mapping_for_source_changes:true/)
assert.match(handler, /commerce_seo_sites'\)\.select\('id,label,origin,gsc_property'\)/)
const block = handler.split("if(name==='seo_portfolio')")[1].split("if(name==='seo_opportunities'")[0]
assert.ok(!/\.insert\(|\.update\(|\.delete\(|db\.rpc\(/.test(block), 'tool must have no write or mutating RPC calls')
assert.match(handler, /if\(!tool\.annotations\.readOnlyHint&&!authorization\.scopes/, 'existing OAuth write scope boundary must remain')
console.log('SEO PORTFOLIO MCP PASS: bounded, read-only, source-aware, no deployment permissions')
