/** Authenticated POST only. No signed URLs, service key, R2 or public GET path. */
async function boundedBytes(stream,limit,signal) {
 if(!stream)throw Error('DENIED')
 const reader=stream.getReader(),parts=[];let size=0,rejectAbort
 const aborted=new Promise((_resolve,reject)=>{rejectAbort=reject})
 const cancel=()=>{rejectAbort(Error('DENIED'));void reader.cancel().catch(()=>{})}
 signal.addEventListener('abort',cancel,{once:true})
 try {
  if(signal.aborted)throw Error('DENIED')
  while(true){const {done,value}=await Promise.race([reader.read(),aborted]);if(signal.aborted)throw Error('DENIED');if(done)break;
   size+=value.byteLength;if(size>limit)throw Error('DENIED');parts.push(value)}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length}
  return bytes
 }finally {signal.removeEventListener('abort',cancel);void reader.cancel().catch(()=>{});reader.releaseLock()}
}
export function createPrivateMediaHandler({url,key,fetchImpl=fetch,allowedOrigin,now=Date.now,inputTimeoutMs=5000,upstreamTimeoutMs=15000}) {
 const headers={'cache-control':'private, no-store, max-age=0','pragma':'no-cache','expires':'0',
  'x-content-type-options':'nosniff','vary':'Origin, Authorization'}
 return async request=>{
  const origin=request.headers.get('origin')
  const reply=(body,status)=>new Response(body,{status,headers:{...headers,...(origin===allowedOrigin?{'access-control-allow-origin':origin}:{})}})
  if(origin!==allowedOrigin)return reply('ACCESS_DENIED',403)
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,
   'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS',
   'access-control-allow-headers':'authorization, apikey, content-type'}})
  if(request.method!=='POST')return reply('NOT_FOUND',404)
  const token=request.headers.get('authorization')||''
  if(!/^Bearer [^\s]+$/.test(token))return reply('UNAUTHORIZED',401)
  const auth={apikey:key,authorization:token}
  // Own timer lifetime and parent propagation explicitly; do not depend on
  // transport cancellation to terminate a stalled response-body reader.
  const timers=[],listeners=[]
  const deadline=(ms,parent)=>{const controller=new AbortController();timers.push(setTimeout(()=>controller.abort(),ms));
   if(parent){const abort=()=>controller.abort();parent.addEventListener('abort',abort,{once:true});listeners.push(()=>parent.removeEventListener('abort',abort));if(parent.aborted)abort()}
   return controller.signal}
  const lifetime=deadline(60000)
  const call=(path,init={})=>fetchImpl(new URL(path,url),{...init,headers:{...auth,...init.headers},
   cache:'no-store',redirect:'error',signal:deadline(upstreamTimeoutMs,lifetime)})
  try {
   const started=now()
   if(!request.body||Number(request.headers.get('content-length')||0)>1024)return reply('REQUEST_INVALID',422)
   let inputBytes
   try {inputBytes=await boundedBytes(request.body,1024,deadline(inputTimeoutMs,lifetime))}
   catch {return reply('REQUEST_INVALID',422)}
   const text=new TextDecoder('utf8',{fatal:true}).decode(inputBytes)
   const input=JSON.parse(text)
   if(!/^[a-f0-9-]{36}$/i.test(input.image_id||'')||!['PREVIEW','EXPORT'].includes(input.purpose))return reply('REQUEST_INVALID',422)
   const authorize=async()=>{
    const user=await call('/auth/v1/user')
    if(!user.ok)throw Error('UNAUTHORIZED')
    const response=await call('/rest/v1/rpc/evidence_private_access',{method:'POST',headers:{'content-type':'application/json'},
     body:JSON.stringify({p_image:input.image_id,p_purpose:input.purpose})})
    if(!response.ok)throw Error('DENIED')
    return response.json()
   }
   const before=await authorize()
   if(!/^[a-f0-9-]{36}\/[a-z0-9_.-]+\.(?:jpe?g|png|webp)$/i.test(before.storage_path||''))throw Error('DENIED')
   const object=await call('/storage/v1/object/authenticated/trade-evidence-private/'+before.storage_path.split('/').map(encodeURIComponent).join('/'))
   if(!object.ok||!/^image\/(?:jpeg|png|webp)(?:;|$)/i.test(object.headers.get('content-type')||''))throw Error('DENIED')
   const bytes=await boundedBytes(object.body,8*1024*1024,deadline(upstreamTimeoutMs,lifetime))
   const after=await authorize()
   if(now()-started>=60000||JSON.stringify(before)!==JSON.stringify(after))throw Error('DENIED')
   return new Response(bytes,{headers:{...headers,'access-control-allow-origin':origin,
    'content-type':object.headers.get('content-type'),'content-disposition':'inline; filename="private-evidence"'}})
  }catch(error){return reply(error?.message==='UNAUTHORIZED'?'UNAUTHORIZED':'ACCESS_DENIED',error?.message==='UNAUTHORIZED'?401:403)}
  finally{timers.forEach(clearTimeout);listeners.forEach(remove=>remove())}
 }
}
