import { createClient } from 'npm:@supabase/supabase-js@2.116.0'
import { READ_SCOPE, GscError, fetchJson, fetchSnapshot, mapProperties, type Site } from './core.ts'

const projectUrl=Deno.env.get('SUPABASE_URL')!
const hub='https://hub.amphon.co.th'
const callback=`${projectUrl}/functions/v1/seo-gsc/callback`
function adminKey() {
  const modern=Deno.env.get('SUPABASE_SECRET_KEYS')
  if (modern) { try { const keys=JSON.parse(modern); if(keys.default) return keys.default } catch { /* legacy fallback */ } }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
}
const db=createClient(projectUrl,adminKey(),{auth:{persistSession:false,autoRefreshToken:false}})
async function rpc(action: string,data: Record<string,unknown>={}) {
  const {data: result,error}=await db.rpc('commerce_gsc_internal',{p_action:action,p_data:data})
  if(error) throw new Error('GSC database operation failed')
  return result
}
const cors={'Access-Control-Allow-Origin':hub,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin','Cache-Control':'no-store'}
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json'}})
const redirect=(state:string)=>new Response(null,{status:302,headers:{Location:`${hub}/?gsc=${state}`,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}})
const base64url=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','')
const random=()=>base64url(crypto.getRandomValues(new Uint8Array(32)))
const hash=async (value:string)=>base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))))
async function actor(req:Request) {
  const token=req.headers.get('authorization')?.replace(/^Bearer /,'')
  if(!token) throw new Error('UNAUTHORIZED')
  const {data:{user},error}=await db.auth.getUser(token)
  if(error || !user) throw new Error('UNAUTHORIZED')
  const {data:profile}=await db.from('profiles').select('role,active').eq('id',user.id).single()
  if(!profile?.active || !['owner','admin'].includes(profile.role)) throw new Error('FORBIDDEN')
  return {id:user.id,role:profile.role}
}
async function sites():Promise<Site[]> {
  const {data,error}=await db.from('commerce_seo_sites').select('id,origin,label,gsc_property').eq('enabled',true)
  if(error) throw new Error('GSC registry unavailable')
  return data || []
}
async function tokenRequest(body:Record<string,string>) {
  return fetchJson('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body)})
}
async function run() {
  const config=await rpc('config')
  if(!config.client_id || !config.client_secret) return {processed:0,configured:false}
  const jobs=await rpc('claim'); const outcomes=[]
  const deadline=AbortSignal.timeout(55_000)
  const boundedFetch:typeof fetch=(input,init)=>fetch(input,{...init,signal:AbortSignal.any([deadline,...(init?.signal?[init.signal]:[])])})
  await Promise.all(jobs.map(async(job:any)=>{
    try {
      const token=await tokenRequest({client_id:config.client_id,client_secret:config.client_secret,refresh_token:job.refresh_token,grant_type:'refresh_token'})
      const snapshot=await fetchSnapshot({id:job.site_id,origin:job.origin,label:job.label,gsc_property:job.property},job.property,token.access_token,boundedFetch)
      await rpc('finish',{site_id:job.site_id,lease_id:job.lease_id,snapshot})
      outcomes.push({site_id:job.site_id,success:true})
    } catch(error) {
      const message=error instanceof GscError ? error.message : 'ดึงข้อมูล GSC ไม่สำเร็จ ระบบจะลองใหม่อัตโนมัติ'
      await rpc('fail',{site_id:job.site_id,lease_id:job.lease_id,error:message,reauth:error instanceof GscError && error.reauth})
      outcomes.push({site_id:job.site_id,success:false})
    }
  }))
  return {processed:outcomes.length,outcomes}
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS') return new Response(null,{status:204,headers:cors})
  const url=new URL(req.url)
  // Public callback is authenticated by a short-lived, one-use state and PKCE.
  if(req.method==='GET' && url.pathname.endsWith('/callback')) {
    try {
      const state=url.searchParams.get('state')
      if(!state || state.length>100) return redirect('invalid-state')
      const pending=await rpc('state_consume',{hash:await hash(state)})
      if(url.searchParams.get('error')) return redirect('cancelled')
      const code=url.searchParams.get('code'); if(!code) return redirect('failed')
      const config=await rpc('config')
      const token=await tokenRequest({client_id:config.client_id,client_secret:config.client_secret,redirect_uri:callback,
        code,code_verifier:pending.verifier,grant_type:'authorization_code'})
      if(!token.refresh_token || !(token.scope || '').split(' ').includes(READ_SCOPE)) return redirect('missing-permission')
      const properties=await fetchJson('https://www.googleapis.com/webmasters/v3/sites',{headers:{Authorization:`Bearer ${token.access_token}`}})
      const entries=properties.siteEntry || []
      const mapping=mapProperties(await sites(),entries)
      if(!Object.keys(mapping).length) return redirect('no-sites')
      await rpc('connect',{actor:pending.actor,refresh_token:token.refresh_token,properties:entries,mapping})
      return redirect('connected')
    } catch { return redirect('failed') }
  }
  if(req.method!=='POST') return json({error:'Method not allowed'},405)
  try {
    const body=await req.json()
    if(body.action==='run') {
      const key=req.headers.get('x-gsc-scheduler-key')
      if(!key || key!==await rpc('scheduler_key')) return json({error:'Unauthorized'},401)
      return json(await run())
    }
    const user=await actor(req)
    if(body.action==='status') {
      const status=await rpc('status')
      status.jobs=status.jobs.filter((job:any)=>job.next_at!=='infinity')
      return json({...status,redirect_uri:callback})
    }
    if(body.action==='configure') {
      if(user.role!=='owner') return json({error:'Owner only'},403)
      const clientId=String(body.client_id || '').trim(); const secret=String(body.client_secret || '').trim()
      if(!/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(clientId) || secret.length<10 || secret.length>256) return json({error:'Client ID / Client Secret ไม่ถูกต้อง'},400)
      await rpc('configure',{client_id:clientId,client_secret:secret}); return json({saved:true})
    }
    if(body.action==='start') {
      const config=await rpc('config')
      if(!config.client_id || !config.client_secret) return json({error:'กรุณาตั้งค่า Google OAuth ก่อน'},409)
      const state=random(); const verifier=random()
      await rpc('state_create',{hash:await hash(state),actor:user.id,verifier})
      const auth=new URL('https://accounts.google.com/o/oauth2/v2/auth')
      auth.search=new URLSearchParams({client_id:config.client_id,redirect_uri:callback,response_type:'code',scope:READ_SCOPE,
        access_type:'offline',prompt:'consent',state,code_challenge:await hash(verifier),code_challenge_method:'S256'}).toString()
      return json({url:auth.toString()})
    }
    if(body.action==='sync') return json(await rpc('sync'))
    if(body.action==='disconnect') {
      if(user.role!=='owner') return json({error:'Owner only'},403)
      if(!/^[0-9a-f-]{36}$/.test(String(body.id))) return json({error:'Invalid connection'},400)
      return json(await rpc('disconnect',{id:body.id}))
    }
    return json({error:'Unknown action'},400)
  } catch(error) {
    if(error instanceof Error && error.message==='UNAUTHORIZED') return json({error:'Unauthorized'},401)
    if(error instanceof Error && error.message==='FORBIDDEN') return json({error:'Forbidden'},403)
    return json({error:'การเชื่อมต่อ GSC ไม่สำเร็จ กรุณาลองใหม่'},500)
  }
})
