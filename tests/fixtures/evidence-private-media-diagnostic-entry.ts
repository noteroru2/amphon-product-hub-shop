// LOCAL TEST SOURCE ONLY, never a production function or migration.
import {createPrivateMediaHandler} from '../_shared/evidence-private-media.mjs'
if(Deno.env.get('EVIDENCE_SYNTHETIC_DIAGNOSTICS')!=='LOCAL_ONLY'||!Deno.env.get('SUPABASE_URL')?.startsWith('http://'))throw Error('LOCAL_DIAGNOSTICS_ONLY')
const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_ANON_KEY')
Deno.serve(async request=>{
 const start=performance.now(),phases=[]
 const fetchImpl=async(input,init)=>{
  const path=new URL(input).pathname,phase=path.startsWith('/auth/')?'auth':path.startsWith('/rest/')?'sql':'storage',t=performance.now()
  const response=await fetch(input,init)
  phases.push(phase+';dur='+Math.round(performance.now()-t))
  if(phase==='storage'&&request.headers.get('x-synthetic-mode')==='oversize')return new Response(new Uint8Array(8*1024*1024+1),{headers:{'content-type':'image/jpeg'}})
  if(phase==='storage'&&request.headers.get('x-synthetic-mode')==='stall')return new Response(new ReadableStream({start(c){init.signal.addEventListener('abort',()=>c.error(Error('SYNTHETIC_STALL')),{once:true})}}),{headers:{'content-type':'image/jpeg'}})
  if(phase==='storage'&&request.headers.get('x-synthetic-mode')==='revoke') {
   const evidence=path.split('/').at(-2)
   if(!/^[a-f0-9-]{36}$/.test(evidence))throw Error('SYNTHETIC_SCOPE_INVALID')
   const k=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
   const changed=await fetch(url+'/rest/v1/trade_evidence?id=eq.'+evidence,{method:'PATCH',headers:{apikey:k,authorization:'Bearer '+k,'content-type':'application/json'},body:'{"permission_confirmed":false}',redirect:'error'})
   if(!changed.ok)throw Error('SYNTHETIC_MUTATION_FAILED')
  }
  return response
 }
 const response=await createPrivateMediaHandler({url,key,allowedOrigin:'https://hub.amphon.co.th',fetchImpl})(request)
 const headers=new Headers(response.headers);headers.set('server-timing',[...phases,'handler;dur='+Math.round(performance.now()-start)].join(','))
 return new Response(response.body,{status:response.status,headers})
})
