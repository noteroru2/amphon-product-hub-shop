import { supabase } from './supabase'
const apiBase=(import.meta.env.VITE_R2_UPLOAD_API as string|undefined)?.trim().replace(/\/$/,'')
export interface ChannelConnectionAdmin{channelKey:string;connectionKey:string;label:string;externalAccountId?:string|null;status:string;hasCredentials:boolean;lastSyncedAt?:string|null;lastError?:string|null;activationStatus?:string;environment?:string;verifiedAt?:string|null;testPublishAt?:string|null}
async function call<T>(path:string,init:RequestInit={}):Promise<T>{if(!apiBase||!supabase)throw new Error('Backend not configured');const {data}=await supabase.auth.getSession();if(!data.session)throw new Error('Session หมดอายุ');const r=await fetch(apiBase+path,{...init,headers:{authorization:'Bearer '+data.session.access_token,...(init.body?{'content-type':'application/json'}:{}),...(init.headers||{})}});const j=await r.json().catch(()=>({})) as any;if(!r.ok)throw new Error(j.error||('API '+r.status));return j}
export async function listChannelConnections(){return (await call<{connections:ChannelConnectionAdmin[]}>('/commerce/channel-connections')).connections}
export async function saveChannelCredentials(channelKey:string,connectionKey:string,credentials:Record<string,string>){return call('/commerce/channel-connections/credentials',{method:'POST',body:JSON.stringify({channelKey,connectionKey,...credentials})})}
export async function disconnectChannel(channelKey:string,connectionKey:string){return call('/commerce/channel-connections/disconnect',{method:'POST',body:JSON.stringify({channelKey,connectionKey})})}

export async function startChannelAuthorization(channelKey:string,connectionKey:string){return call<{authorizationUrl:string}>('/commerce/channel-connections/authorize',{method:'POST',body:JSON.stringify({channelKey,connectionKey})})}
export async function testChannelConnection(channelKey:string,connectionKey:string){return call<{ok:boolean;identity?:Record<string,unknown>}>('/commerce/channel-connections/test',{method:'POST',body:JSON.stringify({channelKey,connectionKey})})}
export async function testChannelPublish(channelKey:string,connectionKey:string,productId:string){return call<{ok:boolean;result?:unknown}>('/commerce/channel-connections/test-publish',{method:'POST',body:JSON.stringify({channelKey,connectionKey,productId})})}

export async function facebookTestPublish(connectionKey:string){return call<{ok:boolean;postId:string}>('/commerce/channel-connections/facebook-test-publish',{method:'POST',body:JSON.stringify({channelKey:'facebook_page',connectionKey})})}
export async function facebookDeleteTest(connectionKey:string){return call<{ok:boolean}>('/commerce/channel-connections/facebook-test-delete',{method:'POST',body:JSON.stringify({channelKey:'facebook_page',connectionKey})})}
export async function activateChannel(channelKey:string,connectionKey:string){return call<{ok:boolean}>('/commerce/channel-connections/activate',{method:'POST',body:JSON.stringify({channelKey,connectionKey})})}

export interface FacebookPageOption{id:string;name:string}
export async function listFacebookPages(connectionKey:string){return call<{ok:boolean;pages:FacebookPageOption[]}>('/commerce/channel-connections/facebook-pages',{method:'POST',body:JSON.stringify({connectionKey})})}
export async function selectFacebookPage(connectionKey:string,pageId:string){return call<{ok:boolean;page:FacebookPageOption}>('/commerce/channel-connections/facebook-select-page',{method:'POST',body:JSON.stringify({connectionKey,pageId})})}
