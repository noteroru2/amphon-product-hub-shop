import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
const transpile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const moduleUrl=code=>`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const coreUrl=moduleUrl(transpile(readFileSync(new URL('../supabase/functions/seo-gsc/core.ts',import.meta.url),'utf8')))
const {dateWindow,hostFilter,mapProperties,fetchSnapshot,fetchJson,GscError}=await import(coreUrl)
const main={id:'amphon',origin:'https://amphon.co.th',label:'amphon.co.th',gsc_property:'sc-domain:amphon.co.th'}
const shop={id:'shop',origin:'https://shop.amphon.co.th',label:'shop.amphon.co.th',gsc_property:'sc-domain:amphon.co.th'}
const row={clicks:10,impressions:100,ctr:0.1,position:3.2}
const response=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}})

test('28-day final window follows Pacific date boundaries rather than UTC/Bangkok',()=>{
  assert.deepEqual(dateWindow(new Date('2026-10-10T06:00:00Z')),{startDate:'2026-09-09',endDate:'2026-10-06'})
  assert.deepEqual(dateWindow(new Date('2026-10-10T08:00:00Z')),{startDate:'2026-09-10',endDate:'2026-10-07'})
})
test('site host filters separate Shop, escape domains and include Unicode/punycode',()=>{
  const filter=new RegExp(hostFilter(main))
  assert.ok(filter.test('https://amphon.co.th/a')); assert.ok(filter.test('https://www.amphon.co.th/a'))
  assert.ok(!filter.test('https://shop.amphon.co.th/a')); assert.ok(!filter.test('https://amphonXcoXth/a'))
  assert.ok(!filter.test('https://amphon.co.th.evil/a'))
  const unicode=new RegExp(hostFilter({origin:'https://xn--c3c3a0aa6cvaf8b9dze.com',label:'เรารับซื้อ.com'}))
  assert.ok(unicode.test('https://เรารับซื้อ.com/a')); assert.ok(unicode.test('https://xn--c3c3a0aa6cvaf8b9dze.com/a'))
})
test('mapping uses accessible registered properties and rejects unverified / path-only prefixes',()=>{
  assert.deepEqual(mapProperties([main,shop],[{siteUrl:main.gsc_property,permissionLevel:'siteOwner'}]),{amphon:main.gsc_property,shop:main.gsc_property})
  assert.deepEqual(mapProperties([main],[{siteUrl:main.gsc_property,permissionLevel:'siteUnverifiedUser'},{siteUrl:'https://amphon.co.th/blog/',permissionLevel:'siteFullUser'}]),{})
  assert.deepEqual(mapProperties([main],[{siteUrl:'https://amphon.co.th/',permissionLevel:'siteFullUser'}]),{amphon:'https://amphon.co.th/'})
})
test('aggregate totals survive undisclosed query rows; fetch dates and query dates stay separate',async()=>{
  const calls=[]
  const fake=async(url,init)=>{
    const body=JSON.parse(init.body); calls.push(body)
    if(!body.dimensions.length) return response({rows:[row]})
    if(body.dimensions[0]==='date') return response({rows:[{...row,keys:['2026-10-06']}]})
    return response({rows:[{...row,clicks:2,impressions:8,keys:['รับซื้อคอม','https://amphon.co.th/a']}]})
  }
  const s=await fetchSnapshot(main,main.gsc_property,'TEST',fake,new Date('2026-10-10T08:00:00Z'))
  assert.equal(s.clicks,10); assert.equal(s.queries[0].clicks,2); assert.equal(s.last_data_date,'2026-10-06')
  assert.ok(calls.every(c=>c.dataState==='final' && c.aggregationType==='auto'))
  assert.equal(s.query_truncated,false)
})
test('query pagination is bounded and marks a capped result',async()=>{
  const fake=async(url,init)=>{
    const body=JSON.parse(init.body)
    return response({rows:body.dimensions[0]==='query'?Array.from({length:1000},(_,i)=>({...row,keys:[`q${body.startRow+i}`,'https://amphon.co.th/a']})):body.dimensions.length?[]:[row]})
  }
  const s=await fetchSnapshot(main,main.gsc_property,'TEST',fake)
  assert.equal(s.queries.length,2000); assert.equal(s.query_truncated,true); assert.equal(s.clicks,10)
})
test('valid empty data is distinct from failed / malformed API data',async()=>{
  const s=await fetchSnapshot(main,main.gsc_property,'TEST',async()=>response({}))
  assert.equal(s.clicks,0); assert.equal(s.position,null); assert.equal(s.last_data_date,null)
  await assert.rejects(()=>fetchSnapshot(main,main.gsc_property,'TEST',async()=>new Response('{"error":"denied"}',{status:403})),GscError)
  await assert.rejects(()=>fetchSnapshot(main,main.gsc_property,'TEST',async()=>response({rows:[{...row,clicks:'wrong'}]})),/Invalid GSC metrics/)
})
test('transient errors retry; revoked credentials are identified without leaking the response',async()=>{
  let calls=0
  assert.deepEqual(await fetchJson('https://example.test',{},async()=>++calls<2?new Response('busy',{status:429}):response({ok:true})),{ok:true})
  assert.equal(calls,2)
  await assert.rejects(()=>fetchJson('https://example.test',{},async()=>new Response('{"error":"invalid_grant","refresh_token":"SECRET"}',{status:400})),e=>e.reauth && !e.message.includes('SECRET'))
})

// Execute the real request handler with an in-memory database boundary.
test('request handler rejects anonymous/staff access and fake scheduler keys; status cannot expose secrets',async()=>{
  let handler; let role='staff'; const operations=[]
  const db={auth:{getUser:async token=>({data:{user:token==='valid'?{id:'actor'}:null},error:null})},
    from:()=>({select:()=>({eq:()=>({single:async()=>({data:{role,active:true}})})})}),
    rpc:async(name,{p_action})=>{ operations.push(p_action); return {data:p_action==='scheduler_key'?'SECRET':p_action==='status'?{configured:true,connections:[],jobs:[]}:null,error:null} }}
  globalThis.__gscMock={db,serve:fn=>{handler=fn}}
  let source=readFileSync(new URL('../supabase/functions/seo-gsc/index.ts',import.meta.url),'utf8')
  source=source.replace(/import \{ createClient \} from '[^']+'/, 'const createClient = () => globalThis.__gscMock.db')
    .replace("from './core.ts'",`from '${coreUrl}'`)
  source=`const Deno={env:{get:(key)=>key==='SUPABASE_URL'?'https://test.supabase.co':'test'},serve:globalThis.__gscMock.serve};\n${source}`
  await import(moduleUrl(transpile(source)))
  const request=(action,headers={})=>new Request('https://test.supabase.co/functions/v1/seo-gsc',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({action})})
  assert.equal((await handler(request('status'))).status,401)
  assert.equal((await handler(request('status',{authorization:'Bearer valid'}))).status,403)
  assert.equal((await handler(request('run',{'x-gsc-scheduler-key':'wrong'}))).status,401)
  role='admin'
  const result=await handler(request('status',{authorization:'Bearer valid'}))
  assert.equal(result.status,200); assert.ok(!(await result.text()).includes('SECRET'))
  assert.equal((await handler(request('configure',{authorization:'Bearer valid'}))).status,403)
  assert.equal((await handler(new Request('https://test.supabase.co/functions/v1/seo-gsc/callback'))).status,302)
  assert.ok(!operations.includes('claim')); delete globalThis.__gscMock
})
