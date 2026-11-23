#!/usr/bin/env node
// Fixed-origin, read-only HTTP/TLS acceptance. No production attestation.
import tls from 'node:tls'
import {pathToFileURL} from 'node:url'

const ORIGIN='https://amphon.co.th'
const MAX_BYTES=1500000
const PAGES=['/','/บริการ/รับซื้อโน๊ตบุ๊ค','/บริการ/รับซื้อคอมพิวเตอร์',
  '/บริการ/รับซื้อ-macbook','/บริการ/รับซื้อคอมบริษัท',
  '/บริการ/รับเหมาประมูลอุปกรณ์ไอที']
const LEGACY=['/บริการ/รับซื้อกล้องฟิลัม','/บริการ/รับซื้อกล้องฟีล์ม','/บริการ/รับซื้อกล้องฟิล์ล']
const WWW='https://www.amphon.co.th/%E0%B8%97%E0%B8%94%E0%B8%AA%E0%B8%AD%E0%B8%9A?utm_source=readonly-preflight'
const tidy=x=>{try{return decodeURI(new URL(x).href).replace(/\/$/,'')}catch{return null}}
const destination=(location,source)=>{
  try{return location?new URL(location,source).href:null}catch{return null}
}
const tag=(html,name,attribute,value)=>
  [...html.matchAll(new RegExp('<'+name+'\\b[^>]*>','gi'))].map(x=>x[0])
    .find(x=>new RegExp('\\b'+attribute+'=["\\x27]'+value+'["\\x27]','i').test(x))||''
const attr=(value,key)=>(value.match(new RegExp('\\b'+key+'=["\\x27]([^"\\x27]+)["\\x27]','i'))||[])[1]||''
const add=(report,name,pass,status=null,critical=true)=>{
  report.checks.push({name,pass:Boolean(pass),status})
  if(!pass)(critical?report.critical_failures:report.advisories).push(name)
}
async function readBounded(response){
  if(Number(response.headers.get('content-length'))>MAX_BYTES)throw Error('OVERSIZE')
  if(!response.body)return ''
  const reader=response.body.getReader();const buffers=[];let length=0
  while(true){
    const {done,value}=await reader.read()
    if(done)break
    length+=value.byteLength
    if(length>MAX_BYTES){await reader.cancel();throw Error('OVERSIZE')}
    buffers.push(Buffer.from(value))
  }
  return Buffer.concat(buffers).toString('utf8')
}
async function get(url,fetcher){
  try{
    const r=await fetcher(url,{method:'GET',redirect:'manual',
      signal:AbortSignal.timeout(15000),headers:{Accept:'text/html,application/xml,text/plain,*/*'}})
    return {status:r.status,location:r.headers.get('location')||'',
      body:r.status===200?await readBounded(r):'',
      x_robots:r.headers.get('x-robots-tag')||''}
  }catch{return {status:null,location:'',body:'',x_robots:''}}
}
function pageValid(result,path){
  if(result.status!==200)return false
  const html=result.body
  const canonical=attr(tag(html,'link','rel','canonical'),'href')
  const robots=tag(html,'meta','name','robots')
  const description=attr(tag(html,'meta','name','description'),'content')
  return Boolean(tidy(canonical)===tidy(ORIGIN+path)
    && !/\bnoindex\b/i.test(robots)
    && !/\bnoindex\b/i.test(result.x_robots||'')
    && /<title\b[^>]*>[^<]+<\/title>/i.test(html)
    && description && /line\.me\/ti\/p\/~@webuy/i.test(html))
}
export async function checkTls(){
  return new Promise(resolve=>{
    const socket=tls.connect({host:'amphon.co.th',port:443,
      servername:'amphon.co.th',rejectUnauthorized:true},()=>{
      const cert=socket.getPeerCertificate()
      const expiry=Date.parse(cert?.valid_to||'')
      const pass=Boolean(socket.authorized&&Number.isFinite(expiry)&&expiry>Date.now())
      socket.end()
      resolve({pass,expires_at:pass?new Date(expiry).toISOString():null})
    })
    socket.setTimeout(12000,()=>socket.destroy())
    socket.on('error',()=>resolve({pass:false,expires_at:null}))
    socket.on('close',()=>resolve({pass:false,expires_at:null}))
  })
}
export async function runReadOnlyQa({fetcher=fetch,tlsChecker=checkTls,now=new Date()}={}){
  const report={schema:'amphon.seo.production-http-qa.v1',site_id:'amphon',
    observed_at:now.toISOString(),mode:'PUBLIC_READ_ONLY',
    checks:[],critical_failures:[],advisories:[],
    production_verified:false,can_write_ledger:false,can_deploy:false,
    source_sha_attested:false,seo_uplift_measured:false}
  for(const path of PAGES){
    const r=await get(ORIGIN+path,fetcher)
    add(report,'page '+path,pageValid(r,path),r.status)
    if(path==='/')add(report,'storefront hours',
      /09:00\s*[–-]\s*19:00/.test(r.body),r.status,false)
  }
  const www=await get(WWW,fetcher)
  const redirect=destination(www.location,WWW)
  const target=WWW.replace('https://www.','https://')
  add(report,'www exact 301 preserves encoded path and query',
    www.status===301&&tidy(redirect)===tidy(target),www.status)
  for(const path of LEGACY){
    const r=await get(ORIGIN+path,fetcher)
    const dest=destination(r.location,ORIGIN+path)
    add(report,'legacy redirect '+path,
      [301,308].includes(r.status)&&tidy(dest)===tidy(ORIGIN+'/บริการ/รับซื้อกล้องฟิล์ม'),r.status)
  }
  const robots=await get(ORIGIN+'/robots.txt',fetcher)
  add(report,'robots Googlebot and sitemap',
    robots.status===200&&/User-agent:\s*Googlebot/i.test(robots.body)
    &&/Sitemap:\s*https:\/\/amphon\.co\.th\/sitemap-index\.xml/i.test(robots.body),robots.status)
  const index=await get(ORIGIN+'/sitemap-index.xml',fetcher)
  add(report,'sitemap index',
    index.status===200&&index.body.includes(ORIGIN+'/sitemap-0.xml'),index.status)
  const sitemap=await get(ORIGIN+'/sitemap-0.xml',fetcher)
  add(report,'sitemap five service pages',
    sitemap.status===200&&PAGES.filter(p=>p!=='/').every(p=>
      sitemap.body.includes(encodeURI(ORIGIN+p))||sitemap.body.includes(ORIGIN+p)),sitemap.status)
  const api=await get(ORIGIN+'/api/google-reviews',fetcher)
  add(report,'Google Reviews API observed status',
    [200,304,401,403,404,429,503].includes(api.status),api.status,false)
  const cert=await tlsChecker()
  add(report,'TLS chain and expiry',cert?.pass===true,null)
  report.tls_expires_at=cert?.pass?cert.expires_at:null
  report.passed=report.critical_failures.length===0
  report.next_action='Owner reviews raw HTTP/TLS results with latest Build SHA and separate approved production-branch exception. No verified release event is generated.'
  return report
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  runReadOnlyQa().then(r=>{
    process.stdout.write(JSON.stringify(r,null,2)+'\n')
    if(!r.passed)process.exitCode=1
  }).catch(()=>{console.error('AMPHON_HTTP_QA_INTERNAL_FAILED');process.exitCode=1})
}
