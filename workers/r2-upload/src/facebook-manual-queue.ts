type Env={SUPABASE_URL:string;SUPABASE_SECRET_KEY:string}
type Ctx={profile:{role:string}}
async function enqueue(env:Env,productId:string,key:string){
 const response=await fetch(env.SUPABASE_URL.replace(/\/$/,'')+'/rest/v1/rpc/facebook_manual_publish_enqueue',{
  method:'POST',headers:{apikey:env.SUPABASE_SECRET_KEY,
    authorization:'Bearer '+env.SUPABASE_SECRET_KEY,'content-type':'application/json'},
  body:JSON.stringify({p_product_id:productId,p_connection_key:key}),
 })
 if(!response.ok)throw new Error('FACEBOOK_MANUAL_ENQUEUE_'+response.status)
 return response.json() as Promise<Record<string,any>>
}
/**
 * Owner manually requests placement in the SAME rotation queue used by
 * auto publishing. No Graph calls, no bypass of quotas, and never claim
 * immediate success. Queue's atomic prepare/capture preserves every ID.
 */
export async function facebookQueueSelected(env:Env,ctx:Ctx,body:any){
 if(!['owner','admin'].includes(ctx.profile.role))throw new Error('ADMIN_ONLY')
 const id=String(body.productId||'')
 const pages:string[]=Array.isArray(body.connectionKeys)?body.connectionKeys.map(String):[]
 const keys:string[]=Array.from(new Set<string>(pages))
 if(!/^[a-f0-9-]{36}$/i.test(id)||keys.length<1||keys.length>2
    ||keys.some(key=>!['page_1','page_2'].includes(key)))
   throw new Error('PRODUCT_AND_VALID_FACEBOOK_PAGES_REQUIRED')
 const results:Array<Record<string,any>>=[]
 for(const key of keys){
  try{
   const r=await enqueue(env,id,key)
   results.push({connectionKey:key,ok:r.ok===true,status:String(r.status||'ERROR'),
    ...(r.queueId?{queueId:String(r.queueId)}:{}),
    ...(r.postId?{postId:String(r.postId)}:{}),
    ...(r.reusedQueue?{reusedQueue:true}:{})})
  }catch(e){
   results.push({connectionKey:key,ok:false,status:'ERROR',
    error:e instanceof Error?e.message:'FACEBOOK_MANUAL_ENQUEUE_FAILED'})
  }
 }
 return {ok:results.some(x=>x.ok),results}
}
