import type { ChannelAdapter, ChannelAdapterResult, ChannelPublishInput, ChannelListingIdentity } from '../centralChannelEngine'
import type { SalesChannelKey } from '../channels'
import { adapterContract } from '../centralChannelEngine'

export interface HttpChannelAdapterConfig {
 channel: Extract<SalesChannelKey,'lazada'|'tiktok_shop'|'facebook_page'>
 baseUrl:string
 token:()=>Promise<string>
 headers?:(connectionKey:string)=>Promise<Record<string,string>>
}
export function createHttpChannelAdapter(config:HttpChannelAdapterConfig):ChannelAdapter {
 const contract=adapterContract(config.channel)
 async function call(connectionKey:string,action:string,body:unknown):Promise<ChannelAdapterResult>{
  try{
   const token=await config.token()
   const extra=config.headers?await config.headers(connectionKey):{}
   const response=await fetch(`${config.baseUrl.replace(/\/$/,'')}/${encodeURIComponent(connectionKey)}/${action}`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',...extra},body:JSON.stringify(body)})
   const raw=await response.json().catch(()=>({}))
   if(!response.ok) return {ok:false,retryable:response.status===429||response.status>=500,error:String((raw as any)?.error||`HTTP_${response.status}`),raw}
   return {ok:true,externalListingId:(raw as any)?.externalListingId,externalUrl:(raw as any)?.externalUrl,raw}
  }catch(error){return {ok:false,retryable:true,error:String((error as Error)?.message||error)}}
 }
 return {
  ...contract,
  publish:(connectionKey:string,input:ChannelPublishInput)=>call(connectionKey,'publish',input),
  update:(connectionKey:string,listing:ChannelListingIdentity,input:ChannelPublishInput)=>call(connectionKey,'update',{listing,input}),
  syncPrice:(connectionKey:string,listing:ChannelListingIdentity,price:number)=>call(connectionKey,'price',{listing,price}),
  syncStock:(connectionKey:string,listing:ChannelListingIdentity,stock:0|1)=>call(connectionKey,'stock',{listing,stock}),
  end:(connectionKey:string,listing:ChannelListingIdentity)=>call(connectionKey,'end',{listing}),
  pullOrders:(connectionKey:string)=>call(connectionKey,'orders/pull',{}),
 }
}
