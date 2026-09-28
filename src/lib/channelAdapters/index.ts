import type { ChannelAdapter } from '../centralChannelEngine'
import type { SalesChannelKey } from '../channels'
import { adapterContract } from '../centralChannelEngine'

const adapters=new Map<SalesChannelKey,ChannelAdapter>()
export function registerChannelAdapter(adapter:ChannelAdapter){adapters.set(adapter.channel,adapter)}
export function getChannelAdapter(channel:SalesChannelKey){return adapters.get(channel)??adapterContract(channel)}
export function registeredChannelAdapters(){return [...adapters.keys()]}
