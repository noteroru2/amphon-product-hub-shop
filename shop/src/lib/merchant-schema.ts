import type { StoreProduct, StoreSettings } from './store-api'
import { absoluteUrl } from './seo'

export function merchantItemConditionSchema(product: StoreProduct) {
  switch (String(product.merchantItemCondition || 'USED').toUpperCase()) {
    case 'NEW': return 'https://schema.org/NewCondition'
    case 'REFURBISHED': return 'https://schema.org/RefurbishedCondition'
    default: return 'https://schema.org/UsedCondition'
  }
}

export function merchantAvailabilitySchema(product: StoreProduct) {
  if (product.availability === 'available') return 'https://schema.org/InStock'
  if (product.availability === 'reserved') return 'https://schema.org/OutOfStock'
  return 'https://schema.org/SoldOut'
}

function returnCategory(value: string | null | undefined) {
  if (value === 'FINITE') return 'https://schema.org/MerchantReturnFiniteReturnWindow'
  if (value === 'NOT_PERMITTED') return 'https://schema.org/MerchantReturnNotPermitted'
  if (value === 'UNLIMITED') return 'https://schema.org/MerchantReturnUnlimitedWindow'
  return null
}

function returnMethods(value: string | null | undefined) {
  if (value === 'MAIL') return ['https://schema.org/ReturnByMail']
  if (value === 'IN_STORE') return ['https://schema.org/ReturnInStore']
  if (value === 'MAIL_AND_IN_STORE') return ['https://schema.org/ReturnByMail', 'https://schema.org/ReturnInStore']
  return undefined
}

function returnFees(value: string | null | undefined) {
  if (value === 'FREE') return 'https://schema.org/FreeReturn'
  if (value === 'CUSTOMER_RESPONSIBILITY') return 'https://schema.org/ReturnFeesCustomerResponsibility'
  return undefined
}

export function buildReturnPolicy(settings: StoreSettings | null) {
  if (!settings?.returns.enabled) return undefined
  const category = returnCategory(settings.returns.category)
  // Google supports either a structured country/category policy or a direct
  // merchantReturnLink. Do not invent category/days if the shop only has a
  // real policy URL configured.
  if (!category) {
    return settings.returns.policyUrl
      ? { '@type': 'MerchantReturnPolicy', merchantReturnLink: settings.returns.policyUrl }
      : undefined
  }
  if (settings.returns.category === 'FINITE' && settings.returns.days === null) return undefined
  return {
    '@type': 'MerchantReturnPolicy',
    applicableCountry: settings.countryCode || 'TH',
    returnPolicyCategory: category,
    ...(settings.returns.policyUrl ? { merchantReturnLink: settings.returns.policyUrl } : {}),
    ...(settings.returns.category === 'FINITE' ? { merchantReturnDays: settings.returns.days } : {}),
    ...(returnMethods(settings.returns.method) ? { returnMethod: returnMethods(settings.returns.method) } : {}),
    ...(returnFees(settings.returns.fees) ? { returnFees: returnFees(settings.returns.fees) } : {}),
  }
}

export function buildShippingDetails(settings: StoreSettings | null) {
  if (!settings?.shipping.enabled) return undefined
  const shipping = settings.shipping
  const completeTime = [shipping.handlingMinDays, shipping.handlingMaxDays, shipping.transitMinDays, shipping.transitMaxDays]
    .every((value) => value !== null && Number.isFinite(Number(value)))
  if (!shipping.country || !completeTime || shipping.rate === null || !Number.isFinite(Number(shipping.rate))) return undefined
  return {
    '@type': 'OfferShippingDetails',
    ...(shipping.rate !== null ? {
      shippingRate: { '@type': 'MonetaryAmount', value: shipping.rate, currency: settings.currency || 'THB' },
    } : {}),
    shippingDestination: { '@type': 'DefinedRegion', addressCountry: shipping.country },
    deliveryTime: {
      '@type': 'ShippingDeliveryTime',
      handlingTime: {
        '@type': 'QuantitativeValue', minValue: shipping.handlingMinDays, maxValue: shipping.handlingMaxDays, unitCode: 'DAY',
      },
      transitTime: {
        '@type': 'QuantitativeValue', minValue: shipping.transitMinDays, maxValue: shipping.transitMaxDays, unitCode: 'DAY',
      },
    },
  }
}

export function buildMerchantOrganizationSchema(settings: StoreSettings | null) {
  const returnPolicy = buildReturnPolicy(settings)
  const name = settings?.merchantName || 'AMPHON TRADING'
  return {
    '@context': 'https://schema.org',
    '@type': 'OnlineStore',
    '@id': `${absoluteUrl('/')}#store`,
    name,
    url: settings?.siteUrl || absoluteUrl('/'),
    ...(settings?.legalName ? { legalName: settings.legalName } : {}),
    ...(returnPolicy ? { hasMerchantReturnPolicy: returnPolicy } : {}),
  }
}

export function buildProductMerchantSchema(input: {
  product: StoreProduct
  settings: StoreSettings | null
  canonicalPath: string
  description: string
  specs: Array<[string, string]>
}) {
  const { product, settings, canonicalPath, description, specs } = input
  const shippingDetails = buildShippingDetails(settings)
  const offer = {
    '@type': 'Offer',
    url: absoluteUrl(canonicalPath),
    priceCurrency: settings?.currency || 'THB',
    price: product.price,
    availability: merchantAvailabilitySchema(product),
    itemCondition: merchantItemConditionSchema(product),
    seller: { '@id': `${absoluteUrl('/')}#store` },
    ...(shippingDetails ? { shippingDetails } : {}),
  }

  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    '@id': `${absoluteUrl(canonicalPath)}#product`,
    name: product.title,
    sku: product.sku,
    image: product.images.map((image) => image.url),
    description,
    ...(product.catalogBrand?.name || product.brand ? { brand: { '@type': 'Brand', name: product.catalogBrand?.name || product.brand } } : {}),
    ...(product.mpn ? { mpn: product.mpn } : {}),
    ...(product.gtin ? { gtin: product.gtin } : {}),
    itemCondition: merchantItemConditionSchema(product),
    ...(specs.length ? {
      additionalProperty: specs.slice(0, 24).map(([name, value]) => ({ '@type': 'PropertyValue', name, value })),
    } : {}),
    ...(settings?.purchaseEnabled && product.merchantEnabled ? { offers: offer } : {}),
  }
}
