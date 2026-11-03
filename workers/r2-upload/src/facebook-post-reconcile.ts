import { facebookObservedFetch } from './facebook-graph-usage'

type Env={SUPABASE_URL:string;SUPABASE_SECRET_KEY:string}
type Candidate={queue_id:string;connection_key:string;marker:string|null;started_at:string;sku:string;attempt_no:number}
type Post={id:string;message?:string;created_time?:string}
async function db<T=any>(env:Env,path:string,init:RequestInit={}):Promise<T>{
 const r=await fetch(env.SUPABASE_URL.replace(/\/$/,'')+'/rest/v1/'+path,{
  ...init,headers:{apikey:env.SUPABASE_SECRET_KEY,
   authorization:'Bearer '+env.SUPABASE_SECRET_KEY,'content-type':'application/json',...(init.headers||{})},
 })
 if(!r.ok)throw new Error('FACEBOOK_RECONCILE_DB_'+r.status)
 const body=await r.text()
 return (body?JSON.parse(body):null) as T
}
async function rpc<T=any>(env:Env,name:string,params:object):Promise<T>{
 return db<T>(env,'rpc/'+name,{method:'POST',body:JSON.stringify(params)})
}
function postMatch(post:Post,c:Candidate):boolean{
 if(!post.id||!post.created_time)return false
 const when=Date.parse(post.created_time),start=Date.parse(c.started_at)
 if(!Number.isFinite(when)||!Number.isFinite(start)||Math.abs(when-start)>10*60*1000)return false
 const text=String(post.message||'')
 // New posts carry a stable, unique public reference. No fuzzy title matching.
 if(c.marker)return text.includes('รหัสประกาศ: '+c.marker)
 // Legacy posts predate public reference IDs: use exact SKU link + +/-10 min.
 return text.includes('https://shop.amphon.co.th/product/'+encodeURIComponent(c.sku))
  || text.includes('https://shop.amphon.co.th/product/'+c.sku)
}
async function pagePosts(env:Env,key:string):Promise<Post[]>{
 const credentials=await rpc<any>(env,'central_channel_read_credentials',{
  p_channel_key:'facebook_page',p_connection_key:key,
 })
 if(!credentials?.pageId||!credentials.pageAccessToken)throw new Error('FACEBOOK_RECONCILE_CREDENTIAL_MISSING')
 const c=String(credentials.pageId),token=String(credentials.pageAccessToken)
 const since=Math.floor((Date.now()-7*24*60*60*1000)/1000)
 const all:Post[]=[]
 let after:string|null=null
 for(let page=0;page<2;page++){
  const params=new URLSearchParams({fields:'id,message,created_time',since:String(since),limit:'100',access_token:token})
  if(after)params.set('after',after)
  const r=await facebookObservedFetch(env,key,'post-id-reconcile',
   'https://graph.facebook.com/v23.0/'+encodeURIComponent(c)+'/published_posts?'+params)
  const json:any=await r.json()
  if(!r.ok||json.error){
   const code=String(json?.error?.code||r.status)
   throw new Error('FACEBOOK_RECONCILE_GRAPH_'+code)
  }
  if(Array.isArray(json.data))all.push(...json.data)
  after=json.paging?.next&&json.paging?.cursors?.after?String(json.paging.cursors.after):null
  if(!after)break
 }
 return all
}
export async function reconcileFacebookPublishAttempts(env:Env){
 const candidates=await rpc<Candidate[]>(env,'facebook_publish_reconcile_claim',{max_jobs:3})
 const result:Array<{queueId:string;ok:boolean;status:string}>=[]
 const byKey=new Map<string,Candidate[]>()
 for(const c of Array.isArray(candidates)?candidates:[])
  byKey.set(c.connection_key,[...(byKey.get(c.connection_key)||[]),c])
 for(const [key,group] of byKey){
  let posts:Post[]=[]
  try{posts=await pagePosts(env,key)}
  catch(error){
   const reason=String(error instanceof Error?error.message:error).slice(0,120)
   const denied=reason.includes('GRAPH_10')||reason.includes('GRAPH_200')
   for(const c of group){
    await rpc(env,'facebook_publish_reconcile_result',{
     p_queue_id:c.queue_id,p_error:reason,p_permission_denied:denied,
    })
    result.push({queueId:c.queue_id,ok:false,status:denied?'PERMISSION_REVIEW':'GRAPH_RETRY'})
   }
   continue
  }
  for(const c of group){
   const matches=posts.filter(p=>postMatch(p,c))
   if(matches.length!==1){
    await rpc(env,'facebook_publish_reconcile_result',{
     p_queue_id:c.queue_id,p_error:matches.length?'MULTIPLE_POST_MATCHES':'NO_EXACT_POST_MATCH',
     p_permission_denied:matches.length>1,
    })
    result.push({queueId:c.queue_id,ok:false,status:matches.length?'AMBIGUOUS':'NOT_FOUND'})
    continue
   }
   const p=matches[0]
   try{
    // Capture first; even if verification fails, ID remains in queue + ledger.
    await rpc(env,'facebook_publish_capture',{
      p_queue_id:c.queue_id,p_connection_key:c.connection_key,
      p_post_id:String(p.id),p_marker:c.marker,p_verified_at:p.created_time,
    })
    const credentials=await rpc<any>(env,'central_channel_read_credentials',{
      p_channel_key:'facebook_page',p_connection_key:key,
    })
    const url='https://graph.facebook.com/v23.0/'+encodeURIComponent(p.id)+
      '?'+new URLSearchParams({fields:'id,permalink_url',access_token:String(credentials.pageAccessToken)})
    const verification=await facebookObservedFetch(env,key,'post-id-verify',url)
    const j:any=await verification.json()
    if(!verification.ok||j.error||String(j.id)!==p.id)
      throw new Error('FACEBOOK_RECONCILE_VERIFICATION_FAILED')
    const externalUrl=String(j.permalink_url||('https://www.facebook.com/'+p.id))
    await db(env,'facebook_post_ledger?post_id=eq.'+encodeURIComponent(p.id),{
      method:'PATCH',headers:{prefer:'return=minimal'},
      body:JSON.stringify({status:'LIVE',external_url:externalUrl,updated_at:new Date().toISOString(),last_error:null}),
    })
    await db(env,'facebook_rotation_queue?id=eq.'+encodeURIComponent(c.queue_id),{
      method:'PATCH',headers:{prefer:'return=minimal'},
      body:JSON.stringify({status:'POSTED',last_error:null,next_attempt_at:null,claim_token:null}),
    })
    result.push({queueId:c.queue_id,ok:true,status:'RECOVERED'})
   }catch(error){
    result.push({queueId:c.queue_id,ok:false,status:'CAPTURED_NEEDS_LEDGER_REPAIR'})
    console.error('FACEBOOK_RECONCILE_CAPTURE_FAILED',key,c.queue_id,
      error instanceof Error?error.message:'unknown')
   }
  }
 }
 return result
}
