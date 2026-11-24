import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'

const source=readFileSync(new URL('../src/lib/seoRankLedger.ts',import.meta.url),'utf8')
const module=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const {validRankSnapshot,latestRankSnapshots,rankStatusText}=await import(
  'data:text/javascript;base64,'+Buffer.from(module).toString('base64'))
const migration=readFileSync(new URL('../supabase/migrations/20261124143000_seo_portfolio_rank_ledger.sql',import.meta.url),'utf8')
const edge=readFileSync(new URL('../supabase/functions/seo-gsc/index.ts',import.meta.url),'utf8')
const hub=readFileSync(new URL('../src/components/SeoPortfolioDashboard.tsx',import.meta.url),'utf8')
const base={
 site_id:'amphon',keyword:'รับซื้อคอม',location_id:2764,language_code:'th',
 device:'DESKTOP',checked_on:'2026-11-24',checked_at:'2026-11-24T07:00:00Z',
 serp_date:null,status:'PENDING',position:null,ranking_url:null,
 source:'UBERSUGGEST_PROJECT_POSITION_INFO',
}
test('pending rankings stay unknown; never change null to fake zero or NOT_RANKING',()=>{
 assert.equal(validRankSnapshot(base),true)
 assert.equal(rankStatusText(base),'รอผล SERP')
 assert.equal(validRankSnapshot({...base,status:'NOT_RANKING_TOP_100'}),false)
 assert.equal(validRankSnapshot({...base,position:0,status:'RANKED',serp_date:'2026-11-23'}),false)
 assert.equal(validRankSnapshot({...base,position:101,status:'RANKED',serp_date:'2026-11-23'}),false)
})
test('confirmed absence in top 100 requires actual SERP date, not GSC average',()=>{
 const absent={...base,status:'NOT_RANKING_TOP_100',serp_date:'2026-11-23'}
 assert.equal(validRankSnapshot(absent),true)
 assert.equal(rankStatusText(absent),'ไม่พบใน Top 100')
 assert.equal(validRankSnapshot({...absent,position:3}),false)
 const ranked={...base,status:'RANKED',position:7,serp_date:'2026-11-23'}
 assert.equal(validRankSnapshot(ranked),true)
 assert.equal(rankStatusText(ranked),'อันดับ 7')
})
test('latest snapshot per keyword prefers newest checked_on and excludes other site and mobile',()=>{
 const rows=[
 {...base,checked_on:'2026-11-23',status:'RANKED',position:8,serp_date:'2026-11-23'},
 base,
 {...base,site_id:'webuy',status:'RANKED',position:1,serp_date:'2026-11-23'},
 {...base,device:'MOBILE',status:'RANKED',position:4,serp_date:'2026-11-23'},
 {...base,keyword:'รับซื้อ macbook',status:'RANKED',position:11,serp_date:'2026-11-23'},
 ]
 const result=latestRankSnapshots(rows,'amphon')
 assert.equal(result.length,2)
 assert.equal(result.find(x=>x.keyword==='รับซื้อคอม').status,'PENDING')
 assert.equal(result.find(x=>x.keyword==='รับซื้อ macbook').position,11)
})
test('reject invalid providers, future mixing, missing dates and bad status',()=>{
 for(const row of [
 {...base,source:'GSC_AVERAGE_POSITION'}, {...base,location_id:2840},
 {...base,language_code:'en'},{...base,status:'ok'},
 {...base,checked_on:'invalid'},{...base,status:'RANKED',position:2,serp_date:null},
 ]) assert.equal(validRankSnapshot(row),false)
})
test('SQL ledger is private, bounded, site-aware and prevents invalid SERP states',()=>{
 for(const text of [
 'commerce_seo_portfolio_rank_snapshots','enable row level security',
 'revoke all on table public.commerce_seo_portfolio_rank_snapshots from public,anon,authenticated',
 'grant select,insert,update on table public.commerce_seo_portfolio_rank_snapshots to service_role',
 "status in ('PENDING','RANKED','NOT_RANKING_TOP_100')",
 "status='PENDING' and position is null and serp_date is null",
 "status='NOT_RANKING_TOP_100' and position is null and serp_date is not null",
 "status='RANKED' and position between 1 and 100 and serp_date is not null"
 ]) assert.ok(migration.includes(text),text)
 assert.ok(!migration.includes('grant select on table public.commerce_seo_portfolio_rank_snapshots to authenticated'))
})
test('authenticated portfolio endpoint exposes rank snapshots separately from GSC average',()=>{
 assert.ok(edge.includes("const user=await actor(req)"))
 assert.ok(edge.includes("if(body.action==='portfolio')"))
 assert.ok(edge.includes("db.from('commerce_seo_portfolio_rank_snapshots')"))
 assert.ok(edge.includes("rank_source:'UBERSUGGEST_SERP_NOT_GSC_AVERAGE'"))
 assert.ok(hub.includes('Google Rank Checker · Ubersuggest SERP'))
 assert.ok(hub.includes('อันดับ SERP มาจากการเก็บผลของ Ubersuggest ไม่ใช่อันดับเฉลี่ย GSC'))
 assert.ok(hub.includes('PENDING หมายถึงยังไม่ได้ผล'))
})
