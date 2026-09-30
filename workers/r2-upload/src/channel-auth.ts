type Env={SUPABASE_URL:string;SUPABASE_SECRET_KEY:string;CHANNEL_OAUTH_CALLBACK_URL?:string}
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
 const st=state(),callback=String(env.CHANNEL_OAUTH_CALLBACK_URL||'https://amphon-product-images.noteroru2.workers.dev/commerce/channel-connections/oauth/callback').trim()
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
 else if(s.channel_key==='facebook_page'){const q=new URLSearchParams({client_id:c.clientId,client_secret:c.clientSecret,redirect_uri:s.redirect_uri,code});const r=await fetch('https://graph.facebook.com/v23.0/oauth/access_token?'+q);const j:any=await r.json();if(!r.ok||!j.access_token)throw new Error('FACEBOOK_TOKEN_EXCHANGE_FAILED');const userToken=String(j.access_token);const pr=await fetch('https://graph.facebook.com/v23.0/me/accounts?fields=id,name,access_token&access_token='+encodeURIComponent(userToken));const pj:any=await pr.json();if(!pr.ok||pj.error)throw new Error('FACEBOOK_PAGE_LIST_FAILED');const pages=pj.data||[];next={...c,userAccessToken:userToken,authorizedPages:pages.map((x:any)=>({id:String(x.id),name:String(x.name||''),accessToken:String(x.access_token||'')})),pageAccessToken:null,pageId:null,pageName:null};external=null}
 await setCreds(env,s.channel_key,s.connection_key,next,external);if(s.channel_key==='facebook_page'){await rest(env,'sales_channel_connections?channel_key=eq.facebook_page&connection_key=eq.'+encodeURIComponent(s.connection_key),{method:'PATCH',headers:{prefer:'return=minimal'},body:JSON.stringify({verified_at:null,activation_status:'LOCKED',external_account_id:null,test_publish_at:null,last_error:null})})}await rest(env,'sales_channel_oauth_sessions?state=eq.'+encodeURIComponent(st),{method:'PATCH',headers:{prefer:'return=minimal'},body:JSON.stringify({consumed_at:new Date().toISOString()})})
 return {channelKey:s.channel_key,connectionKey:s.connection_key}
}
async function tiktokSign(secret:string,path:string,p:Record<string,string>){const base=path+Object.keys(p).sort().map(k=>k+p[k]).join('');return hmac(secret,secret+base+secret)}
async function lazadaCall(c:any,path:string){const p:any={app_key:c.clientId,access_token:c.accessToken,sign_method:'sha256',timestamp:String(Date.now())};const base=Object.keys(p).sort().map(k=>k+p[k]).join('');p.sign=(await hmac(c.clientSecret,path+base)).toUpperCase();const r=await fetch('https://api.lazada.co.th/rest'+path+'?'+new URLSearchParams(p));const j:any=await r.json();if(!r.ok||String(j.code||'0')!=='0')throw new Error('LAZADA_SELLER_TEST_FAILED');return j.data||j}
export async function listFacebookPages(env:Env,ctx:Ctx,body:any){if(!['owner','admin'].includes(ctx.profile.role))throw new Error('ADMIN_ONLY');const key=String(body.connectionKey||''),c=await creds(env,'facebook_page',key);const userToken=c.userAccessToken||c.accessToken;if(!userToken)throw new Error('FACEBOOK_AUTHORIZE_REQUIRED');const r=await fetch('https://graph.facebook.com/v23.0/me/accounts?fields=id,name,access_token&access_token='+encodeURIComponent(userToken));const j:any=await r.json();if(!r.ok||j.error)throw new Error('FACEBOOK_PAGE_LIST_FAILED');return {ok:true,pages:(j.data||[]).map((x:any)=>({id:String(x.id),name:String(x.name||'')}))}}
export async function selectFacebookPage(env:Env,ctx:Ctx,body:any){if(!['owner','admin'].includes(ctx.profile.role))throw new Error('ADMIN_ONLY');const key=String(body.connectionKey||''),pageId=String(body.pageId||'');if(!pageId)throw new Error('FACEBOOK_PAGE_REQUIRED');const c=await creds(env,'facebook_page',key),userToken=c.userAccessToken||c.accessToken;if(!userToken)throw new Error('FACEBOOK_AUTHORIZE_REQUIRED');const r=await fetch('https://graph.facebook.com/v23.0/me/accounts?fields=id,name,access_token&access_token='+encodeURIComponent(userToken));const j:any=await r.json();if(!r.ok||j.error)throw new Error('FACEBOOK_PAGE_LIST_FAILED');const target=(j.data||[]).find((x:any)=>String(x.id)===pageId);if(!target?.access_token)throw new Error('FACEBOOK_PAGE_NOT_AUTHORIZED');await setCreds(env,'facebook_page',key,{...c,pageAccessToken:String(target.access_token),pageId,pageName:String(target.name||''),testPostId:null,testPostDeletedAt:null},pageId);await rest(env,'sales_channel_connections?channel_key=eq.facebook_page&connection_key=eq.'+encodeURIComponent(key),{method:'PATCH',headers:{prefer:'return=minimal'},body:JSON.stringify({external_account_id:pageId,verified_at:new Date().toISOString(),activation_status:'VERIFIED',environment:'TEST',test_publish_at:null,last_error:null})});return {ok:true,page:{id:pageId,name:String(target.name||'')}}}
export async function testConnection(env:Env,ctx:Ctx,body:any){
 if(!['owner','admin'].includes(ctx.profile.role))throw new Error('ADMIN_ONLY');const ch=String(body.channelKey||''),key=String(body.connectionKey||''),c=await creds(env,ch,key);let identity:any;let next={...c}
 if(ch==='facebook_page'){
  const userToken=c.userAccessToken||c.accessToken;if(!userToken)throw new Error('FACEBOOK_AUTHORIZE_REQUIRED')
  const r=await fetch('https://graph.facebook.com/v23.0/me/accounts?fields=id,name,access_token&access_token='+encodeURIComponent(userToken));const j:any=await r.json();if(!r.ok||j.error)throw new Error('FACEBOOK_TEST_FAILED')
  const pages=j.data||[];const configured=String(c.pageId||c.externalAccountId||'');if(!configured)throw new Error('FACEBOOK_PAGE_SELECTION_REQUIRED');const target=pages.find((x:any)=>String(x.id)===configured);if(!target?.id||!target?.access_token)throw new Error('FACEBOOK_PAGE_NOT_AUTHORIZED')
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
export async function facebookTestPublish(env:Env,ctx:Ctx,body:any){
 if(!['owner','admin'].includes(ctx.profile.role))throw new Error('ADMIN_ONLY');const ch=String(body.channelKey||''),key=String(body.connectionKey||'');if(ch!=='facebook_page')throw new Error('FACEBOOK_ONLY')
 const rows=await rest(env,'sales_channel_connections?channel_key=eq.facebook_page&connection_key=eq.'+encodeURIComponent(key)+'&select=activation_status&limit=1');if(rows?.[0]?.activation_status!=='VERIFIED')throw new Error('CONNECTION_MUST_BE_VERIFIED')
 const c=await creds(env,ch,key);if(!c.pageAccessToken||!c.pageId)throw new Error('FACEBOOK_PAGE_TOKEN_MISSING')
 const message='[AMPHON TEST] ทดสอบการเชื่อมต่อ Amphon Product Hub — '+new Date().toISOString()
 const r=await fetch('https://graph.facebook.com/v23.0/'+encodeURIComponent(c.pageId)+'/feed',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({message,access_token:c.pageAccessToken})});const j:any=await r.json();if(!r.ok||j.error||!j.id)throw new Error('FACEBOOK_TEST_PUBLISH_FAILED:'+(j.error?.message||r.status))
 await setCreds(env,ch,key,{...c,testPostId:String(j.id),testPostDeletedAt:null},String(c.pageId));await rest(env,'sales_channel_connections?channel_key=eq.facebook_page&connection_key=eq.'+encodeURIComponent(key),{method:'PATCH',headers:{prefer:'return=minimal'},body:JSON.stringify({test_publish_at:new Date().toISOString(),last_error:null})})
 return {ok:true,postId:String(j.id)}
}
export async function facebookDeleteTest(env:Env,ctx:Ctx,body:any){
 if(!['owner','admin'].includes(ctx.profile.role))throw new Error('ADMIN_ONLY');const key=String(body.connectionKey||''),c=await creds(env,'facebook_page',key);if(!c.pageAccessToken||!c.testPostId)throw new Error('FACEBOOK_TEST_POST_MISSING')
 const r=await fetch('https://graph.facebook.com/v23.0/'+encodeURIComponent(c.testPostId)+'?access_token='+encodeURIComponent(c.pageAccessToken),{method:'DELETE'});const j:any=await r.json();if(!r.ok||j.error||j.success!==true)throw new Error('FACEBOOK_TEST_DELETE_FAILED:'+(j.error?.message||r.status))
 await setCreds(env,'facebook_page',key,{...c,testPostId:null,testPostDeletedAt:new Date().toISOString()},String(c.pageId||''));return {ok:true}
}
export async function activateChannel(env:Env,ctx:Ctx,body:any){
 if(!['owner','admin'].includes(ctx.profile.role))throw new Error('ADMIN_ONLY');const ch=String(body.channelKey||''),key=String(body.connectionKey||'');if(ch!=='facebook_page')throw new Error('ACTIVATION_NOT_AVAILABLE')
 const rows=await rest(env,'sales_channel_connections?channel_key=eq.facebook_page&connection_key=eq.'+encodeURIComponent(key)+'&select=activation_status,test_publish_at&limit=1');if(rows?.[0]?.activation_status!=='VERIFIED'||!rows?.[0]?.test_publish_at)throw new Error('TEST_PUBLISH_REQUIRED')
 const c=await creds(env,ch,key);if(!c.testPostDeletedAt||c.testPostId)throw new Error('DELETE_TEST_POST_REQUIRED')
 await rest(env,'sales_channel_connections?channel_key=eq.facebook_page&connection_key=eq.'+encodeURIComponent(key),{method:'PATCH',headers:{prefer:'return=minimal'},body:JSON.stringify({activation_status:'ACTIVE',environment:'PRODUCTION',last_error:null})});return {ok:true}
}
function facebookSalesContent(p:any,templateId='ROT-1'){
 const price=Number(p.price??0),specs=p.specs||{},title=String(p.title||p.sku),sku=String(p.sku||''),brand=title.trim().split(/\s+/)[0]||''
 const n=Math.max(1,Number(String(templateId).replace(/\D/g,''))||1), compact=(v:string)=>v.replace(/[^0-9A-Za-zก-๙]/g,'')
 const specsLines=[specs.cpu&&('CPU: '+specs.cpu),specs.gpu&&('GPU: '+specs.gpu),specs.ram&&('RAM: '+specs.ram),specs.ssd&&('SSD: '+specs.ssd),specs.screen_size&&('จอ: '+specs.screen_size+(specs.resolution?' '+specs.resolution:'')),specs.battery&&('แบตเตอรี่: '+specs.battery),specs.charger&&('อุปกรณ์: '+specs.charger)].filter(Boolean).slice(0,7)
 const notebook=sku.includes('-NB-')||/notebook|laptop|ideapad|vivobook|aspire|thinkpad|macbook/i.test(title), pc=sku.includes('-PC-')||/desktop|gaming pc|computer/i.test(title)
 const heads=['🔥 พร้อมส่ง ','✨ สินค้าเข้าใหม่ ','📣 มีของพร้อมขาย ','⭐ รุ่นน่าใช้ ','🛒 พร้อมส่งจากร้าน ','💻 เครื่องพร้อมใช้งาน ','⚡ ของเข้าแล้ว ','📌 แนะนำเครื่องนี้ ']
 const ctas=['💬 สนใจทักเพจสอบถามหรือสั่งซื้อได้เลยครับ','📩 ทักแอดมินเช็กสินค้าและสอบถามเพิ่มเติมได้ครับ','🛍️ สนใจรับเครื่องนี้ ทักเพจได้เลยครับ','💬 ต้องการรูปหรือรายละเอียดเพิ่ม ทักหาแอดมินได้ครับ']
 const local=notebook?['#โน๊ตบุ๊คมือสองอุบล','#โน๊ตบุ๊กมือสองอุบล','#คอมมือสองอุบล']:pc?['#คอมมือสองอุบล','#คอมพิวเตอร์มือสองอุบล','#ร้านคอมมือสองอุบล']:['#สินค้าไอทีมือสองอุบล','#ของมือสองอุบล']
 const buy=notebook?['#รับซื้อโน๊ตบุ๊ค','#รับซื้อโน๊ตบุ๊คอุบล','#รับซื้อโน๊ตบุ๊กมือสอง']:pc?['#รับซื้อคอม','#รับซื้อคอมมือสอง','#รับซื้อคอมอุบล']:['#รับซื้อสินค้าไอที','#รับซื้อสินค้าไอทีอุบล']
 const warranty=p.warranty_until?new Date(p.warranty_until):null,warrantyText=warranty&&!Number.isNaN(warranty.getTime())&&warranty.getTime()>Date.now()?'🛡️ มีประกันถึง '+warranty.toLocaleDateString('th-TH',{day:'numeric',month:'long',year:'numeric'}):null
 const tags=Array.from(new Set(['#อำพลเทรดดิ้ง',...local,...buy,brand&&('#'+compact(brand)),'#'+compact(title.split(/\s+/).slice(0,3).join(''))].filter(Boolean))).slice((n-1)%3,(n-1)%3+9).join(' ')
 const shop='https://shop.amphon.co.th/product/'+encodeURIComponent(sku)
 const message=[heads[(n-1)%heads.length]+title,'',...specsLines,p.condition_percent?('✅ สภาพประมาณ '+p.condition_percent+'%'):null,p.defects?('🔎 ตำหนิ/สภาพ: '+p.defects):null,'',warrantyText,warrantyText?['✨ มีประกันเหลือ เพิ่มความมั่นใจในการใช้งาน','✅ จุดเด่นคือยังมีประกันเหลือ','🛡️ ยังอยู่ในระยะประกัน ใช้งานต่ออุ่นใจขึ้น'][n%3]:null,price?('💰 ราคา '+price.toLocaleString('th-TH')+' บาท'):null,['📸 รูปสินค้าจริง รายละเอียดแจ้งตามสภาพจริง','📸 ภาพสินค้าจริงจากทางร้าน มีหลายมุมให้ตรวจสอบ','✅ ข้อมูลและตำหนิแจ้งตามสินค้าจริง'][n%3],ctas[n%ctas.length],'🔗 ดูรายละเอียด: '+shop,'',tags].filter(x=>x!==null).join('\n')
 return {message,shop,images:(Array.isArray(p.images)?p.images:[]).map((x:any)=>String(x?.url||'')).filter(Boolean).slice(0,10)}
}

async function publishFacebookRotationPost(env:Env,productId:string,key:string,templateId:string){
 const authority=await rest(env,'products?id=eq.'+encodeURIComponent(productId)+'&select=status,one_availability,one_availability_version&limit=1'),stock=authority?.[0]
 if(!stock||stock.one_availability!=='IN_STOCK'||!['ready_to_list','published','reserved'].includes(stock.status))throw new Error('PRODUCT_NOT_PUBLISHABLE')
 const rows=await rest(env,'commerce_public_listing_v?product_id=eq.'+encodeURIComponent(productId)+'&select=product_id,sku,title,status,condition_percent,price,warranty_until,defects,specs,images,slug&limit=1'),p=rows?.[0]
 if(!p||!['ready_to_list','published','reserved'].includes(p.status))throw new Error('PRODUCT_NOT_PUBLISHABLE')
 const cr=await creds(env,'facebook_page',key);if(!cr.pageAccessToken||!cr.pageId)throw new Error('FACEBOOK_PAGE_TOKEN_MISSING')
 const {message,shop,images}=facebookSalesContent(p,templateId);let j:any
 if(images.length){const mediaIds:string[]=[];for(const url of images){const ur=await fetch('https://graph.facebook.com/v23.0/'+encodeURIComponent(cr.pageId)+'/photos',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({url,published:'false',access_token:cr.pageAccessToken})});const uj:any=await ur.json();if(!ur.ok||uj.error||!uj.id)throw new Error('PHOTO_UPLOAD_FAILED:'+(uj.error?.message||ur.status));mediaIds.push(String(uj.id))}
 const params=new URLSearchParams({message,access_token:cr.pageAccessToken});mediaIds.forEach((id,i)=>params.set('attached_media['+i+']',JSON.stringify({media_fbid:id})));const r=await fetch('https://graph.facebook.com/v23.0/'+encodeURIComponent(cr.pageId)+'/feed',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:params});j=await r.json();if(!r.ok||j.error||!j.id)throw new Error('FACEBOOK_PUBLISH_FAILED:'+(j.error?.message||r.status))}
 else {const r=await fetch('https://graph.facebook.com/v23.0/'+encodeURIComponent(cr.pageId)+'/feed',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({message,link:shop,access_token:cr.pageAccessToken})});j=await r.json();if(!r.ok||j.error||!j.id)throw new Error('FACEBOOK_PUBLISH_FAILED:'+(j.error?.message||r.status))}
 return {postId:String(j.id),pageId:String(cr.pageId),imageCount:images.length}
}

async function recordFacebookLearning(env:Env,job:any,postId:string,postedAt:string){
 const d=new Date(new Date(postedAt).getTime()+7*60*60*1000)
 await rest(env,'facebook_learning_ledger',{method:'POST',headers:{prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({queue_id:job.id,product_id:job.product_id,connection_key:job.connection_key,post_id:postId,template_id:job.template_id,posted_at:postedAt,local_hour:d.getUTCHours(),local_dow:d.getUTCDay(),metric_status:'PENDING',updated_at:new Date().toISOString()})})
}
async function collectFacebookLearning(env:Env){
 const rows=await rest(env,'facebook_learning_ledger?metric_status=in.(PENDING,ERROR,UNAVAILABLE)&posted_at=lt.'+encodeURIComponent(new Date(Date.now()-6*60*60*1000).toISOString())+'&select=*&order=posted_at.asc&limit=5')
 for(const row of Array.isArray(rows)?rows:[]){try{const cr=await creds(env,'facebook_page',String(row.connection_key));if(!cr.pageAccessToken)throw new Error('FACEBOOK_PAGE_TOKEN_MISSING')
   const url='https://graph.facebook.com/v23.0/'+encodeURIComponent(String(row.post_id))+'?fields=shares,comments.limit(0).summary(true),reactions.limit(0).summary(true)&access_token='+encodeURIComponent(cr.pageAccessToken)
   const rr=await fetch(url),j:any=await rr.json();if(!rr.ok||j.error)throw new Error(j.error?.message||('GRAPH_'+rr.status))
   const comments=Number(j.comments?.summary?.total_count||0),reactions=Number(j.reactions?.summary?.total_count||0),shares=Number(j.shares?.count||0),engaged=comments+reactions+shares
   await rest(env,'facebook_learning_ledger?id=eq.'+encodeURIComponent(row.id),{method:'PATCH',headers:{prefer:'return=minimal'},body:JSON.stringify({engaged_users:engaged,reactions,comments,shares,metric_status:'COLLECTED',metric_error:null,measured_at:new Date().toISOString(),updated_at:new Date().toISOString()})})
  }catch(e){const msg=e instanceof Error?e.message:String(e);await rest(env,'facebook_learning_ledger?id=eq.'+encodeURIComponent(row.id),{method:'PATCH',headers:{prefer:'return=minimal'},body:JSON.stringify({metric_status:/permission|unsupported/i.test(msg)?'UNAVAILABLE':'ERROR',metric_error:msg.slice(0,800),measured_at:new Date().toISOString(),updated_at:new Date().toISOString()})})}}
}
export async function runFacebookRotationSweep(env:Env){
 const bkk=new Date(Date.now()+7*60*60*1000);if(bkk.getUTCDay()===1&&bkk.getUTCHours()>=0&&bkk.getUTCHours()<2){try{await rest(env,'rpc/facebook_rotation_generate_week',{method:'POST',body:JSON.stringify({target_date:bkk.toISOString().slice(0,10)})})}catch(e){console.error('FACEBOOK ROTATION weekly generation failed',e)}}
 await rest(env,'rpc/facebook_rotation_recover_stale',{method:'POST',body:'{}'});await rest(env,'rpc/facebook_rotation_cancel_sold',{method:'POST',body:'{}'})
 const jobs=await rest(env,'rpc/facebook_rotation_claim_due',{method:'POST',body:JSON.stringify({max_jobs:3})})
 const results:any[]=[]
 for(const job of Array.isArray(jobs)?jobs:[]){try{const out=await publishFacebookRotationPost(env,String(job.product_id),String(job.connection_key),String(job.template_id));const postedAt=new Date().toISOString();await rest(env,'facebook_rotation_queue?id=eq.'+encodeURIComponent(job.id),{method:'PATCH',headers:{prefer:'return=minimal'},body:JSON.stringify({status:'POSTED',post_id:out.postId,posted_at:postedAt,last_error:null,claim_token:null})});await recordFacebookLearning(env,job,out.postId,postedAt);results.push({id:job.id,ok:true,postId:out.postId})}catch(e){const msg=e instanceof Error?e.message:String(e),terminal=msg==='PRODUCT_NOT_PUBLISHABLE';await rest(env,'facebook_rotation_queue?id=eq.'+encodeURIComponent(job.id),{method:'PATCH',headers:{prefer:'return=minimal'},body:JSON.stringify({status:terminal?'SKIPPED_SOLD':'FAILED',last_error:msg.slice(0,1000),next_attempt_at:terminal?null:new Date(Date.now()+15*60*1000).toISOString(),claim_token:null})});results.push({id:job.id,ok:false,error:msg})}}
 try{await collectFacebookLearning(env)}catch(e){console.error('FACEBOOK LEARNING collection failed',e)}
 return results
}

export async function facebookPublishSelected(env:Env,ctx:Ctx,body:any){
 if(!['owner','admin'].includes(ctx.profile.role))throw new Error('ADMIN_ONLY')
 const productId=String(body.productId||''),keys=Array.isArray(body.connectionKeys)?body.connectionKeys.map(String):[]
 if(!productId||!keys.length)throw new Error('PRODUCT_AND_PAGES_REQUIRED')
 const listings=await rest(env,'commerce_public_listing_v?product_id=eq.'+encodeURIComponent(productId)+'&select=product_id,sku,title,status,condition_percent,price,defects,specs,images,slug&limit=1')
 const p=listings?.[0]
 if(!p||!['ready_to_list','published','reserved'].includes(p.status))throw new Error('PRODUCT_NOT_PUBLISHABLE')
 const price=Number(p.price??0),specs=p.specs||{}
 const specLines=[
  specs.cpu&&('CPU: '+specs.cpu), specs.gpu&&('GPU: '+specs.gpu), specs.ram&&('RAM: '+specs.ram),
  specs.ssd&&('SSD: '+specs.ssd), specs.screen_size&&('จอ: '+specs.screen_size+(specs.resolution?' '+specs.resolution:'')),
  specs.battery&&('แบตเตอรี่: '+specs.battery), specs.charger&&('อุปกรณ์: '+specs.charger)
 ].filter(Boolean).slice(0,7)
 const shop='https://shop.amphon.co.th/product/'+encodeURIComponent(String(p.sku))
 const rawTitle=String(p.title||p.sku),brand=rawTitle.trim().split(/\s+/)[0]||''
 const compact=(value:string)=>value.replace(/[^0-9A-Za-zก-๙]/g,'')
 const categoryTag=String(p.sku||'').includes('-NB-')?'โน๊ตบุ๊คมือสอง':'สินค้าไอทีมือสอง'
 const tags=Array.from(new Set([brand&&('#'+compact(brand)),'#'+compact(rawTitle.split(/\s+/).slice(0,2).join('')),'#'+categoryTag,'#สินค้าไอทีมือสอง','#AmphonTrading'].filter(Boolean))).join(' ')
 const message=[
  '🔥 พร้อมส่ง '+rawTitle,
  '',
  ...specLines,
  p.condition_percent?('✅ สภาพประมาณ '+p.condition_percent+'%'):null,
  p.defects?('🔎 ตำหนิ/สภาพ: '+p.defects):null,
  '',
  price?('💰 ราคา '+price.toLocaleString('th-TH')+' บาท'):null,
  '📸 รูปสินค้าจริงทุกภาพ รายละเอียดแจ้งตามสภาพจริง',
  '💬 สนใจเครื่องนี้ ทักข้อความเพจเพื่อสอบถามหรือสั่งซื้อได้เลยครับ',
  '🔗 ดูรายละเอียดเพิ่มเติม: '+shop,
  '',
  tags
 ].filter(x=>x!==null).join('\n')
 const images=(Array.isArray(p.images)?p.images:[]).map((x:any)=>String(x?.url||'')).filter(Boolean).slice(0,10)
 const results:any[]=[]
 for(const key of keys){
  const rs=await rest(env,'sales_channel_connections?channel_key=eq.facebook_page&connection_key=eq.'+encodeURIComponent(key)+'&select=activation_status,external_account_id&limit=1')
  if(rs?.[0]?.activation_status!=='ACTIVE'){results.push({connectionKey:key,ok:false,error:'FACEBOOK_PAGE_NOT_ACTIVE'});continue}
  try{
   const cr=await creds(env,'facebook_page',key);if(!cr.pageAccessToken||!cr.pageId)throw new Error('FACEBOOK_PAGE_TOKEN_MISSING')
   const led=await rest(env,'facebook_post_ledger?product_id=eq.'+encodeURIComponent(productId)+'&connection_key=eq.'+encodeURIComponent(key)+'&select=*&limit=1')
   if(led?.[0]?.status==='LIVE'){results.push({connectionKey:key,ok:true,postId:led[0].post_id,reused:true});continue}
   let j:any
   if(images.length){
    const mediaIds:string[]=[]
    for(const url of images){
     const ur=await fetch('https://graph.facebook.com/v23.0/'+encodeURIComponent(cr.pageId)+'/photos',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({url,published:'false',access_token:cr.pageAccessToken})})
     const uj:any=await ur.json();if(!ur.ok||uj.error||!uj.id)throw new Error('PHOTO_UPLOAD_FAILED:'+(uj.error?.message||ur.status));mediaIds.push(String(uj.id))
    }
    const params=new URLSearchParams({message,access_token:cr.pageAccessToken})
    mediaIds.forEach((id,i)=>params.set('attached_media['+i+']',JSON.stringify({media_fbid:id})))
    const r=await fetch('https://graph.facebook.com/v23.0/'+encodeURIComponent(cr.pageId)+'/feed',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:params})
    j=await r.json();if(!r.ok||j.error||!j.id)throw new Error('FACEBOOK_PUBLISH_FAILED:'+(j.error?.message||r.status))
   }else{
    const r=await fetch('https://graph.facebook.com/v23.0/'+encodeURIComponent(cr.pageId)+'/feed',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({message,link:shop,access_token:cr.pageAccessToken})})
    j=await r.json();if(!r.ok||j.error||!j.id)throw new Error('FACEBOOK_PUBLISH_FAILED:'+(j.error?.message||r.status))
   }
   await rest(env,'facebook_post_ledger',{method:'POST',headers:{prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({product_id:productId,connection_key:key,page_id:String(cr.pageId),post_id:String(j.id),status:'LIVE',external_url:'https://www.facebook.com/'+String(j.id),updated_at:new Date().toISOString(),last_error:null})})
   results.push({connectionKey:key,ok:true,postId:String(j.id),reused:false,imageCount:images.length})
  }catch(e){results.push({connectionKey:key,ok:false,error:e instanceof Error?e.message:String(e)})}
 }
 return {ok:results.some(x=>x.ok),results}
}
export async function facebookSyncProduct(env:Env,ctx:Ctx,body:any){
 if(!['owner','admin'].includes(ctx.profile.role))throw new Error('ADMIN_ONLY');const productId=String(body.productId||'');const ps=await rest(env,'products?id=eq.'+encodeURIComponent(productId)+'&select=id,sku,title,status,price&limit=1');const p=ps?.[0];if(!p)throw new Error('PRODUCT_NOT_FOUND');const rows=await rest(env,'facebook_post_ledger?product_id=eq.'+encodeURIComponent(productId)+'&status=eq.LIVE&select=*');const results:any[]=[]
 for(const x of rows||[]){const cr=await creds(env,'facebook_page',String(x.connection_key));if(!cr.pageAccessToken)continue;if(p.status==='sold'){const msg='ขายแล้ว · '+String(p.title||p.sku);const r=await fetch('https://graph.facebook.com/v23.0/'+encodeURIComponent(x.post_id),{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({message:msg,access_token:cr.pageAccessToken})});const j:any=await r.json();if(!r.ok||j.error)throw new Error('FACEBOOK_SOLD_SYNC_FAILED:'+x.connection_key);await rest(env,'facebook_post_ledger?id=eq.'+x.id,{method:'PATCH',headers:{prefer:'return=minimal'},body:JSON.stringify({status:'SOLD',sold_at:new Date().toISOString(),updated_at:new Date().toISOString(),last_error:null})});results.push({connectionKey:x.connection_key,status:'SOLD'})}else{const price=Number(p.price??0),shop='https://shop.amphon.co.th/product/'+encodeURIComponent(String(p.sku)),msg=String(p.title||p.sku)+(price?'\nราคา '+price.toLocaleString('th-TH')+' บาท':'')+'\nดูสินค้า: '+shop;const r=await fetch('https://graph.facebook.com/v23.0/'+encodeURIComponent(x.post_id),{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({message:msg,access_token:cr.pageAccessToken})});const j:any=await r.json();if(!r.ok||j.error)throw new Error('FACEBOOK_UPDATE_FAILED:'+x.connection_key);await rest(env,'facebook_post_ledger?id=eq.'+x.id,{method:'PATCH',headers:{prefer:'return=minimal'},body:JSON.stringify({updated_at:new Date().toISOString(),last_error:null})});results.push({connectionKey:x.connection_key,status:'UPDATED'})}}
 return {ok:true,results}
}
export async function facebookLedger(env:Env,ctx:Ctx,body:any){if(!['owner','admin'].includes(ctx.profile.role))throw new Error('ADMIN_ONLY');const productId=String(body.productId||'');return {rows:await rest(env,'facebook_post_ledger?product_id=eq.'+encodeURIComponent(productId)+'&select=*&order=updated_at.desc')}}
export async function markTestPublish(env:Env,ctx:Ctx,body:any){
 if(!['owner','admin'].includes(ctx.profile.role))throw new Error('ADMIN_ONLY');const ch=String(body.channelKey||''),key=String(body.connectionKey||''),productId=String(body.productId||'');const rows=await rest(env,'sales_channel_connections?channel_key=eq.'+encodeURIComponent(ch)+'&connection_key=eq.'+encodeURIComponent(key)+'&select=activation_status,environment&limit=1');const x=rows?.[0];if(x?.activation_status!=='VERIFIED')throw new Error('CONNECTION_MUST_BE_VERIFIED_FIRST');if(!productId)throw new Error('TEST_PRODUCT_REQUIRED')
 const products=await rest(env,'products?id=eq.'+encodeURIComponent(productId)+'&select=id,sku,title,status&limit=1');const p=products?.[0];if(!p||!/^TEST[-_]/i.test(p.sku))throw new Error('TEST_SKU_REQUIRED_PREFIX_TEST')
 await rest(env,'sales_channel_jobs',{method:'POST',headers:{prefer:'return=minimal'},body:JSON.stringify({channel_key:ch,action:'PUBLISH',status:'PENDING',product_id:p.id,idempotency_key:'test:'+ch+':'+key+':'+p.id,payload:{connectionKey:key,testMode:true}})})
 return {ok:true,result:{queued:true,sku:p.sku}}
}
