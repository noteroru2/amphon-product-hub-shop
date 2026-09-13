import { access, readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
const shopRoot=resolve(import.meta.dirname,'..')
const root=resolve(shopRoot,'..')
const failures=[]
const required=[
  '../supabase/shop_6.sql','../supabase/shop_6_verify.sql','../supabase/shop_6_1_acceptance.sql',
  '../docs/SHOP6_PAYMENT_FULFILLMENT_PLAYBOOK.md','../docs/SHOP61_PRODUCTION_ACCEPTANCE.md',
  '../SHOP6_REPORT.md','../SHOP6_1_REPORT.md','scripts/live-acceptance.mjs'
]
for(const f of required){try{await access(resolve(shopRoot,f))}catch{failures.push(`missing: ${f}`)}}
for(const script of ['verify:foundation','verify:shop2','verify:shop3','verify:shop4','verify:shop5','verify:shop6']){
  // On Windows, .cmd files are shell scripts. Node 24 can return status=null with
  // undefined stdout/stderr when spawnSync tries to execute npm.cmd directly.
  // Run through cmd.exe instead, and always handle missing output defensively.
  const isWindows=process.platform==='win32'
  const command=isWindows?(process.env.ComSpec||'cmd.exe'):'npm'
  const args=isWindows?['/d','/s','/c',`npm run -s ${script}`]:['run','-s',script]
  const run=spawnSync(command,args,{cwd:shopRoot,encoding:'utf8',env:{...process.env,TERM:'dumb'}})
  if(run.error){
    failures.push(`${script} failed to start: ${run.error.message}`)
    continue
  }
  if(run.status!==0){
    const detail=String(run.stderr ?? run.stdout ?? `exit ${run.status}`).trim().slice(0,300)
    failures.push(`${script} failed: ${detail || `exit ${run.status}`}`)
  }
}
const worker=await readFile(resolve(root,'workers/r2-upload/src/index.ts'),'utf8')
const wrangler=await readFile(resolve(root,'workers/r2-upload/wrangler.toml.example'),'utf8')
const shopEnv=await readFile(resolve(shopRoot,'.env.example'),'utf8')
const closeout=await readFile(resolve(root,'docs/SHOP61_PRODUCTION_ACCEPTANCE.md'),'utf8')

const fullMigration=await readFile(resolve(root,'supabase/migrations/20260912000000_amphon_shop61_full_setup.sql'),'utf8')
const installer=await readFile(resolve(root,'deployment/INSTALL-ALL.ps1'),'utf8')
if(/max\s*\(\s*cl\.(?:brand_id|model_id)\s*\)/i.test(fullMigration)) failures.push('SQL regression: max(uuid) candidate aggregate')
// PostgreSQL CREATE OR REPLACE VIEW may append columns, but existing column names/order must not change.
// Guard the SHOP-5/6 view evolution that previously inserted columns before legacy columns.
if(/create or replace view public\.commerce_public_store_settings_v[\s\S]{0,1400}warranty_policy_url,\s*reservation_minutes/i.test(fullMigration)) failures.push('SQL regression: store settings view inserts SHOP-5 columns before legacy updated_at')
if(/create or replace view public\.commerce_public_store_settings_v[\s\S]{0,1700}turnstile_site_key,\s*stripe_enabled[\s\S]{0,300}updated_at/i.test(fullMigration)) failures.push('SQL regression: SHOP-6 store settings columns inserted before legacy updated_at')
if(/create or replace view public\.commerce_order_admin_v[\s\S]{0,700}payment_method\s*,\s*o\.payment_provider\s*,\s*o\.delivery_method/i.test(fullMigration)) failures.push('SQL regression: order admin view inserts payment_provider into SHOP-5 column prefix')
if(/create or replace view public\.commerce_listing_editor_v[\s\S]{0,1100}cl\.mpn\s*,\s*cl\.store_warranty_days/i.test(fullMigration)) failures.push('SQL regression: listing editor inserts warranty columns into SHOP-4 column prefix')
if(installer.includes("'-p',$DbPassword") || installer.includes("'--password',$DbPassword")) failures.push('installer security: database password exposed in process arguments')
if(!installer.includes('SUPABASE_DB_PASSWORD')) failures.push('installer security: SUPABASE_DB_PASSWORD env contract missing')
const checks=[
 [worker.includes("url.pathname === '/webhooks/stripe'") && worker.includes("request.headers.get('stripe-signature')"),'Stripe raw signed webhook route'],
 [wrangler.includes('STRIPE_SECRET_KEY') && wrangler.includes('STRIPE_WEBHOOK_SECRET'),'Stripe secret instructions'],
 [wrangler.includes('crons = ["*/5 * * * *"]'),'reservation expiry cron'],
 [shopEnv.includes('PUBLIC_AMPHON_STORE_API'),'store API env contract'],
 [(closeout.includes('LIVE_ACCEPTANCE_REQUIRED') || closeout.includes('BUILD_AND_LIVE_ACCEPTANCE_REQUIRED')) && closeout.includes('purchase_enabled'),'release gate remains closed before live proof'],
]
for(const [ok,label] of checks) if(!ok) failures.push(`closeout invariant: ${label}`)
const secretRegex=/(?:sk_(?:live|test)_[A-Za-z0-9]{12,}|whsec_[A-Za-z0-9]{12,}|SUPABASE_SECRET_KEY\s*=\s*['\"][^<Y\n][^'\"\n]+|TURNSTILE_SECRET_KEY\s*=\s*['\"][^<Y\n][^'\"\n]+)/g
const scanFiles=['workers/r2-upload/src/index.ts','workers/r2-upload/wrangler.toml.example','shop/.env.example','supabase/shop_6.sql','docs/SHOP61_PRODUCTION_ACCEPTANCE.md']
for(const rel of scanFiles){const text=await readFile(resolve(root,rel),'utf8'); if(secretRegex.test(text)) failures.push(`secret-like value: ${rel}`); secretRegex.lastIndex=0}
// Package hygiene is useful before creating a source ZIP, but node_modules/dist are
// expected during a real production install. Enable this stricter gate only when
// explicitly packaging source artifacts.
if(process.env.SHOP61_PACKAGE_HYGIENE==='1'){
  for(const dir of ['node_modules','dist','.astro','.wrangler']){
    try{await access(resolve(root,dir)); failures.push(`artifact hygiene: root/${dir}`)}catch{}
    try{await access(resolve(shopRoot,dir)); failures.push(`artifact hygiene: shop/${dir}`)}catch{}
  }
}
if(failures.length){console.error('SHOP-6.1 CLOSEOUT VERIFY: FAIL');failures.forEach(x=>console.error(`- ${x}`));process.exit(1)}
console.log('SHOP-6.1 CLOSEOUT VERIFY: PASS')
console.log('SHOP-1..6 regression: PASS')
console.log('Secret/static release hygiene: PASS')
console.log('Production DB/live payment acceptance: REQUIRED (not executed by static verifier)')
