type Env={SUPABASE_URL:string;SUPABASE_SECRET_KEY:string}
type Ctx={user:{id:string};profile:{role:string}}
const enc=(s:string)=>new TextEncoder().encode(s)
async function hmac(secret:string,input:string){const k=await crypto.subtle.importKey('raw',enc(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return [...new Uint8Array(await crypto.subtle.sign('HMAC',k,enc(input)))].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function rest(env:Env,path:string,init:RequestInit={}){const r=await fetch(env.SUPABASE_URL.replace(/\/$/,'')+'/rest/v1/'+path,{...init,headers:{apikey:env.SUPABASE_SECRET_KEY,authorization:'Bearer '+env.SUPABASE_SECRET_KEY,'content-type':'application/json',...(init.headers||{})}});const t=await r.text();if(!r.ok)throw new Error(t||('DB '+r.status));return t?JSON.parse(t):null}
async function creds(env:Env,ch:string,key:string){const x=await rest(env,'rpc/central_channel_read_credentials',{method:'POST',body:JSON.stringify({p_channel_key:ch,p_connection_key:key})});return x||{}}
async function setCreds(env:Env,ch:string,key:string,c:any,external?:string|null){await rest(env,'rpc/central_channel_store_credentials',{method:'POST',body:JSON.stringify({p_channel_key:ch,p_connection_key:key,p_credentials:c,p_external_account_id:external||null})})}
function state(){const a=new Uint8Array(32);crypto.getRandomValues(a);return [...a].map(x=>x.toString(16).padStart(2,'0')).join('')}
export async function beginOAuth(request:Request,env:Env,ctx:Ctx,body:any){
 if(!['owner','admin'].includes(ctx.profile.role))throw new Error('ADMIN_ONLY')
 const ch=String(body.channelKey||''),key=String(body.connectionKey||'');const c=await creds(env,ch,key);if(!c.clientId)throw new Error('CLIENT_ID_REQUIRED')
 const st=state(),callback='https://api.amphontd.com/commerce/channel-connections/oauth/callback'
 await rest(env,'sales_channel_oauth_sessions',{method:'POST',headers:{prefer:'return=minimal'},body:JSON.stringify({state:st,channel_key:ch,connection_key:key,actor_id:ctx.user.id,redirect_uri:callback})})
 let authorizationUrl=''
 if(ch==='lazada'){const u=new URL('https://auth.lazada.com/oauth/authorize');u.search=new URLSearchParams({response_type:'code',force_auth:'true',redirect_uri:callback,client_id:c.clientId,state:st}).toString();authorizationUrl=u.toString()}
 else if(ch==='tiktok_shop'){if(!c.authorizationUrl)throw new Error('TIKTOK_AUTHORIZATION_URL_REQUIRED');const u=new URL(c.authorizationUrl);u.searchParams.set('state',st);authorizationUrl=u.toString()}
 else if(ch==='facebook_page'){const u=new URL('https://www.facebook.com/v23.0/dialog/oauth');u.search=new URLSearchParams({client_id:c.clientId,redirect_uri:callback,state:st,scope:'pages_show_list,pages_read_engagement,pages_manage_posts'}).toString();authorizationUrl=u.toString()}
 else throw new Error('OAUTH_NOT_AVAILABLE')
 return {authorizationUrl}
}
export async function oauthCallback(request:Request,env:Env){
 const u=new URL(request.url),st=u.searchParams.get('state')||'',code=u.searchParams.get('code')||'';if(!st||!code)throw new Error('OAUTH_CALLBACK_INVALID')
 const rows=await rest(env,'sales_channel_oauth_sessions?state=eq.'+encodeURIComponent(st)+'&consumed_at=is.null&expires_at=gt.'+encodeURIComponent(new Date().toISOString())+'&select=*&limit=1');const s=rows?.[0];if(!s)throw new Error('OAUTH_STATE_INVALID_OR_EXPIRED')
 const c=await creds(env,s.channel_key,s.connection_key);let next={...c};let external:string|null=null
 if(s.channel_key==='lazada'){const path='/auth/token/create',params:any={app_key:c.clientId,code,sign_method:'sha256',timestamp:String(Date.now())};const base=Object.keys(params).sort().map(k=>k+params[k]).join('');params.sign=(await hmac(c.clientSecret,path+base)).toUpperCase();const r=await fetch('https://auth.lazada.com/rest'+path+'?'+new URLSearchParams(params));const j:any=await r.json();if(!r.ok||!j.access_token)throw new Error('LAZADA_TOKEN_EXCHANGE_FAILED');next={...c,accessToken:j.access_token,refreshToken:j.refresh_token,expiresIn:j.expires_in,refreshExpiresIn:j.refresh_expires_in};external=j.account||j.country_user_info?.[0]?.seller_id||null}
 else if(s.channel_key==='tiktok_shop'){const q=new URLSearchParams({app_key:c.clientId,app_secret:c.clientSecret,auth_code:code,grant_type:'authorized_code'});const r=await fetch('https://auth.tiktok-shops.com/api/v2/token/get?'+q);const j:any=await r.json();if(!r.ok||j.code!==0||!j.data?.access_token)throw new Error('TIKTOK_TOKEN_EXCHANGE_FAILED');next={...c,accessToken:j.data.access_token,refreshToken:j.data.refresh_token,openId:j.data.open_id,grantedScopes:j.data.granted_scopes,userType:j.data.user_type}}
 else if(s.channel_key==='facebook_page'){const q=new URLSearchParams({client_id:c.clientId,client_secret:c.clientSecret,redirect_uri:s.redirect_uri,code});const r=await fetch('https://graph.facebook.com/v23.0/oauth/access_token?'+q);const j:any=await r.json();if(!r.ok||!j.access_token)throw new Error('FACEBOOK_TOKEN_EXCHANGE_FAILED');next={...c,userAccessToken:j.access_token}}
 await setCreds(env,s.channel_key,s.connection_key,next,external);await rest(env,'sales_channel_oauth_sessions?state=eq.'+encodeURIComponent(st),{method:'PATCH',headers:{prefer:'return=minimal'},body:JSON.stringify({consumed_at:new Date().toISOString()})})
 return {channelKey:s.channel_key,connectionKey:s.connection_key}
}
async function tiktokSign(secret:string,path:string,p:Record<string,string>){const base=path+Object.keys(p).sort().map(k=>k+p[k]).join('');return hmac(secret,secret+base+secret)}
async function lazadaCall(c:any,path:string){const p:any={app_key:c.clientId,access_token:c.accessToken,sign_method:'sha256',timestamp:String(Date.now())};const base=Object.keys(p).sort().map(k=>k+p[k]).join('');p.sign=(await hmac(c.clientSecret,path+base)).toUpperCase();const r=await fetch('https://api.lazada.co.th/rest'+path+'?'+new URLSearchParams(p));const j:any=await r.json();if(!r.ok||String(j.code||'0')!=='0')throw new Error('LAZADA_SELLER_TEST_FAILED');return j.data||j}
export async function testConnection(env:Env,ctx:Ctx,body:any){
 if(!['owner','admin'].includes(ctx.profile.role))throw new Error('ADMIN_ONLY');const ch=String(body.channelKey||''),key=String(body.connectionKey||''),c=await creds(env,ch,key);let identity:any;let next={...c}
 if(ch==='facebook_page'){
  const userToken=c.userAccessToken||c.accessToken;if(!userToken)throw new Error('FACEBOOK_AUTHORIZE_REQUIRED')
  const r=await fetch('https://graph.facebook.com/v23.0/me/accounts?fields=id,name,access_token&access_token='+encodeURIComponent(userToken));const j:any=await r.json();if(!r.ok||j.error)throw new Error('FACEBOOK_TEST_FAILED')
  const pages=j.data||[];const configured=String(c.externalAccountId||'');const target=configured?pages.find((x:any)=>String(x.id)===configured):pages[0];if(!target?.id||!target?.access_token)throw new Error('FACEBOOK_PAGE_NOT_AUTHORIZED')
  identity={id:target.id,name:target.name};next={...c,userAccessToken:userToken,pageAccessToken:target.access_token,pageId:String(target.id),pageName:String(target.name||'')}
  await setCreds(env,ch,key,next,String(target.id))
 } else if(ch==='tiktok_shop'){
  if(!c.accessToken)throw new Error('TIKTOK_AUTHORIZE_REQUIRED');const path='/authorization/202309/shops',p={app_key:c.clientId,timestamp:String(Math.floor(Date.now()/1000)),version:'202309'};const sign=await tiktokSign(c.clientSecret,path,p)
  const r=await fetch('https://open-api.tiktokglobalshop.com'+path+'?'+new URLSearchParams({...p,sign}),{headers:{'x-tts-access-token':c.accessToken,'content-type':'application/json'}});const j:any=await r.json();if(!r.ok||j.code!==0||!j.data?.shops?.length)throw new Error('TIKTOK_SHOP_TEST_FAILED')
  const shop=j.data.shops[0];identity={id:shop.id||shop.shop_id,name:shop.name||shop.shop_name,shopCipher:shop.cipher||shop.shop_cipher};if(!identity.shopCipher)throw new Error('TIKTOK_SHOP_CIPHER_MISSING')
  next={...c,shopId:String(identity.id||''),shopName:String(identity.name||''),shopCipher:String(identity.shopCipher)};await setCreds(env,ch,key,next,String(identity.id||identity.shopCipher))
 } else if(ch==='lazada'){
  if(!c.accessToken)throw new Error('LAZADA_AUTHORIZE_REQUIRED');identity=await lazadaCall(c,'/seller/get');const sellerId=identity.seller_id||identity.id||identity.sellerId;next={...c,sellerId:sellerId?String(sellerId):undefined};await setCreds(env,ch,key,next,sellerId?String(sellerId):null)
 } else throw new Error('TEST_NOT_AVAILABLE')
 await rest(env,'sales_channel_connections?channel_key=eq.'+encodeURIComponent(ch)+'&connection_key=eq.'+encodeURIComponent(key),{method:'PATCH',headers:{prefer:'return=minimal'},body:JSON.stringify({verified_at:new Date().toISOString(),activation_status:'VERIFIED',external_account_id:String(identity.id||identity.seller_id||identity.code||identity.name||c.externalAccountId||'authorized'),last_error:null})})
 return {ok:true,identity}
}
export async function markTestPublish(env:Env,ctx:Ctx,body:any){
 if(!['owner','admin'].includes(ctx.profile.role))throw new Error('ADMIN_ONLY');const ch=String(body.channelKey||''),key=String(body.connectionKey||''),productId=String(body.productId||'');const rows=await rest(env,'sales_channel_connections?channel_key=eq.'+encodeURIComponent(ch)+'&connection_key=eq.'+encodeURIComponent(key)+'&select=activation_status,environment&limit=1');const x=rows?.[0];if(x?.activation_status!=='VERIFIED')throw new Error('CONNECTION_MUST_BE_VERIFIED_FIRST');if(!productId)throw new Error('TEST_PRODUCT_REQUIRED')
 const products=await rest(env,'products?id=eq.'+encodeURIComponent(productId)+'&select=id,sku,title,status&limit=1');const p=products?.[0];if(!p||!/^TEST[-_]/i.test(p.sku))throw new Error('TEST_SKU_REQUIRED_PREFIX_TEST')
 await rest(env,'sales_channel_jobs',{method:'POST',headers:{prefer:'return=minimal'},body:JSON.stringify({channel_key:ch,action:'PUBLISH',status:'PENDING',product_id:p.id,idempotency_key:'test:'+ch+':'+key+':'+p.id,payload:{connectionKey:key,testMode:true}})})
 return {ok:true,result:{queued:true,sku:p.sku}}
}
