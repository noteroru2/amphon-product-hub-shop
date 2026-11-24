import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'

const base=new URL('../',import.meta.url)
const read=path=>readFileSync(new URL(path,base),'utf8')
const migration=read('supabase/migrations/20261124181500_seo_audit_improvement_center.sql')
const component=read('src/components/SeoAuditCenter.tsx')
const tower=read('src/components/SeoControlTower.tsx')
const raw=read('src/lib/seoAuditCenter.ts')
const safeSrc=raw.replace("import { supabase } from './supabase'","const supabase = null")
const js=ts.transpileModule(safeSrc,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const {matchingAuditCatalog,buildAuditWorkOrder}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'))

test('Audit #177 catalog has exactly 7 P0 + 10 P1 + 5 P2, no retired pawn site',()=>{
  const matches=[...migration.matchAll(/\('(P[012])-(\d\d)',/g)]
  assert.equal(matches.length,22)
  assert.equal(new Set(matches.map(x=>x[0])).size,22)
  for(const [code,count] of [['P0',7],['P1',10],['P2',5]])
    assert.equal(matches.filter(x=>x[1]===code).length,count)
  assert.ok(migration.includes("'https://github.com/noteroru2/amphon-product-hub-shop/issues/177'"))
  assert.ok(!migration.includes("('P0-08','pawn'"))
  assert.ok(!migration.includes("('P1-08','pawn'"))
})
test('catalog filtering applies site/category/priority with cross-site audit tasks',()=>{
  const rows=[
    {code:'P0-01',site_id:'amphon',category:'CONTENT',priority:'P0'},
    {code:'P0-02',site_id:'shop',category:'UX_UI',priority:'P0'},
    {code:'P0-03',site_id:null,category:'TECHNICAL',priority:'P0'},
    {code:'P1-01',site_id:'camera',category:'CONTENT',priority:'P1'},
    {code:'P1-02',site_id:'pawn',category:'CONTENT',priority:'P1'},
  ]
  const valid=new Set(['amphon','shop','camera'])
  assert.deepEqual(matchingAuditCatalog(rows,'amphon','ALL','P0',valid).map(x=>x.code),['P0-01','P0-03'])
  assert.deepEqual(matchingAuditCatalog(rows,'ALL','UX_UI','ALL',valid).map(x=>x.code),['P0-02'])
  assert.deepEqual(matchingAuditCatalog(rows,'ALL','ALL','P1',valid).map(x=>x.code),['P1-01'])
})
test('server creation is guarded, idempotent and never deploys production',()=>{
  for(const token of [
    "if v_actor is null or v_role not in ('owner','admin')",
    "from public.commerce_seo_sites s where s.id=v_site and s.enabled=true",
    "on conflict(request_key) do nothing returning id into v_run",
    "on conflict(run_id,template_code) do nothing",
    "join public.commerce_seo_sites s on s.id=w.site_id and s.enabled=true",
    "'generated_live_crawl',false",
    "'site_edits_performed',false",
    "'github_pr_created',false",
    "'production_deployed',false",
  ])assert.ok(migration.includes(token),'Missing guard '+token)
})
test('audit catalog, runs and tasks use RLS + no direct write access by browser users',()=>{
  for(const table of ['commerce_seo_audit_catalog','commerce_seo_audit_runs','commerce_seo_audit_tasks']){
    assert.ok(migration.includes('alter table public.'+table+' enable row level security'))
    assert.ok(migration.includes('create policy seo_audit_'))
  }
  assert.ok(migration.includes("revoke all on public.commerce_seo_audit_catalog, public.commerce_seo_audit_runs, public.commerce_seo_audit_tasks from public,anon,authenticated"))
  assert.ok(migration.includes("grant select on public.commerce_seo_audit_catalog,public.commerce_seo_audit_runs,public.commerce_seo_audit_tasks to authenticated"))
  assert.ok(migration.includes("revoke all on function public.seo_audit_center_manage(text,jsonb) from public,anon,authenticated"))
  assert.ok(migration.includes("grant execute on function public.seo_audit_center_manage(text,jsonb) to authenticated"))
  assert.ok(!/grant (?:insert|update|delete|all) on public\.commerce_seo_audit_.* to authenticated/i.test(migration))
})
test('AI Work Order uses bounded GSC snapshot and forbids unsupported change execution',()=>{
  const task={template_code:'P0-01',site_id:'amphon',priority:'P0',category:'CONTENT',target_page:'https://amphon.co.th/foo',
    title:'test',finding:'real query',recommendation:'review',acceptance:'QA and real cases',focus_query:'รับซื้อโน๊ตบุ๊ค',evidence_kind:'GSC_AND_EDITORIAL_SAMPLE'}
  const run={id:'abc',source_issue_url:'https://github.com/noteroru2/amphon-product-hub-shop/issues/177',source_as_of:'2026-11-24',gsc_snapshot:[
    {site_id:'amphon',window_days:28,start_date:'2026-10-24',end_date:'2026-11-20',clicks:2341,impressions:96395,ctr:.0243,position:6.1},
    {site_id:'webuy',window_days:28,start_date:'2026-10-22',end_date:'2026-11-18',clicks:544,impressions:9851,ctr:.0552,position:7.5},
  ]}
  const prompt=buildAuditWorkOrder(task,run,{id:'amphon',label:'AMPHON',origin:'https://amphon.co.th/'})
  assert.ok(prompt.includes('GSC FINAL 28 วัน'))
  assert.ok(prompt.includes('2341'))
  assert.ok(!prompt.includes('9851'))
  for(const token of ['ห้ามแก้ Production','Draft PR/CI','ห้ามสร้างราคาหรือเคสรับซื้อ','GSC ไม่ใช่ SERP'])assert.ok(prompt.includes(token),token)
})
test('real Content Job button only invokes pre-existing audited GSC + role-guarded pipeline',()=>{
  assert.ok(raw.includes("from('commerce_seo_growth_opportunities')"))
  assert.ok(raw.includes(".eq('query',task.focus_query).eq('status','OPEN')"))
  assert.ok(raw.includes(".gte('source_at',cutoff)"))
  assert.ok(raw.includes("new URL(String(row.page)).href===target"))
  assert.ok(raw.includes("p_action:'create',p_data:{opportunity_id:found.id}"))
  assert.ok(component.includes('createContentJobFromAudit(t)'))
  assert.ok(component.includes('สร้าง Content Job จริง'))
  assert.ok(component.includes('ยังไม่อนุมัติหรือเผยแพร่'))
})
test('UI integrates into original command tower, controls are wired and not fake live audit',()=>{
  for(const text of [
    "import { SeoAuditCenter } from './SeoAuditCenter'",
    "tab === 'audit' ? <SeoAuditCenter",
    "onOpenNetwork={()=>setTab('network')}",
    "SEO Audit · สั่งงาน AI",
  ])assert.ok(tower.includes(text),text)
  for(const text of [
    'onClick={()=>void start()}','onClick={()=>void queueAndCopy(t)}',
    'onClick={()=>void createContent(t)}','onClick={()=>void taskAction(t,',
    'onOpenDevelopment','ไม่ได้สั่ง Crawl/AI หรือ Deploy',
    'Audit #177','Snapshot GSC',
  ])assert.ok(component.includes(text),text)
  assert.ok(!component.includes("onClick={()=>{}}"))
})
