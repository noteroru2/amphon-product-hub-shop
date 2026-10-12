import {createClient} from 'npm:@supabase/supabase-js@2.116.0'
import {compact,fetchPage,fetchExperiment,referral} from './core.ts'
import {createRemoteJWKSet,jwtVerify} from 'npm:jose@6.1.0'
const url=Deno.env.get('SUPABASE_URL')!
const modern=Deno.env.get('SUPABASE_SECRET_KEYS')
let key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
if(modern) { try { key=JSON.parse(modern).default || key } catch {} }
const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
const jwks=createRemoteJWKSet(new URL('https://token.actions.githubusercontent.com/.well-known/jwks'))
async function renderActor(req:Request) {
 const token=req.headers.get('authorization')?.replace(/^Bearer /,'');if(!token)throw new Error('UNAUTHORIZED')
 const {payload}=await jwtVerify(token,jwks,{issuer:'https://token.actions.githubusercontent.com',audience:`${url}/functions/v1/seo-workbench`})
 if(payload.repository!=='noteroru2/amphon-product-hub-shop'||payload.ref!=='refs/heads/main'||payload.workflow_ref!=='noteroru2/amphon-product-hub-shop/.github/workflows/seo-evidence-render.yml@refs/heads/main'||!['push','schedule','workflow_dispatch'].includes(String(payload.event_name)))throw new Error('FORBIDDEN')
}
const headers={'Access-Control-Allow-Origin':'https://hub.amphon.co.th','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store','Vary':'Origin'}
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...headers,'Content-Type':'application/json'}})
const line='https://line.me/R/ti/p/%40webuy'
const redirect=(location:string)=>new Response(null,{status:302,headers:{Location:location,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}})
async function internal(action:string,data:Record<string,unknown>={}) { const r=await db.rpc('seo_lab_internal',{p_action:action,p_data:data}); if(r.error) throw new Error('Workbench database operation failed'); return r.data }
async function gsc(action:string) { const r=await db.rpc('commerce_gsc_internal',{p_action:action}); if(r.error) throw new Error('GSC connection unavailable'); return r.data }
async function actor(req:Request) {
  const token=req.headers.get('authorization')?.replace(/^Bearer /,''); if(!token) throw new Error('UNAUTHORIZED')
  const r=await db.auth.getUser(token); if(r.error || !r.data.user) throw new Error('UNAUTHORIZED')
  const p=await db.from('profiles').select('role,active').eq('id',r.data.user.id).single()
  if(!p.data?.active || !['owner','admin'].includes(p.data.role)) throw new Error('FORBIDDEN')
  return {id:r.data.user.id,role:p.data.role}
}
Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS') return new Response(null,{status:204,headers})
  const requestUrl=new URL(req.url)
  if(req.method==='GET' && requestUrl.pathname.endsWith('/tracker.js')) {
    const site=requestUrl.searchParams.get('site') || ''
    const r=await db.from('commerce_seo_sites').select('id,origin').eq('id',site).eq('enabled',true).single()
    if(!r.data) return new Response('/* unknown site */',{status:404,headers:{'Content-Type':'application/javascript'}})
    const config=JSON.stringify({site:r.data.id,host:new URL(r.data.origin).hostname,endpoint:`${url}/functions/v1/seo-workbench/contact`})
    const script=`(()=>{const c=${config};if(![c.host,'www.'+c.host].includes(location.hostname))return;let s;try{const k='amphon-source-v1';s=JSON.parse(sessionStorage.getItem(k)||'null');if(!s||s.expires<Date.now()||!/^([a-f0-9]{32})$/.test(s.session)){let referrer='';try{referrer=new URL(document.referrer).hostname;if(referrer===location.hostname)referrer=''}catch{}s={session:Array.from(crypto.getRandomValues(new Uint8Array(16))).map(n=>n.toString(16).padStart(2,'0')).join(''),referrer,expires:Date.now()+86400000};sessionStorage.setItem(k,JSON.stringify(s))}}catch{return}document.addEventListener('click',e=>{const a=e.target instanceof Element?e.target.closest('a'):null;if(!a||!/^https:\\/\\/line\\.me\\/R\\/(ti\\/p|oaMessage)\\/(%40|@)webuy/i.test(a.href))return;const u=new URL(c.endpoint);u.search=new URLSearchParams({site:c.site,page:location.origin+location.pathname,session:s.session,referrer:s.referrer,sku:''}).toString();a.href=u.href},true)})();`
    return new Response(script,{headers:{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'public,max-age=300','X-Content-Type-Options':'nosniff'}})
  }
  if(req.method==='GET' && requestUrl.pathname.endsWith('/contact')) {
    try {
      const referrer=requestUrl.searchParams.get('referrer') || ''
      if(referrer.length>200 || (referrer && !/^[a-z0-9.-]+$/i.test(referrer))) return redirect(line)
      const result=await internal('contact',{site_id:requestUrl.searchParams.get('site'),page:requestUrl.searchParams.get('page'),session:requestUrl.searchParams.get('session'),referrer_host:referrer,channel:referral(referrer),sku:requestUrl.searchParams.get('sku')?.replace(/[^A-Za-z0-9_-]/g,'').slice(0,80) || ''})
      if(!result.token) return redirect(line)
      const sku=requestUrl.searchParams.get('sku')?.replace(/[^A-Za-z0-9_-]/g,'').slice(0,80)
      return redirect(`https://line.me/R/oaMessage/%40webuy/?${encodeURIComponent(`สอบถาม${sku?`สินค้า ${sku}`:'สินค้า/บริการ'}ครับ [AMPHON:${result.token}]`)}`)
    } catch { return redirect(line) }
  }
  if(req.method!=='POST') return json({error:'Method not allowed'},405)
  try {
    if(Number(req.headers.get('content-length') || 0)>100000) return json({error:'Request too large'},413)
    const body=await req.json()
    if(['render_claim','render_finish','render_fail'].includes(body.action)) {
      await renderActor(req);return json(await internal(body.action,body))
    }
    if(body.action==='measure') {
      const scheduler=req.headers.get('x-gsc-scheduler-key'); if(!scheduler || scheduler!==await gsc('scheduler_key')) return json({error:'Unauthorized'},401)
      const jobs=await internal('claim'); let processed=0
      for(const job of jobs) {
        try {
          const config=await gsc('config')
          const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:config.client_id,client_secret:config.client_secret,refresh_token:job.refresh_token,grant_type:'refresh_token'}),signal:AbortSignal.timeout(12_000)})
          if(!response.ok) throw new Error('Google authorization failed; check connection')
          const token=await response.json(); if(!token.access_token) throw new Error('Google authorization missing token')
          const evidence=await db.from('commerce_seo_content_evidence').select('source_at').eq('job_id',job.job_id).order('id',{ascending:false}).limit(1).single()
          if(!evidence.data) throw new Error('Approved baseline evidence missing')
          const snapshot=await fetchExperiment({...job,baseline_at:evidence.data.source_at},token.access_token)
          await internal('finish',{...snapshot,job_id:job.job_id,checkpoint_days:job.checkpoint_days,lease_id:job.lease_id}); processed++
        } catch(error) { await internal('fail',{job_id:job.job_id,checkpoint_days:job.checkpoint_days,lease_id:job.lease_id,error:error instanceof Error?error.message:'Experiment fetch failed'}) }
      }
      return json({processed})
    }
    const user=await actor(req)
    if(!['capture','verify_publication'].includes(body.action)) return json({error:'Unknown action'},400)
    const r=await db.from('commerce_seo_content_jobs').select('*').eq('id',body.job_id).single(); if(r.error || !r.data) return json({error:'Job not found'},404)
    const job=r.data
    const s=await db.from('commerce_seo_sites').select('origin').eq('id',job.site_id).eq('enabled',true).single(); if(!s.data) return json({error:'Site disabled'},400)
    if(body.action==='capture') {
      const evidence=await fetchPage(s.data.origin,job.page)
      return json(await internal('evidence',{job_id:job.id,source_url:evidence.url,source_hash:evidence.hash,page_title:evidence.title,excerpt:evidence.text}))
    }
    if(user.role!=='owner' || job.status!=='APPROVED') return json({error:'Owner and approved draft required'},403)
    const publication=String(body.publication_url || ''); if(!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/commit\/[a-f0-9]{40}$/i.test(publication)) return json({error:'Full GitHub commit URL required'},400)
    const proof=compact(String(body.proof_excerpt || ''))
    if(proof.length<80 || !compact(job.approved_body || '').includes(proof)) return json({error:'Provide at least 80 characters from the approved draft'},400)
    const evidence=await fetchPage(s.data.origin,job.page)
    const previous=await db.from('commerce_seo_content_evidence').select('source_hash,excerpt').eq('id',job.evidence_id).single()
    if(!previous.data || evidence.hash===previous.data.source_hash || compact(previous.data.excerpt).includes(proof) || !evidence.text.includes(proof)) return json({error:'Changed live page with a new approved excerpt required; not published yet'},409)
    return json(await internal('published',{job_id:job.id,publication_url:publication,source_hash:evidence.hash}))
  } catch(error) {
    const message=error instanceof Error?error.message:'Workbench failed'
    return json({error:message},message==='UNAUTHORIZED'?401:message==='FORBIDDEN'?403:400)
  }
})
