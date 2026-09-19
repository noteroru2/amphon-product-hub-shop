export type SalesChannelKey =
  | 'website'
  | 'facebook_page'
  | 'facebook_marketplace'
  | 'shopee'

export type ChannelAdapterMode =
  | 'native'
  | 'assisted'
  | 'direct_api'
  | 'partner_api'
  | 'disabled'

export type ChannelCapability =
  | 'publish'
  | 'update_content'
  | 'update_price'
  | 'project_stock'
  | 'end_listing'
  | 'orders'
  | 'webhooks'

export interface SalesChannelDefinition {
  key: SalesChannelKey
  label: string
  mode: ChannelAdapterMode
  autoPublish: boolean
  capabilities: readonly ChannelCapability[]
  stockAuthority: 'AMPHON_SYSTEM'
  note: string
}

export const salesChannels: readonly SalesChannelDefinition[] = [
  {
    key: 'website',
    label: 'AMPHON SHOP',
    mode: 'native',
    autoPublish: true,
    capabilities: ['publish', 'update_content', 'update_price', 'project_stock', 'end_listing', 'orders'],
    stockAuthority: 'AMPHON_SYSTEM',
    note: 'Native Website adapter; Product Hub publishes to AMPHON SHOP.',
  },
  {
    key: 'facebook_page',
    label: 'Facebook Page',
    mode: 'assisted',
    autoPublish: false,
    capabilities: ['publish', 'update_content', 'update_price', 'end_listing'],
    stockAuthority: 'AMPHON_SYSTEM',
    note: 'Hub prepares content/images; staff performs the external action.',
  },
  {
    key: 'facebook_marketplace',
    label: 'Facebook Marketplace',
    mode: 'assisted',
    autoPublish: false,
    capabilities: ['publish', 'update_content', 'update_price', 'end_listing'],
    stockAuthority: 'AMPHON_SYSTEM',
    note: 'Hub prepares content/images; staff performs the external action.',
  },
  {
    key: 'shopee',
    label: 'Shopee',
    mode: 'disabled',
    autoPublish: false,
    capabilities: [],
    stockAuthority: 'AMPHON_SYSTEM',
    note: 'Adapter is installed but disabled until direct or approved-partner access is available.',
  },
] as const

export function channelDefinition(key: SalesChannelKey) {
  const channel = salesChannels.find((item) => item.key === key)
  if (!channel) throw new Error(`Unknown sales channel: ${key}`)
  return channel
}

export function channelCan(
  channel: Pick<SalesChannelDefinition, 'capabilities'>,
  capability: ChannelCapability,
) {
  return channel.capabilities.includes(capability)
}

export function projectedOneOfOneStock(oneAvailability?: string | null) {
  return oneAvailability === 'IN_STOCK' ? 1 : 0
}

export function channelIsAutomatic(
  channel: Pick<SalesChannelDefinition, 'mode' | 'autoPublish'>,
) {
  return channel.autoPublish
    && (channel.mode === 'native' || channel.mode === 'direct_api' || channel.mode === 'partner_api')
}
