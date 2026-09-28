import type { SalesChannelKey, ChannelCapability } from './channels'
import { channelDefinition, channelCan } from './channels'

export type CentralChannelAction = 'PUBLISH'|'UPDATE'|'PRICE_SYNC'|'STOCK_SYNC'|'END'|'ORDER_PULL'|'ORDER_ACK'
export type CentralChannelJobStatus = 'PENDING'|'PROCESSING'|'DONE'|'FAILED'|'DEAD'|'CANCELLED'

export interface ChannelListingIdentity {
  productId:string; channel:SalesChannelKey; connectionKey:string
  externalListingId?:string; externalUrl?:string
}
export interface ChannelPublishInput {
  productId:string; sku:string; title:string; description:string; price:number; stock:0|1
  images:string[]; category?:string; subtype?:string; brand?:string; model?:string
  specs?:Record<string,unknown>
}
export interface ChannelAdapterResult { ok:boolean; retryable?:boolean; externalListingId?:string; externalUrl?:string; raw?:unknown; error?:string }
export interface ChannelAdapter {
  channel:SalesChannelKey
  capability(capability:ChannelCapability):boolean
  publish?(connectionKey:string,input:ChannelPublishInput):Promise<ChannelAdapterResult>
  update?(connectionKey:string,listing:ChannelListingIdentity,input:ChannelPublishInput):Promise<ChannelAdapterResult>
  syncPrice?(connectionKey:string,listing:ChannelListingIdentity,price:number):Promise<ChannelAdapterResult>
  syncStock?(connectionKey:string,listing:ChannelListingIdentity,stock:0|1):Promise<ChannelAdapterResult>
  end?(connectionKey:string,listing:ChannelListingIdentity):Promise<ChannelAdapterResult>
  pullOrders?(connectionKey:string):Promise<ChannelAdapterResult>
}
export function adapterContract(channel:SalesChannelKey):Pick<ChannelAdapter,'channel'|'capability'> {
 const definition=channelDefinition(channel)
 return {channel,capability:(capability)=>channelCan(definition,capability)}
}
export function deterministicChannelJobKey(input:{productId:string;channel:SalesChannelKey;connectionKey?:string;action:CentralChannelAction;revision:string|number}) {
 return [input.productId,input.channel,input.connectionKey||'default',input.action,String(input.revision)].join(':')
}
export function retryDelaySeconds(attempt:number,base=30,cap=1800){ return Math.min(cap,base*(2**Math.min(10,Math.max(0,attempt-1)))) }
