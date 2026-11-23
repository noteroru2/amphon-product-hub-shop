import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runReadOnlyQa} from '../scripts/seo-production-http-qa.mjs'

const O='https://amphon.co.th'
const PAGES=['/','/บริการ/รับซื้อโน๊ตบุ๊ค','/บริการ/รับซื้อคอมพิวเตอร์',
  '/บริการ/รับซื้อ-macbook','/บริการ/รับซื้อคอมบริษัท',
  '/บริการ/รับเหมาประมูลอุปกรณ์ไอที']
const www='https://www.amphon.co.th/%E0%B8%97%E0%B8%94%E0%B8%AA%E0%B8%AD%E0%B8%9A?utm_source=readonly-preflight'
const goodHtml=path=>'<html><head><title>AMPHON</title>'+
  '<meta name="description" content="AMPHON devices">'+
  '<meta name="robots" content="index,follow">'+
  '<link rel="canonical" href="'+O+path+'"></head><body>'+
  '<a href="https://line.me/ti/p/~@webuy">LINE</a>09:00–19:00</body></html>'
const tlsChecker=async()=>({pass:true,expires_at:'2027-01-01T00:00:00.000Z'})
function fakeFetch(overrides={}){
 const calls=[]
 const fetcher=async(url,opts)=>{
  calls.push({url,method:opts.method,redirect:opts.redirect})
  if(overrides[url])return overrides[url]
  if(url===www)return new Response(null,{status:301,
    headers:{location:www.replace('https://www.','https://')}})
  if(url.startsWith(O+'/บริการ/รับซื้อกล้องฟ'))
    return new Response(null,{status:308,
      headers:{location:O+'/บริการ/รับซื้อกล้องฟิล์ม'}})
  if(url===O+'/robots.txt')
    return new Response('User-agent: Googlebot\nAllow: /\nSitemap: '+O+'/sitemap-index.xml')
  if(url===O+'/sitemap-index.xml')return new Response(O+'/sitemap-0.xml')
  if(url===O+'/sitemap-0.xml')
    return new Response(PAGES.map(p=>encodeURI(O+p)).join('\n'))
  if(url===O+'/api/google-reviews')
    return new Response('Unavailable',{status:503})
  if(PAGES.some(p=>O+p===url))
    return new Response(goodHtml(url.slice(O.length)),{status:200,
      headers:{'content-type':'text/html'}})
  throw Error('unexpected route')
 }
 return {fetcher,calls}
}
test('valid public-only HTTP status and TLS evidence never equals release verified',async()=>{
 const {fetcher,calls}=fakeFetch()
 const r=await runReadOnlyQa({fetcher,tlsChecker,now:new Date('2026-11-23T12:00:00Z')})
 assert.equal(r.passed,true)
 assert.equal(r.production_verified,false)
 assert.equal(r.can_write_ledger,false)
 assert.equal(r.can_deploy,false)
 assert.equal(r.source_sha_attested,false)
 assert.equal(r.seo_uplift_measured,false)
 assert.equal(r.critical_failures.length,0)
 assert.ok(calls.length>=13)
 assert.ok(calls.every(x=>x.method==='GET'&&x.redirect==='manual'&&
   (x.url.startsWith(O+'/')||x.url.startsWith('https://www.amphon.co.th/'))))
 assert.ok(r.checks.some(x=>x.name.startsWith('legacy redirect')&&x.status===308))
})
test('following a redirect is not enough: 302 instead of 301 fails',async()=>{
 const {fetcher}=fakeFetch({[www]:new Response(null,{status:302,
   headers:{location:www.replace('https://www.','https://')}})})
 const r=await runReadOnlyQa({fetcher,tlsChecker})
 assert.equal(r.passed,false)
 assert.ok(r.critical_failures.some(x=>x.startsWith('www exact 301')))
})
test('off-domain redirect and noindex independently fail',async()=>{
 const {fetcher}=fakeFetch({
  [O+'/บริการ/รับซื้อกล้องฟิลัม']:new Response(null,{status:308,
    headers:{location:'https://evil.example/บริการ/รับซื้อกล้องฟิล์ม'}}),
  [O+'/บริการ/รับซื้อโน๊ตบุ๊ค']:new Response(
    goodHtml('/บริการ/รับซื้อโน๊ตบุ๊ค').replace('index,follow','noindex,follow'))
 })
 const r=await runReadOnlyQa({fetcher,tlsChecker})
 assert.equal(r.passed,false)
 assert.ok(r.critical_failures.some(x=>x.includes('รับซื้อกล้องฟิลัม')))
 assert.ok(r.critical_failures.some(x=>x.includes('รับซื้อโน๊ตบุ๊ค')))
})
test('workflow manual owner protected, read-only and not a production deployer',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/seo-production-http-qa-readonly.yml',import.meta.url),'utf8')
 const source=readFileSync(new URL('../scripts/seo-production-http-qa.mjs',import.meta.url),'utf8')
 assert.match(workflow,/workflow_dispatch:/)
 assert.match(workflow,/environment: seo-production-evidence-protected/)
 assert.match(workflow,/contents: read/)
 assert.doesNotMatch(workflow,/wrangler deploy|supabase db push|pull-requests: write/)
 assert.match(source,/const ORIGIN='https:\/\/amphon\.co\.th'/)
 assert.doesNotMatch(source,/method:'POST'|method:'PATCH'|method:'PUT'|method:'DELETE'/)
})
