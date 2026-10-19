import { facebookCatalogMessage, type PublicFacebookProduct } from './facebook-catalog-message'

type Env = { SUPABASE_URL: string; SUPABASE_SECRET_KEY: string }
type Candidate = {
  id:string;product_id:string;connection_key:string;post_id:string;sku:string
  content_revision:string;image_revision:string;image_synced_revision:string|null
  catalog_attempts:number
}
type Product = PublicFacebookProduct & {
  id:string;status:string;one_managed:boolean;one_availability:string|null
  public_content_revision_at:string;public_images_revision_at:string
}
type Image = {id:string;public_url:string|null;object_key:string;sort_order:number;is_cover:boolean}

async function db<T>(env:Env,path:string,init:RequestInit={}):Promise<T>{
  const response=await fetch(env.SUPABASE_URL.replace(/\/$/,'')+'/rest/v1/'+path,{
    ...init,headers:{apikey:env.SUPABASE_SECRET_KEY,authorization:'Bearer '+env.SUPABASE_SECRET_KEY,
      'content-type':'application/json',...(init.headers||{})},
  })
  const raw=await response.text()
  if(!response.ok)throw new Error('CATALOG_DB_'+response.status+':'+raw.slice(0,300))
  return raw?JSON.parse(raw) as T:null as T
}

async function authority(env:Env,c:Candidate):Promise<Product|null>{
  const rows=await db<Product[]>(env,'products?id=eq.'+encodeURIComponent(c.product_id)+
    '&select=id,sku,title,status,price,specs,condition_percent,defects,warranty_until,battery_health_grade,one_managed,one_availability,one_quick_sale_price,one_stock_age_days,one_dealer_eligibility,public_content_revision_at,public_images_revision_at&limit=1')
  const p=rows?.[0]
  if(!p || p.sku!==c.sku || !['ready_to_list','published','reserved'].includes(p.status)
    || (p.one_managed && !['IN_STOCK','RESERVED'].includes(p.one_availability||''))) return null
  if (Date.parse(p.public_content_revision_at)!==Date.parse(c.content_revision)
    || Date.parse(p.public_images_revision_at)!==Date.parse(c.image_revision)) return null
  return p
}

async function tokenFor(env:Env,key:string,postId:string){
  const cr=await db<{pageAccessToken?:string;pageId?:string}>(env,'rpc/central_channel_read_credentials',{
    method:'POST',body:JSON.stringify({p_channel_key:'facebook_page',p_connection_key:key}),
  })
  if (!cr?.pageAccessToken || !cr.pageId || !postId.startsWith(cr.pageId+'_'))
    throw new Error('CATALOG_FACEBOOK_PAGE_IDENTITY_REVIEW_REQUIRED')
  return {token:cr.pageAccessToken,pageId:cr.pageId}
}

async function graph<T>(path:string,token:string,params:Record<string,string>|null=null):Promise<T>{
  const url='https://graph.facebook.com/v23.0/'+path
  const init:RequestInit=params?{
    method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({...params,access_token:token}),
  }:undefined as unknown as RequestInit
  const target=params?url:url+'?'+new URLSearchParams({fields:'id,message',access_token:token})
  const res=await fetch(target,init)
  const json=await res.json() as T & {error?:{message?:string}}
  if(!res.ok || json.error)
    throw new Error('CATALOG_GRAPH_'+res.status+':'+String(json.error?.message||'Unknown').slice(0,320))
  return json
}

async function readMessage(postId:string,token:string):Promise<string>{
  const obj=await graph<{id:string;message?:string}>(encodeURIComponent(postId),token)
  if(obj.id!==postId)throw new Error('CATALOG_POST_ID_MISMATCH')
  return String(obj.message||'')
}

async function patchLedger(env:Env,c:Candidate,updates:Record<string,unknown>){
  await db(env,'facebook_post_ledger?id=eq.'+encodeURIComponent(c.id),{
    method:'PATCH',headers:{prefer:'return=minimal'},
    body:JSON.stringify({...updates,updated_at:new Date().toISOString()}),
  })
}

async function readPhotoIds(postId:string,token:string):Promise<string[]>{
  const fields='id,attachments{target,subattachments}'
  const r=await fetch('https://graph.facebook.com/v23.0/'+encodeURIComponent(postId)+
    '?'+new URLSearchParams({fields,access_token:token}))
  const obj=await r.json() as any
  if(!r.ok||obj.error||obj.id!==postId)
    throw new Error('CATALOG_MEDIA_VERIFY_UNAVAILABLE:'+String(obj.error?.message||r.status).slice(0,160))
  const ids:string[]=[]
  const crawl=(a:any)=>{
    if(!a)return
    if(a.target?.id)ids.push(String(a.target.id))
    if(Array.isArray(a.data))for(const child of a.data)crawl(child)
    if(a.subattachments)crawl(a.subattachments)
  }
  crawl(obj.attachments)
  return ids
}

/**
 * Facebook may refuse to replace media on an already published feed post.
 * Only use the original post ID. Verify attachments after every mutation.
 * Never replace the post by publishing another /feed item.
 */
async function tryUpdatePhotos(env:Env,c:Candidate,pageId:string,token:string){
  const rows=await db<Image[]>(env,'product_images?product_id=eq.'+encodeURIComponent(c.product_id)+
    '&select=id,public_url,object_key,sort_order,is_cover&order=sort_order.asc&limit=11')
  if(!rows?.length||rows.length>10)
    throw new Error('CATALOG_MEDIA_MANUAL_REVIEW_REQUIRED:IMAGE_COUNT')
  const media:string[]=[]
  for(const item of rows){
    let url:URL
    try{url=new URL(String(item.public_url||''))}catch{throw new Error('CATALOG_MEDIA_MANUAL_REVIEW_REQUIRED:INVALID_URL')}
    if(url.protocol!=='https:' || url.hostname!=='amphon-product-images.noteroru2.workers.dev'
      || !item.object_key.startsWith('products/'+c.product_id+'/'))
      throw new Error('CATALOG_MEDIA_MANUAL_REVIEW_REQUIRED:UNTRUSTED_IMAGE')
    const uploaded=await graph<{id:string}>(encodeURIComponent(pageId)+'/photos',token,{
      url:url.toString(),published:'false',
    })
    if(!uploaded.id)throw new Error('CATALOG_MEDIA_UPLOAD_NOT_CONFIRMED')
    media.push(uploaded.id)
  }
  if(!await authority(env,c))return false
  const params:Record<string,string>={}
  media.forEach((id,i)=>{params['attached_media['+i+']']=JSON.stringify({media_fbid:id})})
  const result=await graph<{success?:boolean;id?:string}>(encodeURIComponent(c.post_id),token,params)
  if(result.success!==true && result.id!==c.post_id)
    throw new Error('CATALOG_MEDIA_EDIT_UNCONFIRMED')
  const recorded=await readPhotoIds(c.post_id,token)
  if(media.some(id=>!recorded.includes(id)))
    throw new Error('CATALOG_MEDIA_MANUAL_REVIEW_REQUIRED:READBACK_MISMATCH')
  return true
}

export async function runFacebookCatalogSyncSweep(env:Env){
  const rows=await db<Candidate[]>(env,'rpc/facebook_catalog_sync_candidates',{
    method:'POST',body:JSON.stringify({max_posts:3}),
  })
  const results:Array<{sku:string;postId:string;status:string;error?:string}>=[]
  for(const c of Array.isArray(rows)?rows:[]){
    try{
      const p=await authority(env,c)
      if(!p){results.push({sku:c.sku,postId:c.post_id,status:'STALE_OR_SOLD'});continue}
      const {token,pageId}=await tokenFor(env,c.connection_key,c.post_id)
      const before=await readMessage(c.post_id,token)
      const next=facebookCatalogMessage(before,p)
      if(next.changed){
        if(!await authority(env,c)){results.push({sku:c.sku,postId:c.post_id,status:'STALE'});continue}
        const updated=await graph<{success?:boolean;id?:string}>(encodeURIComponent(c.post_id),token,{message:next.message})
        if(updated.success!==true&&updated.id!==c.post_id)throw new Error('CATALOG_MESSAGE_EDIT_UNCONFIRMED')
        if(await readMessage(c.post_id,token)!==next.message)
          throw new Error('CATALOG_MESSAGE_READBACK_MISMATCH')
      }
      // If photos changed after the publication snapshot, attempt an in-place
      // update. Unsupported Facebook post types remain flagged, not duplicated.
      const imagesChanged=!c.image_synced_revision
        || Date.parse(c.image_synced_revision)<Date.parse(c.image_revision)
      if(imagesChanged){
        const edited=await tryUpdatePhotos(env,c,pageId,token)
        if(!edited){results.push({sku:c.sku,postId:c.post_id,status:'STALE'});continue}
      }
      if(!await authority(env,c)){results.push({sku:c.sku,postId:c.post_id,status:'STALE'});continue}
      await patchLedger(env,c,{
        catalog_synced_revision_at:c.content_revision,
        ...(imagesChanged?{image_synced_revision_at:c.image_revision,image_sync_status:'VERIFIED',
                           image_sync_error:null}:{}),
        catalog_sync_attempts:0,catalog_sync_retry_at:null,catalog_sync_error:null,
      })
      results.push({sku:c.sku,postId:c.post_id,status:imagesChanged?'TEXT_AND_IMAGES_VERIFIED':next.changed?'TEXT_VERIFIED':'UNCHANGED_VERIFIED'})
    }catch(error){
      const message=String(error instanceof Error?error.message:error).slice(0,700)
      const attempts=Math.max(0,Number(c.catalog_attempts)||0)+1
      const review=/REVIEW_REQUIRED|UNAVAILABLE|READBACK_MISMATCH|PAGE_IDENTITY/.test(message)
      const delay=review?24*60*60*1000:Math.min(60*60*1000,60_000*2**Math.min(attempts-1,6))
      console.error('FACEBOOK CATALOG SYNC failed',{sku:c.sku,postId:c.post_id,error:message})
      try{await patchLedger(env,c,{
        catalog_sync_attempts:attempts,catalog_sync_retry_at:new Date(Date.now()+delay).toISOString(),
        catalog_sync_error:message,
        ...(message.includes('CATALOG_MEDIA')?{image_sync_status:'REVIEW_REQUIRED',image_sync_error:message}:{}),
      })}catch(e){console.error('FACEBOOK CATALOG failed to record retry',e)}
      results.push({sku:c.sku,postId:c.post_id,status:review?'REVIEW_REQUIRED':'RETRY',error:message.slice(0,180)})
    }
  }
  return results
}
