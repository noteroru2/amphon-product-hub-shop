import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const data=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64')
const coreCode=compile(readFileSync(new URL('../supabase/functions/seo-connector/core.ts',import.meta.url),'utf8'))
const core=await import(data(coreCode))
test('OAuth redirect allowlist rejects lookalikes, credentials, fragments and unrelated hosts',()=>{
 for(const u of ['https://chatgpt.com/connector_platform/oauth_redirect','https://chat.openai.com/aip/plugin/oauth/callback'])assert.equal(core.redirectAllowed(u),true)
 for(const u of ['https://chatgpt.com.evil.test/callback','https://evil.test','http://chatgpt.com/callback','https://user@chatgpt.com/callback','https://chatgpt.com/callback#fragment','https://chatgpt.com:444/callback'])assert.equal(core.redirectAllowed(u),false)
})
test('PKCE uses SHA256 base64url and 256-bit random bearer credentials',async()=>{
 assert.equal(await core.hash('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
 assert.match(core.random(),/^[A-Za-z0-9_-]{43}$/);assert.notEqual(core.random(),core.random())
})
test('GSC date filters preserve final Pacific windows, dimensions and exact matching',()=>{
 const a={start_date:'2026-09-01',end_date:'2026-10-09',page:'https://amphon.co.th/a',query:'รับซื้อคอม',country:'tha',device:'MOBILE',dimensions:['query','page'],offset:1000,limit:500}
 const r=core.validateGsc(a,new Date('2026-10-13T01:00:00Z'))
 assert.equal(r.dataState,'final');assert.equal(r.startRow,1000);assert.equal(r.dimensionFilterGroups[0].filters.length,4)
 assert.ok(r.dimensionFilterGroups[0].filters.every(f=>f.operator==='equals'))
 assert.throws(()=>core.validateGsc({...a,end_date:'2026-10-10'},new Date('2026-10-13T01:00:00Z')))
 assert.throws(()=>core.validateGsc({...a,start_date:'2026-02-30'}));assert.throws(()=>core.validateGsc({...a,limit:1001}));assert.throws(()=>core.validateGsc({...a,dimensions:['query','query']}));assert.throws(()=>core.validateGsc({...a,country:'TH'}))
})
test('page filters cannot request another site or leak query strings',()=>{
 assert.equal(core.pageAllowed('https://amphon.co.th/a','https://amphon.co.th'),true)
 for(const u of ['https://evil.test/a','https://amphon.co.th/a?phone=1','https://user@amphon.co.th/a','http://amphon.co.th/a'])assert.equal(core.pageAllowed(u,'https://amphon.co.th'),false)
})
test('all direct GSC requests isolate the registered hostname even for a shared domain property',()=>{
 const a=core.validateGsc({start_date:'2026-09-01',end_date:'2026-10-01',dimensions:[],query:'รับซื้อคอม'})
 const main=core.scopeGsc(a,'https://amphon.co.th','amphon.co.th'),shop=core.scopeGsc(a,'https://shop.amphon.co.th','shop.amphon.co.th')
 const mainFilter=new RegExp(main.dimensionFilterGroups[0].filters.at(-1).expression),shopFilter=new RegExp(shop.dimensionFilterGroups[0].filters.at(-1).expression)
 assert.equal(mainFilter.test('https://amphon.co.th/a'),true);assert.equal(mainFilter.test('https://www.amphon.co.th/a'),true)
 assert.equal(mainFilter.test('https://shop.amphon.co.th/a'),false);assert.equal(shopFilter.test('https://amphon.co.th/a'),false)
 assert.equal(shopFilter.test('https://shop.amphon.co.th/a'),true);assert.equal(mainFilter.test('https://amphonXcoXth/a'),false)
 assert.equal(main.dimensionFilterGroups[0].filters[0].expression,'รับซื้อคอม')
 const thai=core.scopeGsc(a,'https://xn--c3c3ab7an0ca2a0dm8p.com','รับซื้ออุบล.com');const filter=new RegExp(thai.dimensionFilterGroups[0].filters.at(-1).expression)
 assert.equal(filter.test('https://รับซื้ออุบล.com/a'),true);assert.equal(filter.test('https://xn--c3c3ab7an0ca2a0dm8p.com/a'),true)
})
test('Google URL Inspection is a read-only, site-scoped tool and never requests indexing',()=>{
 const t=core.TOOLS.find(x=>x.name==='seo_url_inspection')
 assert.ok(t);assert.equal(t.annotations.readOnlyHint,true)
 assert.deepEqual(t.inputSchema.required,['site_id','page'])
 assert.ok(t.securitySchemes[0].scopes.includes('seo:read'))
 assert.equal(t.inputSchema.properties.page.type,'string')
 for(const u of ['https://evil.test/article','http://amphon.co.th/','https://amphon.co.th/a?secret=1','https://amphon.co.th/a#fragment'])assert.equal(core.pageAllowed(u,'https://amphon.co.th'),false)
})
test('connector exposes reads and draft preparation only, no approval/publication tool',()=>{
 assert.deepEqual(core.TOOLS.filter(t=>!t.annotations.readOnlyHint).map(t=>t.name),['seo_prepare_draft','seo_save_draft'])
 assert.equal(core.TOOLS.some(t=>/approve|publish|delete/.test(t.name)),false)
 assert.ok(core.TOOLS.every(t=>t.securitySchemes[0].type==='oauth2'))
})
test('MCP transport enforces auth and scopes and refuses undeclared write arguments',async()=>{
 let handler;globalThis.Deno={env:{get:()=> 'https://example.supabase.co'},serve:fn=>handler=fn}
 let calls=[];const mock={rpc:async(name,args)=>{calls.push({name,args});return {data:args.p_action==='auth'?{actor:'owner-fixture',scopes:'seo:read'}:null,error:null}}}
 globalThis.__seoConnectorMock=mock
 const mockCode=data('export const createClient=()=>globalThis.__seoConnectorMock')
 const code=compile(readFileSync(new URL('../supabase/functions/seo-connector/index.ts',import.meta.url),'utf8')).replace(/from ['"]npm:@supabase\/supabase-js@2\.116\.0['"]/g,`from '${mockCode}'`).replace(/from ['"]\.\/core\.ts['"]/g,`from '${data(coreCode)}'`)
 await import(data(code))
 const call=async(body,token)=>handler(new Request('https://example/seo-connector/mcp',{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body)}))
 const anon=await call({jsonrpc:'2.0',id:1,method:'tools/list'});assert.equal(anon.status,401);assert.match(anon.headers.get('www-authenticate'),/oauth-protected-resource/)
 const token='a'.repeat(43),init=await call({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}},token);assert.equal((await init.json()).result.serverInfo.name,'AMPHON SEO Connector')
 const denied=await call({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'seo_prepare_draft',arguments:{opportunity_id:1}}},token);assert.equal((await denied.json()).result.isError,true);assert.equal(calls.some(x=>x.args.p_action==='prepare'),false)
 const list=await call({jsonrpc:'2.0',id:3,method:'tools/list'},token);assert.equal((await list.json()).result.tools.length,8)
 const extra=await call({jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'seo_sites',arguments:{table:'profiles'}}},token);assert.equal((await extra.json()).result.isError,true)
 const origin=await handler(new Request('https://example/seo-connector/resource-metadata',{headers:{origin:'https://evil.test'}}));assert.equal(origin.status,403)
 delete globalThis.Deno;delete globalThis.__seoConnectorMock
})
