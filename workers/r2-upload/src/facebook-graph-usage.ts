/** Capture non-secret Facebook Graph usage for BOTH successful and failed calls.
 * Never persist tokens, full URLs, request payloads, or Graph response bodies.
 * This is advisory telemetry: it does not circumvent Meta-imposed restrictions.
 */
type Env={SUPABASE_URL:string;SUPABASE_SECRET_KEY:string}
function numeric(value:unknown):number|null {
  const n=Number(value)
  return value===null||value===undefined||value===''||!Number.isFinite(n)?null:n
}
function usage(headers:Headers){
  let app:number|null=null,business:number|null=null,recovery:number|null=null
  try {
    const json=JSON.parse(headers.get('x-app-usage')||'null')
    app=numeric(json?.call_count)
  } catch { /* May be absent or malformed. */ }
  try {
    const json=JSON.parse(headers.get('x-business-use-case-usage')||'null')
    const values=Object.values(json||{}).flatMap((x:any)=>Array.isArray(x)?x:[])
    for(const v of values){
      const percent=numeric(v?.call_count),minutes=numeric(v?.estimated_time_to_regain_access)
      if(percent!==null)business=Math.max(business??0,percent)
      if(minutes!==null)recovery=Math.max(recovery??0,minutes)
    }
  } catch { /* May be absent or malformed. */ }
  return {app,business,recovery}
}
export async function facebookRecordGraphResponse(
 env:Env,connectionKey:string,operation:string,response:Response,data?:any,
):Promise<void>{
  const {app,business,recovery}=usage(response.headers)
  let error:any=data?.error||{}
  if(!response.ok && !data)try{error=((await response.clone().json()) as any)?.error||{}}catch{}
  const errorCode=numeric(error.code),errorSubcode=numeric(error.error_subcode)
  // Write one small service-role-only row for every Graph response.
  try {
    const recorded=await fetch(env.SUPABASE_URL.replace(/\/$/,'')+'/rest/v1/rpc/facebook_graph_usage_record',{
      method:'POST',headers:{apikey:env.SUPABASE_SECRET_KEY,
        authorization:'Bearer '+env.SUPABASE_SECRET_KEY,'content-type':'application/json'},
      body:JSON.stringify({p_connection_key:connectionKey,p_operation:operation,p_http_status:response.status,
        p_error_code:errorCode,p_error_subcode:errorSubcode,
        p_fbtrace_id:error.fbtrace_id?String(error.fbtrace_id).slice(0,120):null,
        p_app_call_percent:app,p_business_call_percent:business,p_business_recovery_minutes:recovery}),
    })
    if(!recorded.ok)console.error('FACEBOOK_USAGE_RECORD_FAILED',connectionKey,operation,recorded.status)
  }catch{console.error('FACEBOOK_USAGE_RECORD_UNAVAILABLE',connectionKey,operation)}
}

export async function facebookObservedFetch(
 env:Env,connectionKey:string,operation:string,url:string,init?:RequestInit,
):Promise<Response>{
 const response=await fetch(url,init)
 await facebookRecordGraphResponse(env,connectionKey,operation,response)
 // Only unpublished photo uploads should abort a multi-photo publish.
 const {app,business,recovery}=usage(response.headers)
 if(operation==='photo-upload'&&response.ok&&
    (Math.max(app??0,business??0)>=80||(recovery??0)>0))
   throw new Error('META_USAGE_SAFETY_HOLD:graph-usage-high')
 return response
}
