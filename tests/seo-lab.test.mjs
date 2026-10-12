import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
import vm from 'node:vm'
const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText
const url=code=>`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const core=await import(url(compile(readFileSync(new URL('../supabase/functions/seo-workbench/core.ts',import.meta.url),'utf8'))))
const signals=await import(url(compile(readFileSync(new URL('../src/lib/seoLabSignals.ts',import.meta.url),'utf8'))))
test('content experiment windows are equal, do not overlap and exclude publication day in Pacific time',()=>{
 const windows=core.experimentWindows('2026-10-01T01:00:00Z',7,new Date('2026-10-12T03:00:00Z'))
 assert.deepEqual(windows,{before:{startDate:'2026-09-23',endDate:'2026-09-29'},after:{startDate:'2026-10-01',endDate:'2026-10-07'}})
 assert.throws(()=>core.experimentWindows('2026-10-10T01:00:00Z',7,new Date('2026-10-12T03:00:00Z')),/not ready/)
 const delayed=core.experimentWindows('2026-10-01T01:00:00Z',7,new Date('2026-10-12T03:00:00Z'),'2026-09-25T01:00:00Z')
 assert.equal(delayed.before.endDate,'2026-09-23');assert.equal(delayed.after.startDate,'2026-10-01')
})
test('evidence fetch refuses private/off-site/credential URLs and external redirects before reading',async()=>{
 for(const u of ['http://127.0.0.1/','https://evil.example/','https://user:pass@amphon.co.th/','https://amphon.co.th:8443/'])assert.throws(()=>core.allowPage('https://amphon.co.th',u))
 let count=0;await assert.rejects(()=>core.fetchPage('https://amphon.co.th','https://amphon.co.th/',async()=>{count++;return new Response(null,{status:302,headers:{location:'https://evil.example/'}})}))
 assert.equal(count,1)
})
test('evidence strips scripts/nav and bounds readable content rather than interpreting page instructions',()=>{
 const r=core.publicText('<title>ร้าน &amp; test</title><nav>Navigation</nav><main><h1>รับซื้อคอม</h1><script>secret()</script><p>บริการจริง &#3588;</p></main>')
 assert.equal(r.title,'ร้าน & test');assert.ok(!r.text.includes('secret')&&!r.text.includes('Navigation'));assert.ok(r.text.includes('บริการจริง'))
})
test('experiment fetch filters the same page and query for both windows, and missing metrics remain insufficient',async()=>{
 const requests=[];const r=await core.fetchExperiment({published_at:'2026-10-01T01:00:00Z',checkpoint_days:7,page:'https://amphon.co.th/service',query:'รับซื้อคอม',origin:'https://amphon.co.th',label:'amphon.co.th',property:'sc-domain:amphon.co.th'},'fake',async(u,init)=>{requests.push(JSON.parse(init.body));return new Response('{}',{status:200})},new Date('2026-10-12T03:00:00Z'))
 assert.equal(requests.length,2);assert.equal(requests[0].dataState,'final');assert.deepEqual(requests[0].dimensionFilterGroups,requests[1].dimensionFilterGroups);assert.equal(r.after_data.position,null)
})
test('failed or absent AI samples never turn into zero brand visibility',()=>{
 assert.equal(signals.aiSummary([{provider:'ChatGPT',run_status:'FAILED',mentioned:null,cited_sites:[]}],'ChatGPT').rate,null)
 assert.equal(signals.aiSummary([{provider:'ChatGPT',run_status:'COMPLETED',mentioned:false,cited_sites:[]}],'ChatGPT').rate,0)
})
test('profit counts only explicit confirmed sale links once and preserves unknown profit',()=>{
 assert.equal(signals.attributedProfit([{sale_id:null,confirmed_lead:false,actual_profit:100}]).total,null)
 assert.equal(signals.attributedProfit([{sale_id:'a',confirmed_lead:true,actual_profit:100},{sale_id:'a',confirmed_lead:true,actual_profit:100},{sale_id:'b',confirmed_lead:true,actual_profit:null}]).total,100)
})
test('Google referrers do not masquerade as AI, while no referrer remains unknown',()=>{
 assert.equal(core.referral('www.google.co.th'),'ORGANIC_SEARCH');assert.equal(core.referral('chatgpt.com'),'AI_REFERRAL');assert.equal(core.referral(''),'UNKNOWN');assert.equal(core.referral('chatgpt.com.evil.test'),'OTHER')
})
test('anonymous management and fake scheduler keys cannot claim experiments; contacts only prefill LINE',async()=>{
 const code=compile(readFileSync(new URL('../supabase/functions/seo-workbench/index.ts',import.meta.url),'utf8'))
 let handler;globalThis.Deno={env:{get:name=>name==='SUPABASE_URL'?'https://project.supabase.co':'fake'},serve:fn=>handler=fn}
 const fakeDb={auth:{getUser:async()=>({data:{user:null},error:null})},rpc:async(name,args)=>({data:name==='commerce_gsc_internal'?'real-test-key':{token:'1234567890abcdef'},error:null}),from:()=>{const q={select:()=>q,eq:()=>q,single:async()=>({data:{id:'amphon',origin:'https://amphon.co.th'}})};return q}}
 const mock=url(`export const createClient=()=>globalThis.__seoLabMock`);globalThis.__seoLabMock=fakeDb
 const joseMock=url(`export const createRemoteJWKSet=()=>({});export const jwtVerify=async()=>{throw new Error('UNAUTHORIZED')}`)
 await import(url(code.replace(/from ['"]npm:@supabase\/supabase-js@2\.116\.0['"]/g,`from '${mock}'`).replace(/from ['"]npm:jose@6\.1\.0['"]/g,`from '${joseMock}'`).replace(/from ['"]\.\/core\.ts['"]/g,`from '${url(compile(readFileSync(new URL('../supabase/functions/seo-workbench/core.ts',import.meta.url),'utf8')))}'`)))
 const anon=await handler(new Request('https://example/seo-workbench',{method:'POST',body:'{"action":"capture","job_id":1}'}));assert.equal(anon.status,401)
 const scheduler=await handler(new Request('https://example/seo-workbench',{method:'POST',headers:{'x-gsc-scheduler-key':'fake'},body:'{"action":"measure"}'}));assert.equal(scheduler.status,401)
 const render=await handler(new Request('https://example/seo-workbench',{method:'POST',body:'{"action":"render_claim"}'}));assert.equal(render.status,401)
 const contact=await handler(new Request('https://example/seo-workbench/contact?site=shop&page=https%3A%2F%2Fshop.amphon.co.th%2F&session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'))
 assert.equal(contact.status,302);assert.ok(contact.headers.get('location').includes('oaMessage/%40webuy'));assert.ok(decodeURIComponent(contact.headers.get('location')).includes('[AMPHON:1234567890abcdef]'))
 const tracker=await handler(new Request('https://example/seo-workbench/tracker.js?site=amphon'));const script=await tracker.text()
 for(const href of ['https://line.me/R/ti/p/@webuy','https://line.me/ti/p/~@webuy','https://line.me/R/ti/p/%40WEBUY','https://line.me/R/ti/p/@webuy_fake']){
  let listener;class Element{closest(){return this}};const anchor=new Element();anchor.href=href
  const context={location:{hostname:'amphon.co.th',origin:'https://amphon.co.th',pathname:'/'},document:{referrer:'https://www.google.co.th/search?q=private',addEventListener:(event,fn)=>listener=fn},sessionStorage:{getItem:()=>null,setItem:()=>{}},crypto:globalThis.crypto,URL,URLSearchParams,Date,Element}
  vm.runInNewContext(script,context);listener({target:anchor})
  if(href.includes('webuy_fake'))assert.equal(anchor.href,href);else{const u=new URL(anchor.href);assert.equal(u.searchParams.get('site'),'amphon');assert.equal(u.searchParams.get('referrer'),'www.google.co.th');assert.ok(!anchor.href.includes('q=private'))}
 }
 delete globalThis.Deno;delete globalThis.__seoLabMock
})
