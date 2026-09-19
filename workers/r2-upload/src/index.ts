import { one4SystemStockEnabled, releaseOne4SystemStock, reserveOne4SystemStock, type One4SystemStockEnv } from './one4-system-stock'
import { handleShopeeRoutes, runShopeePublishSweep, type ShopeeEnv } from './shopee'

interface Env extends One4SystemStockEnv, ShopeeEnv {
  IMAGES: R2Bucket
  SUPABASE_URL: string
  SUPABASE_PUBLISHABLE_KEY: string
  SUPABASE_SECRET_KEY: string
  ALLOWED_ORIGINS: string
  TURNSTILE_SECRET_KEY?: string
  STRIPE_SECRET_KEY?: string
  STRIPE_WEBHOOK_SECRET?: string
  SHOP62_TEST_TOKEN?: string
  SHOP62_TEST_MODE?: string
}

type AuthUser = { id: string; email?: string }
type UserRole = 'owner' | 'admin' | 'sales' | 'technician'
type ProfileRow = { id: string; display_name?: string | null; role: UserRole; active: boolean; created_at?: string }
type AdminContext = { user: AuthUser; profile: ProfileRow; authorization: string }

function originFor(request: Request, env: Env) {
  const requestOrigin = request.headers.get('origin') || ''
  const allowed = (env.ALLOWED_ORIGINS || '*').split(',').map((value) => value.trim()).filter(Boolean)
  if (allowed.includes('*')) return '*'
  return allowed.includes(requestOrigin) ? requestOrigin : allowed[0] || ''
}

function corsHeaders(request: Request, env: Env) {
  const origin = originFor(request, env)
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type,x-product-id,x-filename,x-object-key',
    'access-control-max-age': '86400',
    'vary': 'Origin',
  }
}

function json(request: Request, env: Env, data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders(request, env) },
  })
}

function storeCorsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,HEAD,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
  }
}

function storeJson(data: unknown, status = 200, cacheControl = 'public, max-age=30, stale-while-revalidate=120') {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': cacheControl,
      ...storeCorsHeaders(),
    },
  })
}

type StoreImage = { url?: string | null; role?: string | null; isCover?: boolean; sortOrder?: number; width?: number | null; height?: number | null }
type StoreProductRow = {
  sku: string
  source_category: string
  source_subtype?: string | null
  source_brand?: string | null
  source_model?: string | null
  title: string
  status: string
  condition_percent?: number | null
  price?: number | string | null
  warranty_until?: string | null
  defects?: string | null
  specs?: Record<string, unknown> | null
  product_updated_at?: string | null
  published_at?: string | null
  publication_updated_at?: string | null
  images?: StoreImage[] | null
  slug?: string | null
  seo_title?: string | null
  seo_description?: string | null
  index_policy?: string | null
  category_key?: string | null
  category_name_th?: string | null
  category_id?: string | null
  category_slug?: string | null
  catalog_brand_id?: string | null
  catalog_brand_name?: string | null
  catalog_brand_slug?: string | null
  series_id?: string | null
  series_name?: string | null
  series_slug?: string | null
  catalog_model_id?: string | null
  catalog_model_name?: string | null
  catalog_model_code?: string | null
  catalog_model_slug?: string | null
  merchant_enabled?: boolean | null
  google_product_category?: string | null
  gtin?: string | null
  mpn?: string | null
  merchant_item_condition?: string | null
}

function safeStoreText(value: unknown, max = 160) {
  return String(value ?? '').trim().slice(0, max)
}

function publicSpecs(value: Record<string, unknown> | null | undefined) {
  const source = value && typeof value === 'object' ? value : {}
  const blocked = /(serial|imei|cost|purchase|supplier|internal|employee|owner)/i
  return Object.fromEntries(Object.entries(source).filter(([key]) => !blocked.test(key)))
}

function mapStoreProduct(row: StoreProductRow) {
  const price = Number(row.price ?? 0)
  const images = Array.isArray(row.images)
    ? row.images.filter((image) => typeof image?.url === 'string' && image.url).map((image) => ({
        url: String(image.url),
        role: image.role || 'other',
        isCover: Boolean(image.isCover),
        sortOrder: Number(image.sortOrder ?? 0),
        width: image.width ?? null,
        height: image.height ?? null,
      }))
    : []
  return {
    sku: row.sku,
    title: row.title,
    category: row.source_category,
    subtype: row.source_subtype || null,
    brand: row.source_brand || null,
    model: row.source_model || null,
    price: Number.isFinite(price) ? price : 0,
    conditionPercent: row.condition_percent ?? null,
    warrantyUntil: row.warranty_until || null,
    defects: row.defects || null,
    specs: publicSpecs(row.specs),
    status: row.status,
    availability: row.status === 'sold' ? 'out_of_stock' : row.status === 'reserved' ? 'reserved' : 'available',
    images,
    publishedAt: row.published_at || null,
    updatedAt: row.product_updated_at || row.publication_updated_at || null,
    listingSlug: row.slug || null,
    seoTitle: row.seo_title || null,
    seoDescription: row.seo_description || null,
    indexPolicy: row.index_policy || null,
    categoryKey: row.category_key || null,
    categoryName: row.category_name_th || null,
    categoryId: row.category_id || null,
    categorySlug: row.category_slug || null,
    catalogBrand: row.catalog_brand_name && row.catalog_brand_slug
      ? { id: row.catalog_brand_id || null, name: row.catalog_brand_name, slug: row.catalog_brand_slug }
      : null,
    catalogSeries: row.series_name && row.series_slug
      ? { id: row.series_id || null, name: row.series_name, slug: row.series_slug }
      : null,
    catalogModel: row.catalog_model_name && row.catalog_model_slug
      ? { id: row.catalog_model_id || null, name: row.catalog_model_name, code: row.catalog_model_code || null, slug: row.catalog_model_slug }
      : null,
    merchantEnabled: Boolean(row.merchant_enabled),
    merchantItemCondition: row.merchant_item_condition || 'USED',
    googleProductCategory: row.google_product_category || null,
    gtin: row.gtin || null,
    mpn: row.mpn || null,
  }
}

const STORE_PRODUCT_SELECT = [
  'sku',
  'source_category',
  'source_subtype',
  'source_brand',
  'source_model',
  'title',
  'status',
  'condition_percent',
  'price',
  'warranty_until',
  'defects',
  'specs',
  'product_updated_at',
  'published_at',
  'publication_updated_at',
  'images',
  'slug',
  'seo_title',
  'seo_description',
  'index_policy',
  'merchant_enabled',
  'google_product_category',
  'gtin',
  'mpn',
  'merchant_item_condition',
  'category_id',
  'category_key',
  'category_name_th',
  'category_slug',
  'catalog_brand_id',
  'catalog_brand_name',
  'catalog_brand_slug',
  'series_id',
  'series_name',
  'series_slug',
  'catalog_model_id',
  'catalog_model_name',
  'catalog_model_code',
  'catalog_model_slug',
].join(',')

function cleanPostgrestSearch(value: string) {
  // Remove PostgREST expression metacharacters while keeping Thai/Latin search text.
  return value.replace(/[^\p{L}\p{N}\s+\-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
}

async function loadWebsiteProductBySku(env: Env, sku: string): Promise<StoreProductRow | null> {
  const path = `commerce_public_listing_v?select=${STORE_PRODUCT_SELECT}&sku=eq.${encodeURIComponent(sku)}&limit=1`
  const rows = await serviceRest<StoreProductRow[]>(env, path)
  return rows[0] ?? null
}

async function loadWebsiteProductsPage(
  env: Env,
  params: {
    q?: string
    category?: string
    subtype?: string
    availability?: string
    categorySlug?: string
    brandSlug?: string
    seriesSlug?: string
    modelSlug?: string
    limit: number
    offset: number
  },
): Promise<{ rows: StoreProductRow[]; total: number }> {
  const filters: string[] = [
    `select=${STORE_PRODUCT_SELECT}`,
    'order=publication_updated_at.desc',
    `limit=${params.limit}`,
    `offset=${params.offset}`,
  ]

  if (params.category) filters.push(`source_category=eq.${encodeURIComponent(params.category)}`)
  if (params.subtype) filters.push(`source_subtype=eq.${encodeURIComponent(params.subtype)}`)
  if (params.categorySlug) filters.push(`category_slug=eq.${encodeURIComponent(params.categorySlug)}`)
  if (params.brandSlug) filters.push(`catalog_brand_slug=eq.${encodeURIComponent(params.brandSlug)}`)
  if (params.seriesSlug) filters.push(`series_slug=eq.${encodeURIComponent(params.seriesSlug)}`)
  if (params.modelSlug) filters.push(`catalog_model_slug=eq.${encodeURIComponent(params.modelSlug)}`)

  if (!params.availability) filters.push('status=in.(published,reserved)')
  else if (params.availability === 'available') filters.push('status=eq.published')
  else if (params.availability === 'reserved') filters.push('status=eq.reserved')
  else if (params.availability === 'out_of_stock') filters.push('status=eq.sold')
  else if (params.availability !== 'all') filters.push('status=in.(published,reserved)')

  const q = cleanPostgrestSearch(params.q || '')
  if (q) {
    const expression = `(sku.ilike.*${q}*,title.ilike.*${q}*,source_brand.ilike.*${q}*,source_model.ilike.*${q}*)`
    filters.push(`or=${encodeURIComponent(expression)}`)
  }

  return serviceRestWithCount<StoreProductRow[]>(env, `commerce_public_listing_v?${filters.join('&')}`)
}



type StoreSettingsRow = {
  merchant_name: string
  legal_name?: string | null
  site_url: string
  currency: string
  country_code: string
  purchase_enabled: boolean
  shipping_enabled: boolean
  shipping_country?: string | null
  shipping_rate?: number | string | null
  handling_min_days?: number | null
  handling_max_days?: number | null
  transit_min_days?: number | null
  transit_max_days?: number | null
  shipping_policy_url?: string | null
  return_policy_enabled: boolean
  return_policy_category?: string | null
  return_days?: number | null
  return_method?: string | null
  return_fees?: string | null
  return_policy_url?: string | null
  warranty_policy_url?: string | null
  reservation_minutes?: number | null
  bank_transfer_enabled?: boolean | null
  pay_at_store_enabled?: boolean | null
  pickup_enabled?: boolean | null
  checkout_terms_url?: string | null
  checkout_turnstile_enabled?: boolean | null
  turnstile_site_key?: string | null
  bank_name?: string | null
  bank_account_name?: string | null
  bank_account_number?: string | null
  payment_review_hold_hours?: number | null
  stripe_enabled?: boolean | null
  stripe_promptpay_enabled?: boolean | null
  document_mode?: string | null
  invoice_seller_name?: string | null
  invoice_tax_id?: string | null
  invoice_branch_code?: string | null
  invoice_address?: string | null
  invoice_email?: string | null
  default_warranty_days?: number | null
  default_warranty_terms?: string | null
  auto_publish_enabled?: boolean | null
  auto_publish_delay_seconds?: number | null
  updated_at?: string | null
}

function mapStoreSettings(row: StoreSettingsRow) {
  const shippingRate = row.shipping_rate === null || row.shipping_rate === undefined ? null : Number(row.shipping_rate)
  return {
    merchantName: row.merchant_name,
    legalName: row.legal_name || null,
    siteUrl: row.site_url,
    currency: row.currency || 'THB',
    countryCode: row.country_code || 'TH',
    purchaseEnabled: Boolean(row.purchase_enabled),
    autoPublish: {
      enabled: row.auto_publish_enabled === undefined || row.auto_publish_enabled === null
        ? true
        : Boolean(row.auto_publish_enabled),
      delaySeconds: Math.max(60, Math.min(Number(row.auto_publish_delay_seconds || 180), 3600)),
    },
    shipping: {
      enabled: Boolean(row.shipping_enabled),
      country: row.shipping_country || row.country_code || 'TH',
      rate: Number.isFinite(shippingRate) ? shippingRate : null,
      handlingMinDays: row.handling_min_days ?? null,
      handlingMaxDays: row.handling_max_days ?? null,
      transitMinDays: row.transit_min_days ?? null,
      transitMaxDays: row.transit_max_days ?? null,
      policyUrl: row.shipping_policy_url || null,
    },
    returns: {
      enabled: Boolean(row.return_policy_enabled),
      category: row.return_policy_category || null,
      days: row.return_days ?? null,
      method: row.return_method || null,
      fees: row.return_fees || null,
      policyUrl: row.return_policy_url || null,
    },
    warrantyPolicyUrl: row.warranty_policy_url || null,
    warranty: {
      defaultDays: Number(row.default_warranty_days || 0),
    },
    documents: {
      mode: row.document_mode || 'RECEIPT_ONLY',
    },
    checkout: {
      enabled: Boolean(row.purchase_enabled),
      reservationMinutes: Number(row.reservation_minutes || 60),
      bankTransferEnabled: Boolean(row.bank_transfer_enabled),
      stripeEnabled: Boolean(row.stripe_enabled),
      promptPayEnabled: Boolean(row.stripe_promptpay_enabled),
      payAtStoreEnabled: Boolean(row.pay_at_store_enabled),
      pickupEnabled: Boolean(row.pickup_enabled),
      termsUrl: row.checkout_terms_url || null,
      turnstileEnabled: Boolean(row.checkout_turnstile_enabled),
      turnstileSiteKey: row.turnstile_site_key || null,
    },
    updatedAt: row.updated_at || null,
    purchaseActivationLocked: false,
  }
}

function mapAdminStoreSettings(row: StoreSettingsRow) {
  const base = mapStoreSettings(row)
  return {
    ...base,
    checkout: {
      ...base.checkout,
      bankName: row.bank_name || null,
      bankAccountName: row.bank_account_name || null,
      bankAccountNumber: row.bank_account_number || null,
    },
    warranty: {
      ...base.warranty,
      defaultTerms: row.default_warranty_terms || null,
    },
    documents: {
      ...base.documents,
      sellerName: row.invoice_seller_name || null,
      taxId: row.invoice_tax_id || null,
      branchCode: row.invoice_branch_code || null,
      address: row.invoice_address || null,
      email: row.invoice_email || null,
      eTaxIntegrated: false,
    },
  }
}

async function loadStoreSettings(env: Env): Promise<StoreSettingsRow | null> {
  const rows = await serviceRest<StoreSettingsRow[]>(env, 'commerce_public_store_settings_v?select=*&limit=1')
  return rows[0] || null
}

type EvergreenPageRow = {
  page_type: 'BRAND' | 'SERIES' | 'MODEL'
  entity_id: string
  category_id: string
  category_key: string
  category_name: string
  category_slug: string
  brand_id: string
  brand_name: string
  brand_slug: string
  series_id?: string | null
  series_name?: string | null
  series_slug?: string | null
  model_id?: string | null
  model_name?: string | null
  model_code?: string | null
  model_slug?: string | null
  seo_title?: string | null
  seo_description?: string | null
  seo_h1?: string | null
  primary_keyword?: string | null
  intro_content?: string | null
  editorial_content?: string | null
  faq?: Array<{ question?: string; answer?: string }> | null
  index_policy: string
  seo_ready: boolean
  effective_index_policy: string
  canonical_path: string
  current_stock_count: number
  historical_listing_count: number
  updated_at?: string | null
  sort_order?: number | null
}

function mapEvergreenPage(row: EvergreenPageRow) {
  const faq = Array.isArray(row.faq)
    ? row.faq
        .map((item) => ({ question: safeStoreText(item?.question, 220), answer: safeStoreText(item?.answer, 1200) }))
        .filter((item) => item.question && item.answer)
    : []
  return {
    pageType: row.page_type,
    entityId: row.entity_id,
    category: { id: row.category_id, key: row.category_key, name: row.category_name, slug: row.category_slug },
    brand: { id: row.brand_id, name: row.brand_name, slug: row.brand_slug },
    series: row.series_id && row.series_name && row.series_slug
      ? { id: row.series_id, name: row.series_name, slug: row.series_slug }
      : null,
    model: row.model_id && row.model_name && row.model_slug
      ? { id: row.model_id, name: row.model_name, code: row.model_code || null, slug: row.model_slug }
      : null,
    seoTitle: row.seo_title || null,
    seoDescription: row.seo_description || null,
    seoH1: row.seo_h1 || null,
    primaryKeyword: row.primary_keyword || null,
    introContent: row.intro_content || null,
    editorialContent: row.editorial_content || null,
    faq,
    indexPolicy: row.index_policy,
    seoReady: Boolean(row.seo_ready),
    effectiveIndexPolicy: row.effective_index_policy,
    canonicalPath: row.canonical_path,
    currentStockCount: Number(row.current_stock_count || 0),
    historicalListingCount: Number(row.historical_listing_count || 0),
    updatedAt: row.updated_at || null,
    sortOrder: Number(row.sort_order || 100),
  }
}

const EVERGREEN_SELECT = [
  'page_type','entity_id','category_id','category_key','category_name','category_slug',
  'brand_id','brand_name','brand_slug','series_id','series_name','series_slug',
  'model_id','model_name','model_code','model_slug','seo_title','seo_description','seo_h1',
  'primary_keyword','intro_content','editorial_content','faq','index_policy','seo_ready',
  'effective_index_policy','canonical_path','current_stock_count','historical_listing_count',
  'updated_at','sort_order',
].join(',')

async function loadEvergreenPages(
  env: Env,
  params: {
    pageType?: string
    categorySlug?: string
    brandSlug?: string
    seriesSlug?: string
    modelSlug?: string
    effectiveIndexPolicy?: string
    limit: number
    offset: number
  },
): Promise<{ rows: EvergreenPageRow[]; total: number }> {
  const filters = [
    `select=${EVERGREEN_SELECT}`,
    'order=sort_order.asc,canonical_path.asc',
    `limit=${params.limit}`,
    `offset=${params.offset}`,
  ]
  if (params.pageType) filters.push(`page_type=eq.${encodeURIComponent(params.pageType.toUpperCase())}`)
  if (params.categorySlug) filters.push(`category_slug=eq.${encodeURIComponent(params.categorySlug)}`)
  if (params.brandSlug) filters.push(`brand_slug=eq.${encodeURIComponent(params.brandSlug)}`)
  if (params.seriesSlug) filters.push(`series_slug=eq.${encodeURIComponent(params.seriesSlug)}`)
  if (params.modelSlug) filters.push(`model_slug=eq.${encodeURIComponent(params.modelSlug)}`)
  if (params.effectiveIndexPolicy) filters.push(`effective_index_policy=eq.${encodeURIComponent(params.effectiveIndexPolicy.toUpperCase())}`)
  return serviceRestWithCount<EvergreenPageRow[]>(env, `commerce_evergreen_page_v?${filters.join('&')}`)
}

async function resolveEvergreenPage(env: Env, url: URL): Promise<EvergreenPageRow | null> {
  const categorySlug = safeStoreText(url.searchParams.get('category'), 80).toLowerCase()
  const brandSlug = safeStoreText(url.searchParams.get('brand'), 80).toLowerCase()
  const seriesSlug = safeStoreText(url.searchParams.get('series'), 100).toLowerCase()
  const modelSlug = safeStoreText(url.searchParams.get('model'), 120).toLowerCase()
  if (!categorySlug || !brandSlug) return null

  const filters = [
    `select=${EVERGREEN_SELECT}`,
    `category_slug=eq.${encodeURIComponent(categorySlug)}`,
    `brand_slug=eq.${encodeURIComponent(brandSlug)}`,
    'limit=1',
  ]
  if (modelSlug) {
    filters.push('page_type=eq.MODEL', `model_slug=eq.${encodeURIComponent(modelSlug)}`)
    if (seriesSlug) filters.push(`series_slug=eq.${encodeURIComponent(seriesSlug)}`)
  } else if (seriesSlug) {
    filters.push('page_type=eq.SERIES', `series_slug=eq.${encodeURIComponent(seriesSlug)}`)
  } else {
    filters.push('page_type=eq.BRAND')
  }
  const rows = await serviceRest<EvergreenPageRow[]>(env, `commerce_evergreen_page_v?${filters.join('&')}`)
  return rows[0] || null
}


type PublicOrderRow = {
  id: string
  public_token: string
  order_number: string
  order_status: string
  payment_status: string
  fulfillment_status: string
  payment_method: string
  payment_provider?: string | null
  delivery_method: string
  currency: string
  subtotal: number | string
  shipping_amount: number | string
  total: number | string
  reservation_expires_at: string
  payment_reference?: string | null
  payment_notified_at?: string | null
  paid_at?: string | null
  provider_checkout_url?: string | null
  provider_payment_status?: string | null
  refund_status?: string | null
  tracking_carrier?: string | null
  tracking_number?: string | null
  shipped_at?: string | null
  completed_at?: string | null
  created_at: string
}

type PublicOrderItemRow = {
  sku: string
  title: string
  unit_price: number | string
  merchant_item_condition: string
  warranty_days?: number | null
}

type PublicShipmentRow = {
  carrier?: string | null
  tracking_number?: string | null
  tracking_url?: string | null
  status: string
  shipped_at?: string | null
  delivered_at?: string | null
}

type PublicDocumentRow = {
  public_token: string
  document_number: string
  document_type: string
  issued_at: string
}

type PublicWarrantyRow = {
  public_token: string
  certificate_number: string
  sku: string
  title: string
  status: string
  starts_at: string
  ends_at: string
}

function checkoutWriteOriginAllowed(request: Request, settings: StoreSettingsRow | null) {
  const origin = request.headers.get('origin')
  if (!origin) return true
  try {
    const requestUrl = new URL(origin)
    if (requestUrl.hostname === 'localhost' || requestUrl.hostname === '127.0.0.1') return true
    const shop = new URL(settings?.site_url || 'https://shop.amphon.co.th')
    return requestUrl.origin === shop.origin
  } catch {
    return false
  }
}

function cleanCheckoutText(value: unknown, max: number) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max)
}

function validCheckoutEmail(value: string) {
  return !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

async function verifyCheckoutTurnstile(request: Request, env: Env, settings: StoreSettingsRow, token: string, idempotencyKey: string) {
  if (!settings.checkout_turnstile_enabled) return { ok: false, reason: 'TURNSTILE_NOT_CONFIGURED' }
  if (!settings.turnstile_site_key || !env.TURNSTILE_SECRET_KEY) return { ok: false, reason: 'TURNSTILE_SERVER_NOT_CONFIGURED' }
  if (!token || token.length > 2048) return { ok: false, reason: 'TURNSTILE_REQUIRED' }
  const form = new FormData()
  form.set('secret', env.TURNSTILE_SECRET_KEY)
  form.set('response', token)
  const ip = request.headers.get('CF-Connecting-IP')
  if (ip) form.set('remoteip', ip)
  if (/^[0-9a-f-]{36}$/i.test(idempotencyKey)) form.set('idempotency_key', idempotencyKey)
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form })
  if (!response.ok) return { ok: false, reason: 'TURNSTILE_VERIFY_UNAVAILABLE' }
  const result = await response.json().catch(() => ({})) as any
  if (!result?.success) return { ok: false, reason: Array.isArray(result?.['error-codes']) ? result['error-codes'].join(',') : 'TURNSTILE_FAILED' }
  if (result.action && result.action !== 'checkout') return { ok: false, reason: 'TURNSTILE_ACTION_MISMATCH' }
  try {
    const expectedHost = new URL(settings.site_url || 'https://shop.amphon.co.th').hostname
    if (result.hostname && !['localhost','127.0.0.1'].includes(expectedHost) && result.hostname !== expectedHost) {
      return { ok: false, reason: 'TURNSTILE_HOSTNAME_MISMATCH' }
    }
  } catch { return { ok: false, reason: 'STORE_HOSTNAME_INVALID' } }
  return { ok: true, reason: null }
}

async function loadPublicOrder(env: Env, publicToken: string) {
  const token = cleanCheckoutText(publicToken, 64)
  if (!/^[0-9a-f-]{36}$/i.test(token)) return null
  const rows = await serviceRest<PublicOrderRow[]>(env,
    `commerce_orders?public_token=eq.${encodeURIComponent(token)}&select=id,public_token,order_number,order_status,payment_status,fulfillment_status,payment_method,payment_provider,delivery_method,currency,subtotal,shipping_amount,total,reservation_expires_at,payment_reference,payment_notified_at,paid_at,provider_checkout_url,provider_payment_status,refund_status,tracking_carrier,tracking_number,shipped_at,completed_at,created_at&limit=1`)
  const order = rows[0]
  if (!order) return null
  const [items, shipmentRows, documentRows, warranties, settingsRows] = await Promise.all([
    serviceRest<PublicOrderItemRow[]>(env,
      `commerce_order_items?order_id=eq.${encodeURIComponent(order.id)}&select=sku,title,unit_price,merchant_item_condition,warranty_days&order=created_at.asc`),
    serviceRest<PublicShipmentRow[]>(env,
      `commerce_shipments?order_id=eq.${encodeURIComponent(order.id)}&select=carrier,tracking_number,tracking_url,status,shipped_at,delivered_at&limit=1`),
    serviceRest<PublicDocumentRow[]>(env,
      `commerce_documents?order_id=eq.${encodeURIComponent(order.id)}&voided_at=is.null&select=public_token,document_number,document_type,issued_at&order=issued_at.desc&limit=1`),
    serviceRest<PublicWarrantyRow[]>(env,
      `commerce_warranties?order_id=eq.${encodeURIComponent(order.id)}&select=public_token,certificate_number,sku,title,status,starts_at,ends_at&order=created_at.asc`),
    serviceRest<StoreSettingsRow[]>(env, 'commerce_store_settings?id=eq.1&select=*&limit=1'),
  ])
  const settings = settingsRows[0] || null
  const shipment = shipmentRows[0] || null
  const document = documentRows[0] || null
  return {
    orderNumber: order.order_number,
    publicToken: order.public_token,
    orderStatus: order.order_status,
    paymentStatus: order.payment_status,
    fulfillmentStatus: order.fulfillment_status,
    paymentMethod: order.payment_method,
    paymentProvider: order.payment_provider || (order.payment_method === 'STRIPE' ? 'STRIPE' : 'MANUAL'),
    providerPaymentStatus: order.provider_payment_status || null,
    refundStatus: order.refund_status || null,
    deliveryMethod: order.delivery_method,
    currency: order.currency,
    subtotal: Number(order.subtotal || 0),
    shippingAmount: Number(order.shipping_amount || 0),
    total: Number(order.total || 0),
    reservationExpiresAt: order.reservation_expires_at,
    paymentReference: order.payment_reference || null,
    paymentNotifiedAt: order.payment_notified_at || null,
    paidAt: order.paid_at || null,
    paymentUrl: order.payment_status === 'UNPAID' && order.payment_method === 'STRIPE' ? (order.provider_checkout_url || null) : null,
    trackingCarrier: shipment?.carrier || order.tracking_carrier || null,
    trackingNumber: shipment?.tracking_number || order.tracking_number || null,
    trackingUrl: shipment?.tracking_url || null,
    shipmentStatus: shipment?.status || null,
    shippedAt: shipment?.shipped_at || order.shipped_at || null,
    deliveredAt: shipment?.delivered_at || null,
    completedAt: order.completed_at || null,
    createdAt: order.created_at,
    items: items.map((item) => ({
      sku: item.sku,
      title: item.title,
      unitPrice: Number(item.unit_price || 0),
      condition: item.merchant_item_condition || 'USED',
      warrantyDays: Number(item.warranty_days || 0),
    })),
    document: document ? {
      publicToken: document.public_token,
      number: document.document_number,
      type: document.document_type,
      issuedAt: document.issued_at,
    } : null,
    warranties: warranties.map((warranty) => ({
      publicToken: warranty.public_token,
      certificateNumber: warranty.certificate_number,
      sku: warranty.sku,
      title: warranty.title,
      status: warranty.status,
      startsAt: warranty.starts_at,
      endsAt: warranty.ends_at,
    })),
    paymentInstructions: order.payment_status === 'UNPAID' && order.payment_method === 'BANK_TRANSFER' && settings?.bank_transfer_enabled ? {
      bankName: settings.bank_name || '',
      accountName: settings.bank_account_name || '',
      accountNumber: settings.bank_account_number || '',
    } : null,
  }
}


type GatewayOrderRow = {
  id: string
  public_token: string
  order_number: string
  customer_email?: string | null
  currency: string
  subtotal: number | string
  shipping_amount: number | string
  total: number | string
  reservation_expires_at: string
  payment_method: string
}

type GatewayOrderItemRow = {
  sku: string
  title: string
  unit_price: number | string
}

function minorAmount(value: number | string) {
  return Math.round(Number(value || 0) * 100)
}

async function stripeRequest(env: Env, path: string, form: URLSearchParams) {
  if (!env.STRIPE_SECRET_KEY) throw new Error('STRIPE_NOT_CONFIGURED')
  const response = await fetch(`https://api.stripe.com/v1/${path.replace(/^\/+/, '')}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  })
  const body = await response.json().catch(() => ({})) as any
  if (!response.ok) throw new Error(`STRIPE_API:${response.status}:${body?.error?.message || 'Stripe request failed'}`)
  return body
}

async function createStripeCheckoutSession(env: Env, orderId: string, shop62Mode: 'AUTO' | 'CARD' | 'PROMPTPAY' = 'AUTO') {
  const orderRows = await serviceRest<GatewayOrderRow[]>(env,
    `commerce_orders?id=eq.${encodeURIComponent(orderId)}&select=id,public_token,order_number,customer_email,currency,subtotal,shipping_amount,total,reservation_expires_at,payment_method&limit=1`)
  const order = orderRows[0]
  if (!order || order.payment_method !== 'STRIPE') throw new Error('GATEWAY_ORDER_REQUIRED')
  const [items, settingsRows] = await Promise.all([
    serviceRest<GatewayOrderItemRow[]>(env,
      `commerce_order_items?order_id=eq.${encodeURIComponent(order.id)}&select=sku,title,unit_price&order=created_at.asc`),
    serviceRest<StoreSettingsRow[]>(env, 'commerce_store_settings?id=eq.1&select=*&limit=1'),
  ])
  const settings = settingsRows[0]
  if (shop62Mode === 'AUTO' && !settings?.stripe_enabled) throw new Error('STRIPE_NOT_ENABLED')
  if (!settings.site_url) throw new Error('STORE_URL_REQUIRED')
  const base = settings.site_url.replace(/\/$/, '')
  const form = new URLSearchParams()
  form.set('mode', 'payment')
  form.set('success_url', `${base}/order/${encodeURIComponent(order.public_token)}/?payment=success`)
  form.set('cancel_url', `${base}/order/${encodeURIComponent(order.public_token)}/?payment=cancelled`)
  form.set('client_reference_id', order.id)
  form.set('metadata[order_id]', order.id)
  form.set('metadata[order_number]', order.order_number)
  form.set('metadata[public_token]', order.public_token)
  form.set('payment_intent_data[metadata][order_id]', order.id)
  form.set('payment_intent_data[metadata][order_number]', order.order_number)
  if (shop62Mode === 'PROMPTPAY') {
    if (String(order.currency).toUpperCase() !== 'THB') throw new Error('STRIPE_PROMPTPAY_REQUIRES_THB')
    form.set('payment_method_types[0]', 'promptpay')
  } else {
    form.set('payment_method_types[0]', 'card')
    if (shop62Mode === 'AUTO' && settings.stripe_promptpay_enabled && String(order.currency).toUpperCase() === 'THB') {
      form.set('payment_method_types[1]', 'promptpay')
    }
  }
  if (order.customer_email) form.set('customer_email', order.customer_email)
  form.set('locale', 'auto')
  // Stripe must expire before the DB reservation so webhook delivery/reconciliation has a grace window.
  const expiresAt = Math.floor(new Date(order.reservation_expires_at).getTime() / 1000) - (10 * 60)
  const minimum = Math.floor(Date.now() / 1000) + (30 * 60)
  if (!Number.isFinite(expiresAt) || expiresAt < minimum) throw new Error('STRIPE_RESERVATION_WINDOW_INVALID')
  form.set('expires_at', String(expiresAt))

  let index = 0
  for (const item of items) {
    form.set(`line_items[${index}][price_data][currency]`, String(order.currency).toLowerCase())
    form.set(`line_items[${index}][price_data][unit_amount]`, String(minorAmount(item.unit_price)))
    form.set(`line_items[${index}][price_data][product_data][name]`, `${item.title} (${item.sku})`.slice(0, 120))
    form.set(`line_items[${index}][quantity]`, '1')
    index += 1
  }
  const shipping = Number(order.shipping_amount || 0)
  if (shipping > 0) {
    form.set(`line_items[${index}][price_data][currency]`, String(order.currency).toLowerCase())
    form.set(`line_items[${index}][price_data][unit_amount]`, String(minorAmount(shipping)))
    form.set(`line_items[${index}][price_data][product_data][name]`, 'Shipping')
    form.set(`line_items[${index}][quantity]`, '1')
  }

  const session = await stripeRequest(env, 'checkout/sessions', form)
  if (!session?.id || !session?.url) throw new Error('STRIPE_SESSION_INVALID')
  await serviceRest(env, 'rpc/attach_commerce_gateway_checkout', {
    method: 'POST',
    body: JSON.stringify({
      target_order_id: order.id,
      provider_name: 'STRIPE',
      checkout_session_id: session.id,
      checkout_url: session.url,
      provider_payment_id: typeof session.payment_intent === 'string' ? session.payment_intent : null,
    }),
  })
  return { id: String(session.id), url: String(session.url) }
}

async function createStripeFullRefund(env: Env, orderId: string) {
  const rows = await serviceRest<any[]>(env,
    `commerce_orders?id=eq.${encodeURIComponent(orderId)}&select=id,order_number,payment_provider,payment_status,provider_payment_intent_id,total,currency&limit=1`)
  const order = rows[0]
  if (!order) throw new Error('ORDER_NOT_FOUND')
  if (order.payment_provider !== 'STRIPE' || order.payment_status !== 'PAID' || !order.provider_payment_intent_id) {
    throw new Error('GATEWAY_PAID_ORDER_REQUIRED')
  }
  const form = new URLSearchParams()
  form.set('payment_intent', order.provider_payment_intent_id)
  form.set('metadata[order_id]', order.id)
  form.set('metadata[order_number]', order.order_number)
  const refund = await stripeRequest(env, 'refunds', form)
  if (!refund?.id) throw new Error('STRIPE_REFUND_INVALID')
  await serviceRest(env, 'rpc/mark_commerce_gateway_refund_pending', {
    method: 'POST',
    body: JSON.stringify({ target_order_id: order.id, provider_refund_id: refund.id }),
  })
  return { id: String(refund.id), status: String(refund.status || 'pending') }
}

function hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function timingSafeHexEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function verifyStripeSignature(rawBody: string, signatureHeader: string | null, secret: string | undefined) {
  if (!signatureHeader || !secret) return false
  const parts = signatureHeader.split(',').map((part) => part.trim())
  const timestamp = parts.find((part) => part.startsWith('t='))?.slice(2)
  const signatures = parts.filter((part) => part.startsWith('v1=')).map((part) => part.slice(3))
  if (!timestamp || !signatures.length || !/^\d+$/.test(timestamp)) return false
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp))
  if (!Number.isFinite(age) || age > 300) return false
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${rawBody}`))
  const expected = hex(digest)
  return signatures.some((value) => timingSafeHexEqual(value.toLowerCase(), expected))
}

function stripeObjectId(value: unknown) {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && typeof (value as any).id === 'string') return (value as any).id
  return null
}

async function processStripeWebhook(request: Request, env: Env) {
  if (!env.STRIPE_WEBHOOK_SECRET) return new Response('Stripe webhook not configured', { status: 503 })
  const raw = await request.text()
  const valid = await verifyStripeSignature(raw, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET)
  if (!valid) return new Response('Invalid signature', { status: 400 })
  const event = JSON.parse(raw) as any
  const object = event?.data?.object || {}
  const type = String(event?.type || '')
  const metadata = object?.metadata || {}
  const targetOrderId = String(metadata?.order_id || object?.client_reference_id || '') || null
  let normalized: string | null = null
  let providerPaymentId: string | null = null
  let amountMinor: number | null = null
  let currency: string | null = null

  if (type === 'checkout.session.completed') {
    if (object.payment_status !== 'paid') return new Response('ok', { status: 200 })
    normalized = 'PAYMENT_SUCCEEDED'
    providerPaymentId = stripeObjectId(object.payment_intent)
    amountMinor = Number(object.amount_total ?? 0)
    currency = String(object.currency || '').toUpperCase()
  } else if (type === 'checkout.session.async_payment_succeeded') {
    normalized = 'PAYMENT_SUCCEEDED'
    providerPaymentId = stripeObjectId(object.payment_intent)
    amountMinor = Number(object.amount_total ?? 0)
    currency = String(object.currency || '').toUpperCase()
  } else if (type === 'payment_intent.succeeded') {
    normalized = 'PAYMENT_SUCCEEDED'
    providerPaymentId = String(object.id || '')
    amountMinor = Number(object.amount_received ?? object.amount ?? 0)
    currency = String(object.currency || '').toUpperCase()
  } else if (type === 'checkout.session.expired') {
    normalized = 'CHECKOUT_EXPIRED'
    providerPaymentId = stripeObjectId(object.payment_intent)
  } else if (type === 'checkout.session.async_payment_failed' || type === 'payment_intent.payment_failed') {
    normalized = 'PAYMENT_FAILED'
    providerPaymentId = type.startsWith('payment_intent') ? String(object.id || '') : stripeObjectId(object.payment_intent)
  } else if (type === 'refund.updated') {
    providerPaymentId = stripeObjectId(object.payment_intent)
    amountMinor = Number(object.amount ?? 0)
    currency = String(object.currency || '').toUpperCase()
    if (object.status === 'succeeded') normalized = 'REFUND_SUCCEEDED'
    else if (['failed', 'canceled'].includes(String(object.status || ''))) normalized = 'REFUND_FAILED'
  } else if (type === 'charge.refunded' && Number(object.amount_refunded || 0) >= Number(object.amount || 0)) {
    normalized = 'REFUND_SUCCEEDED'
    providerPaymentId = stripeObjectId(object.payment_intent)
    amountMinor = Number(object.amount_refunded ?? 0)
    currency = String(object.currency || '').toUpperCase()
  }

  if (!normalized) return new Response('ok', { status: 200 })

  await serviceRest(env, 'rpc/process_gateway_payment_event', {
    method: 'POST',
    body: JSON.stringify({
      provider_name: 'STRIPE',
      provider_event_id: String(event.id || ''),
      normalized_event: normalized,
      target_order_id: targetOrderId,
      provider_payment_id: providerPaymentId,
      amount_minor: Number.isFinite(amountMinor) ? amountMinor : null,
      currency_code: currency || null,
      event_payload: { stripeType: type, objectId: object?.id || null },
    }),
  })
  return new Response('ok', { status: 200 })
}

async function loadPublicDocument(env: Env, publicToken: string) {
  if (!/^[0-9a-f-]{36}$/i.test(publicToken)) return null
  const rows = await serviceRest<any[]>(env,
    `commerce_documents?public_token=eq.${encodeURIComponent(publicToken)}&voided_at=is.null&select=document_number,document_type,seller_snapshot,customer_snapshot,totals_snapshot,items_snapshot,issued_at&limit=1`)
  const row = rows[0]
  return row ? {
    number: row.document_number,
    type: row.document_type,
    seller: row.seller_snapshot,
    customer: row.customer_snapshot,
    totals: row.totals_snapshot,
    items: row.items_snapshot,
    issuedAt: row.issued_at,
    eTaxIntegrated: false,
  } : null
}

async function loadPublicWarranty(env: Env, publicToken: string) {
  if (!/^[0-9a-f-]{36}$/i.test(publicToken)) return null
  const rows = await serviceRest<any[]>(env,
    `commerce_warranties?public_token=eq.${encodeURIComponent(publicToken)}&select=certificate_number,sku,title,warranty_days,terms,starts_at,ends_at,status&limit=1`)
  const row = rows[0]
  return row ? {
    certificateNumber: row.certificate_number,
    sku: row.sku,
    title: row.title,
    warrantyDays: Number(row.warranty_days || 0),
    terms: row.terms || null,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
  } : null
}


function shop62TestModeEnabled(env: Env) {
  return env.SHOP62_TEST_MODE === 'isolated-e2e'
}

function shop62TokenAllowed(request: Request, env: Env) {
  const expected = env.SHOP62_TEST_TOKEN || ''
  const supplied = request.headers.get('x-shop62-token') || ''
  return expected.length >= 32 && supplied.length === expected.length && timingSafeHexEqual(supplied, expected)
}

async function handleShop62TestRoutes(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith('/__shop62/')) return null
  if (!shop62TestModeEnabled(env) || !env.SHOP62_TEST_TOKEN || !shop62TokenAllowed(request, env)) return new Response('Not found', { status: 404 })
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: storeCorsHeaders() })

  if (request.method === 'GET' && url.pathname === '/__shop62/readiness') {
    const settings = await loadStoreSettings(env)
    return storeJson({
      ok: true,
      capability: 'SHOP62_PROVIDER_E2E',
      contractVersion: 1,
      mode: 'isolated-e2e',
      checkout: 'POST /__shop62/checkout',
      refund: 'POST /__shop62/refund/:orderId',
      tokenVerified: true,
      createsOrder: false,
      purchaseEnabled: Boolean(settings?.purchase_enabled),
      activationBypass: 'ISOLATED_TEST_TOKEN_ONLY',
      turnstile: 'BYPASSED_BY_ISOLATED_TEST_ROUTE',
    }, 200, 'no-store')
  }

  if (request.method === 'POST' && url.pathname === '/__shop62/checkout') {
    const body = await request.json().catch(() => ({})) as any
    const sku = cleanCheckoutText(body.sku, 80).toUpperCase()
    if (!/^AT-TST-/.test(sku)) return storeJson({ error: 'SHOP62 test SKU required' }, 400, 'no-store')
    const deliveryMethod = cleanCheckoutText(body.deliveryMethod || 'SHIPPING', 20).toUpperCase()
    const providerMethod = cleanCheckoutText(body.providerMethod || 'CARD', 20).toUpperCase()
    if (!['CARD','PROMPTPAY'].includes(providerMethod)) return storeJson({ error: 'Invalid SHOP62 provider method' }, 400, 'no-store')

    const payload = {
      idempotencyKey: crypto.randomUUID(),
      skus: [sku],
      customerName: 'SHOP-6.2 E2E',
      customerPhone: '0800000000',
      customerEmail: 'shop62-e2e@example.invalid',
      deliveryMethod,
      paymentMethod: 'STRIPE',
      addressLine: deliveryMethod === 'SHIPPING' ? 'SHOP-6.2 TEST ONLY' : '',
      district: deliveryMethod === 'SHIPPING' ? 'TEST' : '',
      province: deliveryMethod === 'SHIPPING' ? 'Ubon Ratchathani' : '',
      postalCode: deliveryMethod === 'SHIPPING' ? '34000' : '',
      note: 'SHOP-6.2 provider E2E fixture',
    }
    const result = await serviceRest<any>(env, 'rpc/create_commerce_test_order', {
      method: 'POST',
      body: JSON.stringify({ checkout: payload, test_token: env.SHOP62_TEST_TOKEN }),
    })
    const orderId = String(result?.orderId || result?.order_id || '')
    const gateway = await createStripeCheckoutSession(env, orderId, providerMethod as 'CARD' | 'PROMPTPAY')
    return storeJson({
      orderId,
      publicToken: result?.publicToken || result?.public_token || null,
      orderNumber: result?.orderNumber || result?.order_number || null,
      reservationExpiresAt: result?.reservationExpiresAt || result?.reservation_expires_at || null,
      checkoutUrl: gateway.url,
      checkoutSessionId: gateway.id,
      providerMethod,
    }, 201, 'no-store')
  }

  const refundMatch = url.pathname.match(/^\/__shop62\/refund\/([0-9a-fA-F-]{36})$/)
  if (refundMatch && request.method === 'POST') {
    const refund = await createStripeFullRefund(env, refundMatch[1])
    return storeJson({ ok: true, refund }, 200, 'no-store')
  }

  const orderMatch = url.pathname.match(/^\/__shop62\/order\/([0-9a-fA-F-]{36})$/)
  if (orderMatch && request.method === 'GET') {
    const rows = await serviceRest<any[]>(env,
      `commerce_orders?id=eq.${encodeURIComponent(orderMatch[1])}&select=id,public_token,order_number,order_status,payment_status,fulfillment_status,payment_provider,provider_payment_intent_id,provider_payment_status,refund_status,total,currency,delivery_method,reservation_expires_at&limit=1`)
    return rows[0] ? storeJson({ order: rows[0] }, 200, 'no-store') : storeJson({ error: 'Not found' }, 404, 'no-store')
  }

  return storeJson({ error: 'Not found' }, 404, 'no-store')
}

async function createPublicCheckout(request: Request, env: Env) {
  const settings = await loadStoreSettings(env)
  if (!settings?.purchase_enabled) return storeJson({ error: 'Checkout ยังไม่เปิดใช้งาน' }, 503, 'no-store')
  if (!checkoutWriteOriginAllowed(request, settings)) return storeJson({ error: 'Origin not allowed' }, 403, 'no-store')
  const body = await request.json().catch(() => ({})) as any
  const skus = Array.isArray(body.skus)
    ? Array.from(new Set(body.skus.map((value: unknown) => cleanCheckoutText(value, 80).toUpperCase()).filter(Boolean))).slice(0, 10)
    : []
  const customerName = cleanCheckoutText(body.customerName, 120)
  const customerPhone = cleanCheckoutText(body.customerPhone, 30)
  const customerEmail = cleanCheckoutText(body.customerEmail, 180).toLowerCase()
  if (!skus.length) return storeJson({ error: 'ตะกร้าว่าง' }, 400, 'no-store')
  if (customerName.length < 2) return storeJson({ error: 'กรุณาระบุชื่อผู้สั่งซื้อ' }, 400, 'no-store')
  if (customerPhone.replace(/\D/g, '').length < 8) return storeJson({ error: 'กรุณาระบุเบอร์โทรให้ถูกต้อง' }, 400, 'no-store')
  if (!validCheckoutEmail(customerEmail)) return storeJson({ error: 'อีเมลไม่ถูกต้อง' }, 400, 'no-store')
  if (!/^[0-9a-f-]{36}$/i.test(String(body.idempotencyKey || ''))) return storeJson({ error: 'Checkout session ไม่ถูกต้อง กรุณารีโหลดหน้า' }, 400, 'no-store')
  const turnstile = await verifyCheckoutTurnstile(request, env, settings, cleanCheckoutText(body.turnstileToken, 2048), String(body.idempotencyKey || ''))
  if (!turnstile.ok) return storeJson({ error: 'ยืนยันความปลอดภัยไม่สำเร็จ กรุณาลองใหม่', code: turnstile.reason }, 403, 'no-store')
  const payload = {
    idempotencyKey: body.idempotencyKey,
    skus,
    customerName,
    customerPhone,
    customerEmail,
    deliveryMethod: cleanCheckoutText(body.deliveryMethod, 20).toUpperCase(),
    paymentMethod: cleanCheckoutText(body.paymentMethod, 30).toUpperCase(),
    addressLine: cleanCheckoutText(body.addressLine, 250),
    subdistrict: cleanCheckoutText(body.subdistrict, 120),
    district: cleanCheckoutText(body.district, 120),
    province: cleanCheckoutText(body.province, 120),
    postalCode: cleanCheckoutText(body.postalCode, 20),
    note: cleanCheckoutText(body.note, 500),
    invoiceRequested: Boolean(body.invoiceRequested) || ['true','1','yes','on'].includes(String(body.invoiceRequested || '').toLowerCase()),
    invoiceName: cleanCheckoutText(body.invoiceName, 180),
    invoiceTaxId: cleanCheckoutText(body.invoiceTaxId, 20),
    invoiceBranchCode: cleanCheckoutText(body.invoiceBranchCode, 20),
    invoiceAddress: cleanCheckoutText(body.invoiceAddress, 500),
    invoiceEmail: cleanCheckoutText(body.invoiceEmail, 180).toLowerCase(),
  }
  if (!one4SystemStockEnabled(env)) {
    return storeJson({ error: 'ระบบสำรองสินค้ากลางยังไม่เปิดใช้งาน', code: 'ONE4_SYSTEM_STOCK_DISABLED' }, 503, 'no-store')
  }

  const reservationMinutes = Math.min(240, Math.max(1, Number(settings.reservation_minutes || 60)))
  const reservationExpiresAt = new Date(Date.now() + reservationMinutes * 60_000).toISOString()
  let systemReservation
  try {
    systemReservation = await reserveOne4SystemStock(env, {
      checkoutIdempotencyKey: String(payload.idempotencyKey),
      skus,
      expiresAt: reservationExpiresAt,
    })
  } catch (error) {
    console.error('ONE4_SYSTEM_RESERVE_ERROR:', error instanceof Error ? error.message : error)
    return storeJson({ error: 'ระบบสำรองสินค้าไม่พร้อม กรุณาลองใหม่', code: 'ONE4_SYSTEM_STOCK_UNAVAILABLE' }, 503, 'no-store')
  }
  if (!systemReservation.ok || systemReservation.outcome !== 'RESERVED') {
    const unavailable = systemReservation.errorCode === 'ONE4_STOCK_UNAVAILABLE'
      || systemReservation.outcome === 'REJECTED'
      || systemReservation.outcome === 'CONFLICT'
    return storeJson({
      error: unavailable ? 'สินค้าบางรายการถูกจองหรือขายแล้ว กรุณารีเฟรชตะกร้า' : 'ระบบสำรองสินค้าไม่พร้อม กรุณาลองใหม่',
      code: systemReservation.errorCode || 'ONE4_RESERVATION_REJECTED',
    }, unavailable ? 409 : 503, 'no-store')
  }

  let result: any
  try {
    result = await serviceRest<any>(env, 'rpc/one4_create_commerce_order', {
      method: 'POST',
      body: JSON.stringify({ checkout: payload, system_reservation: systemReservation }),
    })
  } catch (error) {
    await releaseOne4SystemStock(env, {
      checkoutIdempotencyKey: String(payload.idempotencyKey),
      skus,
      reason: 'SHOP_ORDER_CREATE_FAILED',
    }).catch((releaseError) => console.error('ONE4_SYSTEM_RELEASE_AFTER_ORDER_ERROR:', releaseError))
    throw error
  }

  if (payload.paymentMethod === 'STRIPE') {
    try {
      const gateway = await createStripeCheckoutSession(env, String(result?.orderId || result?.order_id || ''))
      result.checkoutUrl = gateway.url
    } catch (error) {
      const orderId = String(result?.orderId || result?.order_id || '')
      if (orderId) {
        await serviceRest(env, 'rpc/cancel_commerce_gateway_order', {
          method: 'POST',
          body: JSON.stringify({
            target_order_id: orderId,
            reason: error instanceof Error ? error.message.slice(0, 280) : 'Stripe Checkout create failed',
          }),
        }).catch(() => undefined)
      }
      await releaseOne4SystemStock(env, {
        checkoutIdempotencyKey: String(payload.idempotencyKey),
        skus,
        reason: 'STRIPE_SESSION_CREATE_FAILED',
      }).catch((releaseError) => console.error('ONE4_SYSTEM_RELEASE_AFTER_STRIPE_ERROR:', releaseError))
      throw error
    }
  }

  const token = String(result?.publicToken || result?.public_token || '')
  const order = token ? await loadPublicOrder(env, token) : null
  return storeJson({ order: order || result, checkoutUrl: result?.checkoutUrl || null }, 201, 'no-store')
}

async function notifyPublicOrderPayment(request: Request, env: Env, publicToken: string) {
  const settings = await loadStoreSettings(env)
  if (!checkoutWriteOriginAllowed(request, settings)) return storeJson({ error: 'Origin not allowed' }, 403, 'no-store')
  const body = await request.json().catch(() => ({})) as any
  await serviceRest(env, 'rpc/notify_commerce_payment', {
    method: 'POST',
    body: JSON.stringify({
      target_public_token: publicToken,
      payment_reference_value: cleanCheckoutText(body.paymentReference, 180) || null,
    }),
  })
  const order = await loadPublicOrder(env, publicToken)
  if (!order) return storeJson({ error: 'ไม่พบคำสั่งซื้อ' }, 404, 'no-store')
  return storeJson({ order }, 200, 'no-store')
}

async function handleStoreRoutes(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith('/store')) return null
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: storeCorsHeaders() })

  if (request.method === 'POST' && url.pathname === '/store/checkout') {
    return createPublicCheckout(request, env)
  }

  const orderMatch = url.pathname.match(/^\/store\/orders\/([0-9a-fA-F-]{36})(?:\/(payment-notify))?$/)
  if (orderMatch) {
    const publicToken = orderMatch[1]
    const action = orderMatch[2]
    if (request.method === 'GET' && !action) {
      const order = await loadPublicOrder(env, publicToken)
      return order ? storeJson({ order }, 200, 'no-store') : storeJson({ error: 'ไม่พบคำสั่งซื้อ' }, 404, 'no-store')
    }
    if (request.method === 'POST' && action === 'payment-notify') {
      return notifyPublicOrderPayment(request, env, publicToken)
    }
    return storeJson({ error: 'Method not allowed' }, 405, 'no-store')
  }

  const documentMatch = url.pathname.match(/^\/store\/documents\/([0-9a-fA-F-]{36})$/)
  if (documentMatch && request.method === 'GET') {
    const document = await loadPublicDocument(env, documentMatch[1])
    return document ? storeJson({ document }, 200, 'no-store') : storeJson({ error: 'ไม่พบเอกสาร' }, 404, 'no-store')
  }

  const warrantyMatch = url.pathname.match(/^\/store\/warranties\/([0-9a-fA-F-]{36})$/)
  if (warrantyMatch && request.method === 'GET') {
    const warranty = await loadPublicWarranty(env, warrantyMatch[1])
    return warranty ? storeJson({ warranty }, 200, 'no-store') : storeJson({ error: 'ไม่พบข้อมูลประกัน' }, 404, 'no-store')
  }

  if (!['GET', 'HEAD'].includes(request.method)) return storeJson({ error: 'Method not allowed' }, 405, 'no-store')

  if (url.pathname === '/store/health') {
    return storeJson({ ok: true, service: 'amphon-store-api', version: 6, checkout: true, atomicReservation: true, stripeWebhook: true, fulfillment: true }, 200, 'no-store')
  }


  if (url.pathname === '/store/settings') {
    const settings = await loadStoreSettings(env)
    if (!settings) return storeJson({ error: 'Store settings not found' }, 404, 'public, max-age=60, stale-while-revalidate=300')
    return storeJson({ settings: mapStoreSettings(settings) }, 200, 'public, max-age=300, stale-while-revalidate=1800')
  }

  if (url.pathname === '/store/seo-pages/resolve') {
    const found = await resolveEvergreenPage(env, url)
    if (!found) return storeJson({ error: 'SEO page not found' }, 404, 'public, max-age=60, stale-while-revalidate=300')
    return storeJson({ page: mapEvergreenPage(found) }, 200, 'public, max-age=60, stale-while-revalidate=300')
  }

  if (url.pathname === '/store/seo-pages') {
    const pageType = safeStoreText(url.searchParams.get('pageType'), 16)
    const categorySlug = safeStoreText(url.searchParams.get('category'), 80).toLowerCase()
    const brandSlug = safeStoreText(url.searchParams.get('brand'), 80).toLowerCase()
    const seriesSlug = safeStoreText(url.searchParams.get('series'), 100).toLowerCase()
    const modelSlug = safeStoreText(url.searchParams.get('model'), 120).toLowerCase()
    const effectiveIndexPolicy = safeStoreText(url.searchParams.get('effectiveIndexPolicy'), 16)
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 50) || 50, 1), 200)
    const offset = Math.max(Number(url.searchParams.get('offset') || 0) || 0, 0)
    const page = await loadEvergreenPages(env, { pageType, categorySlug, brandSlug, seriesSlug, modelSlug, effectiveIndexPolicy, limit, offset })
    const pages = page.rows.map(mapEvergreenPage)
    return storeJson({ pages, pagination: { total: page.total, limit, offset, hasMore: offset + pages.length < page.total } }, 200, 'public, max-age=60, stale-while-revalidate=300')
  }

  const detailMatch = url.pathname.match(/^\/store\/products\/([^/]+)$/)
  if (detailMatch) {
    const requestedSku = decodeURIComponent(detailMatch[1]).trim().toUpperCase()
    const found = await loadWebsiteProductBySku(env, requestedSku)
    if (!found) return storeJson({ error: 'Product not found' }, 404, 'public, max-age=15, stale-while-revalidate=60')
    return storeJson({ product: mapStoreProduct(found) }, 200, 'public, max-age=15, stale-while-revalidate=60')
  }

  if (url.pathname === '/store/products') {
    const q = safeStoreText(url.searchParams.get('q'), 80).toLowerCase()
    const category = safeStoreText(url.searchParams.get('category'), 40).toLowerCase()
    const subtype = safeStoreText(url.searchParams.get('subtype'), 80).toLowerCase()
    const availability = safeStoreText(url.searchParams.get('availability'), 20).toLowerCase()
    const categorySlug = safeStoreText(url.searchParams.get('categorySlug'), 80).toLowerCase()
    const brandSlug = safeStoreText(url.searchParams.get('brandSlug'), 80).toLowerCase()
    const seriesSlug = safeStoreText(url.searchParams.get('seriesSlug'), 100).toLowerCase()
    const modelSlug = safeStoreText(url.searchParams.get('modelSlug'), 120).toLowerCase()
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 24) || 24, 1), 100)
    const offset = Math.max(Number(url.searchParams.get('offset') || 0) || 0, 0)

    const page = await loadWebsiteProductsPage(env, { q, category, subtype, availability, categorySlug, brandSlug, seriesSlug, modelSlug, limit, offset })
    const products = page.rows.map(mapStoreProduct)
    return storeJson({
      products,
      pagination: { total: page.total, limit, offset, hasMore: offset + products.length < page.total },
    })
  }

  return storeJson({ error: 'Not found' }, 404, 'no-store')
}

async function authenticate(request: Request, env: Env): Promise<{ user: AuthUser; authorization: string }> {
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) throw new Error('UNAUTHORIZED')
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/user`, {
    headers: { authorization, apikey: env.SUPABASE_PUBLISHABLE_KEY },
  })
  if (!response.ok) throw new Error('UNAUTHORIZED')
  return { user: await response.json() as AuthUser, authorization }
}

function serviceHeaders(env: Env, extra: Record<string, string> = {}) {
  return {
    apikey: env.SUPABASE_SECRET_KEY,
    ...extra,
  }
}

async function serviceRest<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
    ...init,
    headers: {
      ...serviceHeaders(env, { accept: 'application/json' }),
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  })
  if (!response.ok) {
    const message = await response.text().catch(() => '')
    throw new Error(`SERVICE_REST:${response.status}:${message}`)
  }
  if (response.status === 204) return undefined as T
  const text = await response.text()
  return (text ? JSON.parse(text) : undefined) as T
}

async function serviceRestWithCount<T extends unknown[]>(
  env: Env,
  path: string,
  init: RequestInit = {},
): Promise<{ rows: T; total: number }> {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
    ...init,
    headers: {
      ...serviceHeaders(env, { accept: 'application/json', prefer: 'count=exact' }),
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  })
  if (!response.ok) {
    const message = await response.text().catch(() => '')
    throw new Error(`SERVICE_REST_COUNT:${response.status}:${message}`)
  }
  const text = await response.text()
  const rows = (text ? JSON.parse(text) : []) as T
  const contentRange = response.headers.get('content-range') || ''
  const totalRaw = contentRange.split('/')[1]
  const total = totalRaw && totalRaw !== '*' ? Number(totalRaw) : rows.length
  return { rows, total: Number.isFinite(total) ? total : rows.length }
}

async function authAdmin<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/admin/${path}`, {
    ...init,
    headers: {
      ...serviceHeaders(env, { accept: 'application/json' }),
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  })
  if (!response.ok) {
    const raw = await response.text().catch(() => '')
    let message = raw
    try {
      const parsed = JSON.parse(raw) as { msg?: string; message?: string; error_description?: string }
      message = parsed.msg || parsed.message || parsed.error_description || raw
    } catch { /* keep raw */ }
    throw new Error(`AUTH_ADMIN:${response.status}:${message}`)
  }
  if (response.status === 204) return undefined as T
  const text = await response.text()
  return (text ? JSON.parse(text) : undefined) as T
}

async function loadProfileWithSecret(env: Env, userId: string): Promise<ProfileRow | null> {
  const rows = await serviceRest<ProfileRow[]>(env, `profiles?id=eq.${encodeURIComponent(userId)}&select=id,display_name,role,active,created_at&limit=1`)
  return rows[0] ?? null
}

async function assertEmployeeAdmin(request: Request, env: Env): Promise<AdminContext> {
  const auth = await authenticate(request, env)
  const profile = await loadProfileWithSecret(env, auth.user.id)
  if (!profile?.active || !['owner', 'admin'].includes(profile.role)) throw new Error('ADMIN_ACCESS_DENIED')
  return { ...auth, profile }
}

function normalizeRole(value: unknown): UserRole | null {
  return ['owner', 'admin', 'sales', 'technician'].includes(String(value)) ? String(value) as UserRole : null
}

function cleanDisplayName(value: unknown) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 80)
}

function cleanEmail(value: unknown) {
  return String(value ?? '').trim().toLowerCase().slice(0, 254)
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function generateTemporaryPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(14))
  let middle = ''
  for (const byte of bytes) middle += chars[byte % chars.length]
  return `At!${middle}9#`
}

async function assertCanManageTarget(env: Env, actor: ProfileRow, actorId: string, target: ProfileRow, nextRole?: UserRole, nextActive?: boolean) {
  if (actorId === target.id && (nextRole !== undefined || nextActive !== undefined)) throw new Error('CANNOT_CHANGE_OWN_ACCESS')
  if (actor.role === 'admin' && ['owner', 'admin'].includes(target.role)) throw new Error('ADMIN_CANNOT_MANAGE_PRIVILEGED')
  if (actor.role === 'admin' && nextRole && !['sales', 'technician'].includes(nextRole)) throw new Error('ADMIN_CANNOT_GRANT_PRIVILEGED')

  const wouldRemoveActiveOwner = target.role === 'owner' && target.active && ((nextRole !== undefined && nextRole !== 'owner') || nextActive === false)
  if (wouldRemoveActiveOwner) {
    const owners = await serviceRest<Array<{ id: string }>>(env, 'profiles?role=eq.owner&active=eq.true&select=id')
    if (owners.length <= 1) throw new Error('LAST_OWNER_REQUIRED')
  }
}

async function logEmployeeAction(env: Env, actorId: string, targetUserId: string | null, action: string, metadata: Record<string, unknown> = {}) {
  await serviceRest(env, 'employee_activity_logs', {
    method: 'POST',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify({ actor_id: actorId, target_user_id: targetUserId, action, metadata }),
  })
}

async function listEmployees(env: Env) {
  const [authRaw, profiles] = await Promise.all([
    authAdmin<any>(env, 'users?page=1&per_page=200'),
    serviceRest<ProfileRow[]>(env, 'profiles?select=id,display_name,role,active,created_at&order=created_at.asc'),
  ])
  const authUsers: any[] = Array.isArray(authRaw) ? authRaw : Array.isArray(authRaw?.users) ? authRaw.users : []
  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]))
  return authUsers.map((user) => {
    const profile = profileMap.get(String(user.id))
    return {
      id: String(user.id),
      email: String(user.email || ''),
      displayName: String(profile?.display_name || user.user_metadata?.display_name || user.email?.split('@')[0] || 'พนักงาน'),
      role: profile?.role || 'sales',
      active: profile?.active ?? true,
      createdAt: String(user.created_at || profile?.created_at || ''),
      lastSignInAt: user.last_sign_in_at ? String(user.last_sign_in_at) : null,
    }
  })
}

async function listEmployeeActivity(env: Env) {
  const logs = await serviceRest<any[]>(env, 'employee_activity_logs?select=id,actor_id,target_user_id,action,metadata,created_at&order=created_at.desc&limit=50')
  const ids = Array.from(new Set(logs.flatMap((row) => [row.actor_id, row.target_user_id]).filter(Boolean)))
  const names = new Map<string, string>()
  if (ids.length) {
    const encoded = ids.map((id) => String(id)).join(',')
    const profiles = await serviceRest<ProfileRow[]>(env, `profiles?id=in.(${encoded})&select=id,display_name,role,active`)
    for (const profile of profiles) names.set(profile.id, profile.display_name || 'พนักงาน')
  }
  return logs.map((row) => ({
    id: Number(row.id),
    action: String(row.action),
    actorId: row.actor_id || null,
    actorName: row.actor_id ? names.get(String(row.actor_id)) || 'พนักงาน' : 'ระบบ',
    targetUserId: row.target_user_id || null,
    targetName: row.target_user_id ? names.get(String(row.target_user_id)) || 'พนักงาน' : undefined,
    metadata: row.metadata || {},
    createdAt: row.created_at,
  }))
}



// ------------------------------------------------------------
// SHOP-4 AUTHENTICATED COMMERCE ADMIN API
// ------------------------------------------------------------

type CommerceContext = { user: AuthUser; profile: ProfileRow; authorization: string }

type CommerceEditorRow = {
  product_id: string
  sku: string
  title: string
  product_status: string
  listing_id: string
  slug: string
  canonical_path: string
  category_id?: string | null
  category_name?: string | null
  brand_id?: string | null
  brand_name?: string | null
  series_id?: string | null
  series_name?: string | null
  model_id?: string | null
  model_name?: string | null
  seo_title?: string | null
  seo_description?: string | null
  index_policy: string
  merchant_enabled: boolean
  merchant_item_condition: string
  google_product_category?: string | null
  gtin?: string | null
  mpn?: string | null
  store_warranty_days?: number | null
  store_warranty_terms?: string | null
  website_status?: string | null
  data_ready: boolean
  merchant_activation_ready: boolean
  blockers?: string[] | null
  updated_at?: string | null
}

async function userRest<T>(env: Env, authorization: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      authorization,
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  })
  if (!response.ok) {
    const message = await response.text().catch(() => '')
    throw new Error(`USER_REST:${response.status}:${message}`)
  }
  if (response.status === 204) return undefined as T
  const text = await response.text()
  return (text ? JSON.parse(text) : undefined) as T
}

async function assertCommerceStaff(request: Request, env: Env): Promise<CommerceContext> {
  const auth = await authenticate(request, env)
  const profile = await loadProfileWithSecret(env, auth.user.id)
  if (!profile?.active) throw new Error('COMMERCE_ACCESS_DENIED')
  return { ...auth, profile }
}

function cleanNullableText(value: unknown, max: number) {
  const cleaned = String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max)
  return cleaned || null
}

function cleanUrl(value: unknown) {
  const cleaned = String(value ?? '').trim()
  if (!cleaned) return null
  try {
    const url = new URL(cleaned)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('invalid')
    return url.toString().replace(/\/$/, '')
  } catch {
    throw new Error('INVALID_URL')
  }
}

function cleanUuidOrNull(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const text = String(value)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) throw new Error('INVALID_UUID')
  return text
}

function slugifyCommerce(value: unknown) {
  const source = String(value ?? '').trim()
  const slug = source
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
    .toLowerCase()
  return slug || `item-${crypto.randomUUID().slice(0, 8)}`
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) throw new Error('INVALID_NUMBER')
  return number
}

function validGtinChecksum(raw: string) {
  const gtin = raw.replace(/\s+/g, '')
  if (!gtin) return true
  if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(gtin)) return false
  const digits = gtin.split('').map(Number)
  const check = digits.pop()!
  let sum = 0
  for (let i = digits.length - 1, pos = 0; i >= 0; i--, pos++) sum += digits[i] * (pos % 2 === 0 ? 3 : 1)
  return (10 - (sum % 10)) % 10 === check
}

function mapCommerceEditor(row: CommerceEditorRow, siteUrl: string) {
  const origin = siteUrl.replace(/\/$/, '')
  return {
    configured: true,
    productId: row.product_id,
    sku: row.sku,
    title: row.title,
    listingId: row.listing_id,
    slug: row.slug,
    canonicalPath: row.canonical_path,
    canonicalUrl: `${origin}${row.canonical_path}`,
    categoryId: row.category_id || null,
    brandId: row.brand_id || null,
    seriesId: row.series_id || null,
    modelId: row.model_id || null,
    categoryName: row.category_name || null,
    brandName: row.brand_name || null,
    seriesName: row.series_name || null,
    modelName: row.model_name || null,
    seoTitle: row.seo_title || null,
    seoDescription: row.seo_description || null,
    indexPolicy: row.index_policy || 'HOLD',
    merchantEnabled: Boolean(row.merchant_enabled),
    merchantItemCondition: row.merchant_item_condition || 'USED',
    googleProductCategory: row.google_product_category || null,
    gtin: row.gtin || null,
    mpn: row.mpn || null,
    storeWarrantyDays: row.store_warranty_days ?? null,
    storeWarrantyTerms: row.store_warranty_terms || null,
    websiteStatus: row.website_status || 'not_published',
    dataReady: Boolean(row.data_ready),
    merchantActivationReady: Boolean(row.merchant_activation_ready),
    blockers: Array.isArray(row.blockers) ? row.blockers : [],
    updatedAt: row.updated_at || null,
  }
}

async function loadCommerceEditor(env: Env, authorization: string, productId: string) {
  const rows = await userRest<CommerceEditorRow[]>(env, authorization,
    `commerce_listing_editor_v?product_id=eq.${encodeURIComponent(productId)}&select=*&limit=1`)
  return rows[0] || null
}

async function loadCommerceProductStub(env: Env, authorization: string, productId: string) {
  const rows = await userRest<Array<{ id: string; sku: string; title: string }>>(env, authorization,
    `products?id=eq.${encodeURIComponent(productId)}&select=id,sku,title&limit=1`)
  return rows[0] || null
}

async function commerceSettingsForStaff(env: Env, authorization: string): Promise<StoreSettingsRow | null> {
  const rows = await userRest<StoreSettingsRow[]>(env, authorization, 'commerce_store_settings?id=eq.1&select=*&limit=1')
  return rows[0] || null
}

async function commerceResponseForProduct(env: Env, context: CommerceContext, productId: string) {
  const [editor, settings] = await Promise.all([
    loadCommerceEditor(env, context.authorization, productId),
    commerceSettingsForStaff(env, context.authorization),
  ])
  if (editor) return mapCommerceEditor(editor, settings?.site_url || 'https://shop.amphon.co.th')
  const product = await loadCommerceProductStub(env, context.authorization, productId)
  if (!product) throw new Error('PRODUCT_NOT_FOUND')
  return {
    configured: false,
    productId: product.id,
    sku: product.sku,
    title: product.title,
    indexPolicy: 'HOLD',
    merchantEnabled: false,
    merchantItemCondition: 'USED',
    dataReady: false,
    merchantActivationReady: false,
    blockers: ['COMMERCE_NOT_PREPARED'],
  }
}

async function logCommerceProductAction(env: Env, actorId: string, productId: string, action: string, metadata: Record<string, unknown> = {}) {
  await serviceRest(env, 'activity_logs', {
    method: 'POST',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify({ actor_id: actorId, product_id: productId, action, metadata }),
  })
}

async function handleCommerceRoutes(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith('/commerce')) return null
  const context = await assertCommerceStaff(request, env)

  if (url.pathname === '/commerce/orders' && request.method === 'GET') {
    if (!['owner','admin','sales'].includes(context.profile.role)) return json(request, env, { error: 'ไม่มีสิทธิ์ดูคำสั่งซื้อ' }, 403)
    const status = cleanCheckoutText(url.searchParams.get('status'), 32).toUpperCase()
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 50) || 50, 1), 100)
    const filters = [`select=*`, `order=created_at.desc`, `limit=${limit}`]
    if (status && status !== 'ALL') filters.push(`order_status=eq.${encodeURIComponent(status)}`)
    const rows = await serviceRest<any[]>(env, `commerce_order_admin_v?${filters.join('&')}`)
    return json(request, env, { orders: rows.map((row) => ({
      id: row.id, orderNumber: row.order_number, orderStatus: row.order_status, paymentStatus: row.payment_status,
      fulfillmentStatus: row.fulfillment_status, paymentMethod: row.payment_method, paymentProvider: row.payment_provider || 'MANUAL', deliveryMethod: row.delivery_method,
      customerName: row.customer_name, customerPhone: row.customer_phone, customerEmail: row.customer_email,
      addressLine: row.address_line, subdistrict: row.subdistrict, district: row.district, province: row.province, postalCode: row.postal_code,
      customerNote: row.customer_note, currency: row.currency, subtotal: Number(row.subtotal || 0),
      shippingAmount: Number(row.shipping_amount || 0), total: Number(row.total || 0),
      reservationExpiresAt: row.reservation_expires_at, paymentReference: row.payment_reference,
      paymentNotifiedAt: row.payment_notified_at, paidAt: row.paid_at,
      trackingCarrier: row.tracking_carrier, trackingNumber: row.tracking_number, trackingUrl: row.tracking_url || null,
      shipmentStatus: row.shipment_status || null, providerPaymentStatus: row.provider_payment_status || null,
      providerPaymentIntentId: row.provider_payment_intent_id || null, refundStatus: row.refund_status || null,
      shippedAt: row.shipped_at, deliveredAt: row.delivered_at || null, completedAt: row.completed_at, createdAt: row.created_at, updatedAt: row.updated_at,
      document: row.document || null, warranties: Array.isArray(row.warranties) ? row.warranties : [],
      items: Array.isArray(row.items) ? row.items : [],
    })) })
  }

  const orderActionMatch = url.pathname.match(/^\/commerce\/orders\/([0-9a-fA-F-]{36})\/actions$/)
  if (orderActionMatch && request.method === 'POST') {
    if (!['owner','admin','sales'].includes(context.profile.role)) return json(request, env, { error: 'ไม่มีสิทธิ์จัดการคำสั่งซื้อ' }, 403)
    const body = await request.json().catch(() => ({})) as any
    const action = cleanCheckoutText(body.action, 40).toUpperCase()
    if (action === 'REFUND' && !['owner','admin'].includes(context.profile.role)) return json(request, env, { error: 'Owner/Admin เท่านั้นที่ทำ Refund ได้' }, 403)
    const allowed = ['CONFIRM_PAYMENT','CANCEL','MARK_PACKING','MARK_SHIPPED','MARK_IN_TRANSIT','MARK_DELIVERED','MARK_PICKUP_READY','COMPLETE','REFUND','OPEN_WARRANTY_CLAIM']
    if (!allowed.includes(action)) return json(request, env, { error: 'Order action ไม่ถูกต้อง' }, 400)

    if (action === 'REFUND') {
      const rows = await serviceRest<any[]>(env, `commerce_orders?id=eq.${encodeURIComponent(orderActionMatch[1])}&select=id,payment_provider,payment_status&limit=1`)
      const order = rows[0]
      if (!order) return json(request, env, { error: 'ไม่พบ Order' }, 404)
      if (order.payment_provider === 'STRIPE') {
        const refund = await createStripeFullRefund(env, order.id)
        return json(request, env, { result: { refundPending: true, provider: 'STRIPE', refund } })
      }
    }

    const result = await serviceRest<any>(env, 'rpc/admin_commerce_order_action', {
      method: 'POST',
      body: JSON.stringify({
        target_order_id: orderActionMatch[1],
        action_name: action,
        actor_id: context.user.id,
        action_data: {
          trackingCarrier: cleanCheckoutText(body.trackingCarrier, 100),
          trackingNumber: cleanCheckoutText(body.trackingNumber, 120),
          trackingUrl: cleanUrl(body.trackingUrl),
          warrantyId: cleanUuidOrNull(body.warrantyId),
          issue: cleanCheckoutText(body.issue, 1000),
        },
      }),
    })
    return json(request, env, { result })
  }

  if (request.method === 'GET' && url.pathname === '/commerce/settings') {
    const row = await commerceSettingsForStaff(env, context.authorization)
    if (!row) return json(request, env, { error: 'ไม่พบ Commerce settings' }, 404)
    return json(request, env, { settings: { ...mapAdminStoreSettings(row), purchaseActivationLocked: false } })
  }

  if (request.method === 'PATCH' && url.pathname === '/commerce/settings') {
    if (!['owner', 'admin'].includes(context.profile.role)) return json(request, env, { error: 'Owner/Admin เท่านั้น' }, 403)
    const body = await request.json().catch(() => ({})) as any
    const shipping = body.shipping || {}
    const returns = body.returns || {}
    const handlingMin = numberOrNull(shipping.handlingMinDays)
    const handlingMax = numberOrNull(shipping.handlingMaxDays)
    const transitMin = numberOrNull(shipping.transitMinDays)
    const transitMax = numberOrNull(shipping.transitMaxDays)
    const shippingRate = numberOrNull(shipping.rate)
    const shippingCountry = cleanNullableText(shipping.country, 2)?.toUpperCase() || 'TH'
    if (handlingMin !== null && handlingMax !== null && handlingMin > handlingMax) return json(request, env, { error: 'Handling min ต้องไม่มากกว่า max' }, 400)
    if (transitMin !== null && transitMax !== null && transitMin > transitMax) return json(request, env, { error: 'Transit min ต้องไม่มากกว่า max' }, 400)
    if (Boolean(shipping.enabled) && (shippingRate === null || handlingMin === null || handlingMax === null || transitMin === null || transitMax === null)) {
      return json(request, env, { error: 'เปิด Shipping structured data ต้องระบุค่าจัดส่ง + Handling + Transit ให้ครบ' }, 400)
    }
    const returnCategory = String(returns.category || '') || null
    if (returnCategory && !['FINITE', 'NOT_PERMITTED', 'UNLIMITED'].includes(returnCategory)) return json(request, env, { error: 'Return category ไม่ถูกต้อง' }, 400)
    const returnDays = numberOrNull(returns.days)
    if (Boolean(returns.enabled) && returnCategory === 'FINITE' && returnDays === null) return json(request, env, { error: 'FINITE return policy ต้องระบุจำนวนวัน' }, 400)
    const returnMethod = String(returns.method || '') || null
    if (returnMethod && !['MAIL', 'IN_STORE', 'MAIL_AND_IN_STORE'].includes(returnMethod)) return json(request, env, { error: 'Return method ไม่ถูกต้อง' }, 400)
    const returnFees = String(returns.fees || '') || null
    if (returnFees && !['FREE', 'CUSTOMER_RESPONSIBILITY'].includes(returnFees)) return json(request, env, { error: 'Return fees ไม่ถูกต้อง' }, 400)
    const returnPolicyUrl = cleanUrl(returns.policyUrl)
    if (Boolean(returns.enabled) && !returnCategory && !returnPolicyUrl) {
      return json(request, env, { error: 'เปิด Return policy ต้องเลือกประเภทนโยบาย หรือระบุ URL นโยบายจริง' }, 400)
    }
    const checkout = body.checkout || {}
    const documents = body.documents || {}
    const warranty = body.warranty || {}
    const autoPublish = body.autoPublish || {}
    const autoPublishDelaySeconds = Math.max(
      60,
      Math.min(Number(autoPublish.delaySeconds || 180), 3600),
    )
    const stripeEnabled = Boolean(checkout.stripeEnabled)
    const promptPayEnabled = Boolean(checkout.promptPayEnabled)
    const reservationMinutes = Math.max(10, Math.min(Number(checkout.reservationMinutes || 60), 240))
    const documentMode = String(documents.mode || 'RECEIPT_ONLY')
    const defaultWarrantyDays = Math.max(0, Math.min(Number(warranty.defaultDays || 0), 3650))
    if (Boolean(checkout.bankTransferEnabled) && (!cleanCheckoutText(checkout.bankName,120) || !cleanCheckoutText(checkout.bankAccountName,180) || !cleanCheckoutText(checkout.bankAccountNumber,80))) {
      return json(request, env, { error: 'เปิดโอนเงินต้องระบุธนาคาร ชื่อบัญชี และเลขบัญชีให้ครบ' }, 400)
    }
    if (stripeEnabled && (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET)) {
      return json(request, env, { error: 'เปิด Stripe ไม่ได้จนกว่าจะตั้ง STRIPE_SECRET_KEY และ STRIPE_WEBHOOK_SECRET ที่ Worker' }, 400)
    }
    if (stripeEnabled && reservationMinutes < 45) return json(request, env, { error: 'Stripe Checkout ต้องล็อกสินค้าอย่างน้อย 45 นาที เพื่อเว้น webhook grace window' }, 400)
    if (promptPayEnabled && (!stripeEnabled || String(body.currency || 'THB').toUpperCase() !== 'THB')) {
      return json(request, env, { error: 'PromptPay ใช้ได้เมื่อเปิด Stripe และสกุลเงินเป็น THB' }, 400)
    }
    if (!['RECEIPT_ONLY','INVOICE_RECEIPT','VAT_TAX_INVOICE'].includes(documentMode)) return json(request, env, { error: 'Document mode ไม่ถูกต้อง' }, 400)
    if (documentMode === 'VAT_TAX_INVOICE' && (!cleanCheckoutText(documents.sellerName,180) || !cleanCheckoutText(documents.taxId,40) || !cleanCheckoutText(documents.address,500))) {
      return json(request, env, { error: 'VAT Tax Invoice ต้องระบุชื่อผู้ขาย เลขประจำตัวผู้เสียภาษี และที่อยู่ให้ครบ' }, 400)
    }
    const hasPaymentRail = Boolean(checkout.bankTransferEnabled) || stripeEnabled || (Boolean(checkout.payAtStoreEnabled) && Boolean(checkout.pickupEnabled))
    if (Boolean(body.purchaseEnabled) && (!Boolean(shipping.enabled) || !hasPaymentRail || !Boolean(returns.enabled) || !Boolean(checkout.turnstileEnabled) || !cleanCheckoutText(checkout.turnstileSiteKey, 200))) {
      return json(request, env, { error: 'เปิด Checkout ต้องเปิด Shipping + อย่างน้อยหนึ่งวิธีชำระเงินจริง + Return policy + Turnstile ให้ครบ' }, 400)
    }

    const patch = {
      merchant_name: cleanNullableText(body.merchantName, 120) || 'AMPHON TRADING',
      legal_name: cleanNullableText(body.legalName, 180),
      site_url: cleanUrl(body.siteUrl) || 'https://shop.amphon.co.th',
      purchase_enabled: Boolean(body.purchaseEnabled),
      auto_publish_enabled: autoPublish.enabled === undefined ? true : Boolean(autoPublish.enabled),
      auto_publish_delay_seconds: autoPublishDelaySeconds,
      reservation_minutes: reservationMinutes,
      payment_review_hold_hours: 24,
      bank_transfer_enabled: Boolean(body.checkout?.bankTransferEnabled),
      bank_name: cleanNullableText(body.checkout?.bankName, 120),
      bank_account_name: cleanNullableText(body.checkout?.bankAccountName, 180),
      bank_account_number: cleanNullableText(body.checkout?.bankAccountNumber, 80),
      stripe_enabled: stripeEnabled,
      stripe_promptpay_enabled: promptPayEnabled,
      pay_at_store_enabled: Boolean(body.checkout?.payAtStoreEnabled),
      pickup_enabled: Boolean(body.checkout?.pickupEnabled),
      checkout_terms_url: cleanUrl(body.checkout?.termsUrl),
      checkout_turnstile_enabled: Boolean(body.checkout?.turnstileEnabled),
      turnstile_site_key: cleanCheckoutText(body.checkout?.turnstileSiteKey, 200) || null,
      shipping_enabled: Boolean(shipping.enabled),
      shipping_country: shippingCountry,
      shipping_rate: shippingRate,
      handling_min_days: handlingMin,
      handling_max_days: handlingMax,
      transit_min_days: transitMin,
      transit_max_days: transitMax,
      shipping_policy_url: cleanUrl(shipping.policyUrl),
      return_policy_enabled: Boolean(returns.enabled),
      return_policy_category: returnCategory,
      return_days: returnDays,
      return_method: returnMethod,
      return_fees: returnFees,
      return_policy_url: returnPolicyUrl,
      warranty_policy_url: cleanUrl(body.warrantyPolicyUrl),
      document_mode: documentMode,
      invoice_seller_name: cleanNullableText(documents.sellerName, 180),
      invoice_tax_id: cleanNullableText(documents.taxId, 40),
      invoice_branch_code: cleanNullableText(documents.branchCode, 40),
      invoice_address: cleanNullableText(documents.address, 500),
      invoice_email: cleanNullableText(documents.email, 180),
      default_warranty_days: defaultWarrantyDays,
      default_warranty_terms: cleanNullableText(warranty.defaultTerms, 1200),
      updated_by: context.user.id,
    }
    await userRest(env, context.authorization, 'commerce_store_settings?id=eq.1', {
      method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify(patch),
    })
    await logEmployeeAction(env, context.user.id, null, 'commerce_store_settings_updated', {
      shippingEnabled: patch.shipping_enabled,
      returnPolicyEnabled: patch.return_policy_enabled,
      stripeEnabled: patch.stripe_enabled,
      promptPayEnabled: patch.stripe_promptpay_enabled,
      documentMode: patch.document_mode,
      defaultWarrantyDays: patch.default_warranty_days,
      purchaseEnabled: patch.purchase_enabled,
      autoPublishEnabled: patch.auto_publish_enabled,
      autoPublishDelaySeconds: patch.auto_publish_delay_seconds,
    })
    const next = await commerceSettingsForStaff(env, context.authorization)
    return json(request, env, { settings: { ...mapAdminStoreSettings(next!), purchaseActivationLocked: false } })
  }

  if (request.method === 'GET' && url.pathname === '/commerce/catalog') {
    const [categories, brands, series, models] = await Promise.all([
      userRest<any[]>(env, context.authorization, 'commerce_categories?is_active=eq.true&select=id,key,name_th,slug&order=sort_order.asc,name_th.asc'),
      userRest<any[]>(env, context.authorization, 'commerce_brands?is_active=eq.true&select=id,name,slug&order=sort_order.asc,name.asc'),
      userRest<any[]>(env, context.authorization, 'commerce_series?is_active=eq.true&select=id,category_id,brand_id,name,slug&order=sort_order.asc,name.asc'),
      userRest<any[]>(env, context.authorization, 'commerce_models?is_active=eq.true&select=id,category_id,brand_id,series_id,model_name,model_code,slug&order=sort_order.asc,model_name.asc'),
    ])
    return json(request, env, { catalog: {
      categories: categories.map((row) => ({ id: row.id, key: row.key, name: row.name_th, slug: row.slug })),
      brands: brands.map((row) => ({ id: row.id, name: row.name, slug: row.slug })),
      series: series.map((row) => ({ id: row.id, categoryId: row.category_id, brandId: row.brand_id, name: row.name, slug: row.slug })),
      models: models.map((row) => ({ id: row.id, categoryId: row.category_id, brandId: row.brand_id, seriesId: row.series_id || null, name: row.model_name, code: row.model_code || null, slug: row.slug })),
    } })
  }

  if (request.method === 'GET' && url.pathname === '/commerce/candidates') {
    if (!['owner', 'admin'].includes(context.profile.role)) return json(request, env, { error: 'Owner/Admin เท่านั้น' }, 403)
    const rows = await userRest<any[]>(env, context.authorization,
      'commerce_taxonomy_candidates_v?select=*&order=current_stock_count.desc,historical_listing_count.desc,last_seen_at.desc&limit=200')
    return json(request, env, { candidates: rows.map((row) => ({
      categoryId: row.category_id || null,
      categoryKey: row.category_key || null,
      categorySlug: row.category_slug || null,
      sourceBrand: row.source_brand || null,
      sourceModel: row.source_model || null,
      historicalListingCount: Number(row.historical_listing_count || 0),
      currentStockCount: Number(row.current_stock_count || 0),
      mappedBrandId: row.mapped_brand_id || null,
      mappedModelId: row.mapped_model_id || null,
      lastSeenAt: row.last_seen_at || null,
    })) })
  }

  if (request.method === 'POST' && url.pathname === '/commerce/remap') {
    if (!['owner', 'admin'].includes(context.profile.role)) return json(request, env, { error: 'Owner/Admin เท่านั้น' }, 403)
    const affected = await userRest<number>(env, context.authorization, 'rpc/refresh_commerce_taxonomy_mappings', {
      method: 'POST', body: JSON.stringify({}),
    })
    await logEmployeeAction(env, context.user.id, null, 'commerce_taxonomy_remapped', { affected: Number(affected || 0) })
    return json(request, env, { affected: Number(affected || 0) })
  }

  if (request.method === 'POST' && url.pathname === '/commerce/series') {
    if (!['owner', 'admin'].includes(context.profile.role)) return json(request, env, { error: 'Owner/Admin เท่านั้น' }, 403)
    const body = await request.json().catch(() => ({})) as any
    const categoryId = cleanUuidOrNull(body.categoryId)
    const brandId = cleanUuidOrNull(body.brandId)
    const name = cleanNullableText(body.name, 120)
    if (!categoryId || !brandId || !name) return json(request, env, { error: 'Category, Brand และชื่อ Series จำเป็น' }, 400)
    const slug = slugifyCommerce(body.slug || name)
    const rows = await userRest<any[]>(env, context.authorization, 'commerce_series?select=id,category_id,brand_id,name,slug', {
      method: 'POST', headers: { prefer: 'return=representation' },
      body: JSON.stringify({ category_id: categoryId, brand_id: brandId, name, slug, index_policy: 'HOLD' }),
    })
    const row = rows[0]
    await logEmployeeAction(env, context.user.id, null, 'commerce_series_created', { id: row.id, name, categoryId, brandId })
    return json(request, env, { series: { id: row.id, categoryId: row.category_id, brandId: row.brand_id, name: row.name, slug: row.slug } }, 201)
  }

  if (request.method === 'POST' && url.pathname === '/commerce/models') {
    if (!['owner', 'admin'].includes(context.profile.role)) return json(request, env, { error: 'Owner/Admin เท่านั้น' }, 403)
    const body = await request.json().catch(() => ({})) as any
    const categoryId = cleanUuidOrNull(body.categoryId)
    const brandId = cleanUuidOrNull(body.brandId)
    const seriesId = cleanUuidOrNull(body.seriesId)
    const name = cleanNullableText(body.name, 160)
    const code = cleanNullableText(body.code, 100)
    if (!categoryId || !brandId || !name) return json(request, env, { error: 'Category, Brand และชื่อ Model จำเป็น' }, 400)
    const slug = slugifyCommerce(body.slug || code || name)
    const rows = await userRest<any[]>(env, context.authorization,
      'commerce_models?select=id,category_id,brand_id,series_id,model_name,model_code,slug', {
        method: 'POST', headers: { prefer: 'return=representation' },
        body: JSON.stringify({ category_id: categoryId, brand_id: brandId, series_id: seriesId, model_name: name, model_code: code, slug, index_policy: 'HOLD' }),
      })
    const row = rows[0]
    await logEmployeeAction(env, context.user.id, null, 'commerce_model_created', { id: row.id, name, code, categoryId, brandId, seriesId })
    return json(request, env, { model: { id: row.id, categoryId: row.category_id, brandId: row.brand_id, seriesId: row.series_id || null, name: row.model_name, code: row.model_code || null, slug: row.slug } }, 201)
  }

  const productMatch = url.pathname.match(/^\/commerce\/products\/([0-9a-fA-F-]+)(?:\/(prepare))?$/)
  if (productMatch) {
    const productId = productMatch[1]
    const action = productMatch[2]
    if (request.method === 'GET' && !action) {
      return json(request, env, { product: await commerceResponseForProduct(env, context, productId) })
    }
    if (request.method === 'POST' && action === 'prepare') {
      if (!['owner', 'admin', 'sales'].includes(context.profile.role)) return json(request, env, { error: 'ไม่มีสิทธิ์ Prepare Commerce listing' }, 403)
      await userRest(env, context.authorization, 'rpc/prepare_commerce_listing', {
        method: 'POST', body: JSON.stringify({ target_product_id: productId }),
      })
      await logCommerceProductAction(env, context.user.id, productId, 'commerce_listing_prepared', {})
      return json(request, env, { product: await commerceResponseForProduct(env, context, productId) })
    }
    if (request.method === 'PATCH' && !action) {
      if (!['owner', 'admin', 'sales'].includes(context.profile.role)) return json(request, env, { error: 'ไม่มีสิทธิ์แก้ Commerce listing' }, 403)
      const body = await request.json().catch(() => ({})) as any
      const patch: Record<string, unknown> = {}
      if ('categoryId' in body) patch.category_id = cleanUuidOrNull(body.categoryId)
      if ('brandId' in body) patch.brand_id = cleanUuidOrNull(body.brandId)
      if ('seriesId' in body) patch.series_id = cleanUuidOrNull(body.seriesId)
      if ('modelId' in body) patch.model_id = cleanUuidOrNull(body.modelId)
      if ('seoTitle' in body) patch.seo_title = cleanNullableText(body.seoTitle, 180)
      if ('seoDescription' in body) patch.seo_description = cleanNullableText(body.seoDescription, 300)
      if ('indexPolicy' in body) {
        const value = String(body.indexPolicy || '').toUpperCase()
        if (!['INDEX', 'NOINDEX', 'HOLD', 'RETIRED'].includes(value)) return json(request, env, { error: 'Index policy ไม่ถูกต้อง' }, 400)
        patch.index_policy = value
      }
      if ('merchantEnabled' in body) patch.merchant_enabled = Boolean(body.merchantEnabled)
      if ('merchantItemCondition' in body) {
        const value = String(body.merchantItemCondition || '').toUpperCase()
        if (!['NEW', 'USED', 'REFURBISHED'].includes(value)) return json(request, env, { error: 'Merchant condition รองรับ NEW / USED / REFURBISHED เท่านั้น' }, 400)
        patch.merchant_item_condition = value
      }
      if ('googleProductCategory' in body) patch.google_product_category = cleanNullableText(body.googleProductCategory, 500)
      if ('gtin' in body) {
        const value = String(body.gtin || '').replace(/\s+/g, '')
        if (value && !validGtinChecksum(value)) return json(request, env, { error: 'GTIN ไม่ผ่าน checksum หรือความยาวไม่ถูกต้อง' }, 400)
        patch.gtin = value || null
      }
      if ('mpn' in body) patch.mpn = cleanNullableText(body.mpn, 100)
      if ('storeWarrantyDays' in body) {
        const value = numberOrNull(body.storeWarrantyDays)
        if (value !== null && value > 3650) return json(request, env, { error: 'ประกันร้านต้องอยู่ระหว่าง 0–3650 วัน' }, 400)
        patch.store_warranty_days = value
      }
      if ('storeWarrantyTerms' in body) patch.store_warranty_terms = cleanNullableText(body.storeWarrantyTerms, 1200)
      if (!Object.keys(patch).length) return json(request, env, { error: 'ไม่มีข้อมูล Commerce ที่ต้องแก้' }, 400)

      const existing = await loadCommerceEditor(env, context.authorization, productId)
      if (!existing) {
        await userRest(env, context.authorization, 'rpc/prepare_commerce_listing', {
          method: 'POST', body: JSON.stringify({ target_product_id: productId }),
        })
      }
      await userRest(env, context.authorization, `commerce_listings?product_id=eq.${encodeURIComponent(productId)}`, {
        method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify(patch),
      })
      await logCommerceProductAction(env, context.user.id, productId, 'commerce_listing_updated', {
        fields: Object.keys(patch), merchantEnabled: patch.merchant_enabled,
      })
      return json(request, env, { product: await commerceResponseForProduct(env, context, productId) })
    }
  }

  return json(request, env, { error: 'Not found' }, 404)
}

async function handleEmployeeRoutes(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith('/employees')) return null
  const context = await assertEmployeeAdmin(request, env)

  if (request.method === 'GET' && url.pathname === '/employees') {
    return json(request, env, { employees: await listEmployees(env) })
  }

  if (request.method === 'GET' && url.pathname === '/employees/activity') {
    return json(request, env, { activity: await listEmployeeActivity(env) })
  }

  if (request.method === 'POST' && url.pathname === '/employees') {
    const body = await request.json().catch(() => ({})) as { email?: unknown; displayName?: unknown; role?: unknown }
    const email = cleanEmail(body.email)
    const displayName = cleanDisplayName(body.displayName)
    const role = normalizeRole(body.role) || 'sales'
    if (!validEmail(email)) return json(request, env, { error: 'กรุณาระบุอีเมลให้ถูกต้อง' }, 400)
    if (!displayName) return json(request, env, { error: 'กรุณาระบุชื่อพนักงาน' }, 400)
    if (context.profile.role === 'admin' && !['sales', 'technician'].includes(role)) return json(request, env, { error: 'Admin เพิ่มได้เฉพาะ Sales/Technician' }, 403)

    const temporaryPassword = generateTemporaryPassword()
    const created = await authAdmin<any>(env, 'users', {
      method: 'POST',
      body: JSON.stringify({ email, password: temporaryPassword, email_confirm: true, user_metadata: { display_name: displayName, must_change_password: true } }),
    })
    const user = created?.user ?? created
    const userId = String(user?.id || '')
    if (!userId) throw new Error('AUTH_USER_CREATE_FAILED')
    try {
      await serviceRest(env, `profiles?id=eq.${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        headers: { prefer: 'return=minimal' },
        body: JSON.stringify({ display_name: displayName, role, active: true }),
      })
    } catch (error) {
      try { await authAdmin(env, `users/${encodeURIComponent(userId)}`, { method: 'DELETE' }) } catch { /* best effort rollback */ }
      throw error
    }
    await logEmployeeAction(env, context.user.id, userId, 'employee_created', { email, displayName, role })
    return json(request, env, { employee: { id: userId, email, displayName, role, active: true }, temporaryPassword }, 201)
  }

  const match = url.pathname.match(/^\/employees\/([0-9a-fA-F-]+)(?:\/(reset-password))?$/)
  if (!match) return json(request, env, { error: 'Not found' }, 404)
  const targetId = match[1]
  const action = match[2]
  const target = await loadProfileWithSecret(env, targetId)
  if (!target) return json(request, env, { error: 'ไม่พบบัญชีพนักงาน' }, 404)

  if (request.method === 'POST' && action === 'reset-password') {
    await assertCanManageTarget(env, context.profile, context.user.id, target)
    if (context.profile.role === 'admin' && ['owner', 'admin'].includes(target.role)) return json(request, env, { error: 'Admin ไม่สามารถรีเซ็ตรหัสผ่าน Owner/Admin' }, 403)
    const temporaryPassword = generateTemporaryPassword()
    await authAdmin(env, `users/${encodeURIComponent(targetId)}`, {
      method: 'PUT',
      body: JSON.stringify({ password: temporaryPassword, user_metadata: { display_name: target.display_name || 'พนักงาน', must_change_password: true } }),
    })
    await logEmployeeAction(env, context.user.id, targetId, 'employee_password_reset', {})
    return json(request, env, { ok: true, temporaryPassword })
  }

  if (request.method === 'PATCH' && !action) {
    const body = await request.json().catch(() => ({})) as { displayName?: unknown; role?: unknown; active?: unknown }
    const patch: Record<string, unknown> = {}
    const nextRole = body.role === undefined ? undefined : normalizeRole(body.role)
    const nextActive = body.active === undefined ? undefined : Boolean(body.active)
    if (body.role !== undefined && !nextRole) return json(request, env, { error: 'Role ไม่ถูกต้อง' }, 400)
    await assertCanManageTarget(env, context.profile, context.user.id, target, nextRole ?? undefined, nextActive)

    if (body.displayName !== undefined) {
      const displayName = cleanDisplayName(body.displayName)
      if (!displayName) return json(request, env, { error: 'ชื่อพนักงานห้ามว่าง' }, 400)
      patch.display_name = displayName
      await authAdmin(env, `users/${encodeURIComponent(targetId)}`, {
        method: 'PUT',
        body: JSON.stringify({ user_metadata: { display_name: displayName, must_change_password: true } }),
      })
    }
    if (nextRole) patch.role = nextRole
    if (nextActive !== undefined) patch.active = nextActive
    if (!Object.keys(patch).length) return json(request, env, { error: 'ไม่มีข้อมูลที่ต้องแก้ไข' }, 400)

    await serviceRest(env, `profiles?id=eq.${encodeURIComponent(targetId)}`, {
      method: 'PATCH',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify(patch),
    })
    await logEmployeeAction(env, context.user.id, targetId, 'employee_updated', {
      before: { displayName: target.display_name, role: target.role, active: target.active },
      after: patch,
    })
    return json(request, env, { ok: true })
  }

  return json(request, env, { error: 'Not found' }, 404)
}

async function assertProductAccess(request: Request, env: Env, productId: string) {
  const authorization = request.headers.get('authorization')!
  const url = `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/products?id=eq.${encodeURIComponent(productId)}&select=id`
  const response = await fetch(url, {
    headers: { authorization, apikey: env.SUPABASE_PUBLISHABLE_KEY, accept: 'application/json' },
  })
  if (!response.ok) throw new Error('PRODUCT_ACCESS_DENIED')
  const rows = await response.json() as Array<{ id: string }>
  if (!rows.length) throw new Error('PRODUCT_ACCESS_DENIED')
}

function safeFilename(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'image.jpg'
}

function encodeObjectPath(key: string) {
  return key.split('/').map(encodeURIComponent).join('/')
}

function friendlyStoreError(error: unknown) {
  const code = error instanceof Error ? error.message : String(error)
  const raw = code.includes(':') ? code.split(':').slice(2).join(':') : code
  const lower = raw.toLowerCase()
  if (lower.includes('checkout_disabled')) return { status: 503, message: 'Checkout ยังไม่เปิดใช้งาน' }
  if (lower.includes('product_unavailable') || lower.includes('product_reserved') || lower.includes('product_reservation_race')) return { status: 409, message: 'มีสินค้าในตะกร้าที่ถูกจองหรือไม่พร้อมขายแล้ว กรุณารีเฟรชตะกร้า' }
  if (lower.includes('reservation_expired')) return { status: 409, message: 'หมดเวลาจองสินค้าแล้ว กรุณาสร้างคำสั่งซื้อใหม่' }
  if (lower.includes('order_not_found')) return { status: 404, message: 'ไม่พบคำสั่งซื้อ' }
  if (lower.includes('order_not_payable') || lower.includes('payment_notification_not_required')) return { status: 409, message: 'Order นี้ไม่อยู่ในสถานะที่แจ้งชำระได้' }
  if (lower.includes('invalid_cart_size') || lower.includes('empty_cart')) return { status: 400, message: 'ตะกร้าไม่ถูกต้อง' }
  if (lower.includes('customer_name_required')) return { status: 400, message: 'กรุณาระบุชื่อผู้สั่งซื้อ' }
  if (lower.includes('customer_phone_required')) return { status: 400, message: 'กรุณาระบุเบอร์โทรให้ถูกต้อง' }
  if (lower.includes('shipping_address_required')) return { status: 400, message: 'กรุณากรอกที่อยู่จัดส่งให้ครบ' }
  if (lower.includes('payment_method_disabled')) return { status: 400, message: 'วิธีชำระเงินนี้ยังไม่เปิดใช้งาน' }
  if (lower.includes('shipping_disabled')) return { status: 400, message: 'การจัดส่งยังไม่เปิดใช้งาน' }
  if (lower.includes('pickup_disabled')) return { status: 400, message: 'การรับสินค้าที่ร้านยังไม่เปิดใช้งาน' }
  if (lower.includes('product_not_found')) return { status: 404, message: 'ไม่พบสินค้าบางรายการในตะกร้า' }
  if (lower.includes('stripe_not_configured') || lower.includes('stripe_not_enabled')) return { status: 503, message: 'ช่องทาง Stripe ยังไม่พร้อมใช้งาน' }
  if (lower.includes('payment_amount_mismatch') || lower.includes('payment_currency_mismatch')) return { status: 409, message: 'ยอดหรือสกุลเงินจาก Payment Gateway ไม่ตรงกับ Order' }
  return null
}

function friendlyWorkerError(code: string) {
  if (code === 'UNAUTHORIZED') return { status: 401, message: 'Unauthorized' }
  if (code === 'PRODUCT_ACCESS_DENIED') return { status: 403, message: 'Product access denied' }
  if (code === 'ADMIN_ACCESS_DENIED') return { status: 403, message: 'Owner/Admin เท่านั้น' }
  if (code === 'CANNOT_CHANGE_OWN_ACCESS') return { status: 409, message: 'ไม่สามารถปิดบัญชีหรือเปลี่ยน Role ของตัวเองจากหน้านี้' }
  if (code === 'ADMIN_CANNOT_MANAGE_PRIVILEGED') return { status: 403, message: 'Admin ไม่สามารถจัดการ Owner/Admin' }
  if (code === 'ADMIN_CANNOT_GRANT_PRIVILEGED') return { status: 403, message: 'Admin ไม่สามารถมอบสิทธิ์ Owner/Admin' }
  if (code === 'LAST_OWNER_REQUIRED') return { status: 409, message: 'ต้องมี Owner ที่เปิดใช้งานอย่างน้อย 1 คน' }
  if (code === 'COMMERCE_ACCESS_DENIED') return { status: 403, message: 'บัญชีนี้ไม่มีสิทธิ์ใช้ Commerce admin' }
  if (code === 'PRODUCT_NOT_FOUND') return { status: 404, message: 'ไม่พบสินค้า' }
  if (code === 'INVALID_URL') return { status: 400, message: 'URL ต้องเป็น http:// หรือ https://' }
  if (code === 'INVALID_UUID' || code === 'INVALID_NUMBER') return { status: 400, message: 'ข้อมูล Commerce ไม่ถูกต้อง' }
  if (code === 'STRIPE_NOT_CONFIGURED' || code === 'STRIPE_NOT_ENABLED') return { status: 503, message: 'Stripe ยังไม่พร้อมใช้งาน' }
  if (code === 'STRIPE_RESERVATION_WINDOW_INVALID') return { status: 409, message: 'Reservation window สั้นเกินไปสำหรับ Stripe Checkout' }
  if (code === 'GATEWAY_PAID_ORDER_REQUIRED') return { status: 409, message: 'Order นี้ไม่ใช่ Stripe order ที่คืนเงินได้' }
  if (code === 'TRACKING_REQUIRED') return { status: 400, message: 'กรุณาระบุข้อมูล Tracking ก่อนอัปเดตสถานะ' }
  return null
}


type CommerceAutoPublishClaim = {
  product_id: string
  sku: string
  attempt_count: number
  publish_after: string
}

async function runCommerceAutoPublishSweep(env: Env) {
  const workerId = `commerce-auto-publish:${crypto.randomUUID()}`
  const claims = await serviceRest<CommerceAutoPublishClaim[]>(
    env,
    'rpc/claim_commerce_auto_publish',
    {
      method: 'POST',
      body: JSON.stringify({ p_worker_id: workerId, p_limit: 20 }),
    },
  )

  for (const claim of Array.isArray(claims) ? claims : []) {
    try {
      const result = await serviceRest<Record<string, unknown>>(
        env,
        'rpc/execute_commerce_auto_publish',
        {
          method: 'POST',
          body: JSON.stringify({
            target_product_id: claim.product_id,
            p_worker_id: workerId,
          }),
        },
      )
      console.log('SHOP AUTO PUBLISH completed', {
        sku: claim.sku,
        productId: claim.product_id,
        attempt: claim.attempt_count,
        result,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('SHOP AUTO PUBLISH attempt failed', {
        sku: claim.sku,
        productId: claim.product_id,
        attempt: claim.attempt_count,
        error: message,
      })
      try {
        await serviceRest<Record<string, unknown>>(
          env,
          'rpc/fail_commerce_auto_publish',
          {
            method: 'POST',
            body: JSON.stringify({
              target_product_id: claim.product_id,
              p_worker_id: workerId,
              p_error: message.slice(0, 1500),
            }),
          },
        )
      } catch (markError) {
        console.error('SHOP AUTO PUBLISH failed to schedule retry', {
          productId: claim.product_id,
          markError,
        })
      }
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/__shop62/')) {
      try {
        const testResponse = await handleShop62TestRoutes(request, env, url)
        if (testResponse) return testResponse
      } catch (error) {
        console.error('SHOP62 E2E route error', error)
        return storeJson({ error: error instanceof Error ? error.message : 'SHOP62 E2E failed' }, 500, 'no-store')
      }
    }
    if (request.method === 'POST' && url.pathname === '/webhooks/stripe') {
      try {
        return await processStripeWebhook(request, env)
      } catch (error) {
        console.error('Stripe webhook error', error)
        return new Response('Webhook processing failed', { status: 500 })
      }
    }

    if (request.method === 'OPTIONS' && url.pathname.startsWith('/shopee')) {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) })
    }

    if (url.pathname.startsWith('/shopee') || url.pathname === '/webhooks/shopee') {
      try {
        const shopeeResponse = await handleShopeeRoutes(request, env, url)
        if (shopeeResponse) {
          if (url.pathname === '/webhooks/shopee' || url.pathname === '/shopee/callback') {
            return shopeeResponse
          }
          const headers = new Headers(shopeeResponse.headers)
          for (const [key, value] of Object.entries(corsHeaders(request, env))) {
            headers.set(key, value)
          }
          return new Response(shopeeResponse.body, {
            status: shopeeResponse.status,
            statusText: shopeeResponse.statusText,
            headers,
          })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error('Shopee route error', error)
        const status = /AUTH_REQUIRED|AUTH_INVALID/.test(message)
          ? 401
          : /ACCESS_DENIED/.test(message)
            ? 403
            : /NOT_CONFIGURED|MAPPING_|CATEGORY_|SHOP_ID_REQUIRED/.test(message)
              ? 409
              : 500
        return json(request, env, { error: message }, status)
      }
    }
    if (url.pathname.startsWith('/store')) {
      try {
        const storeResponse = await handleStoreRoutes(request, env, url)
        if (storeResponse) return request.method === 'HEAD' ? new Response(null, { status: storeResponse.status, headers: storeResponse.headers }) : storeResponse
      } catch (error) {
        const friendly = friendlyStoreError(error)
        if (friendly) return storeJson({ error: friendly.message }, friendly.status, 'no-store')
        console.error('Store API error', error)
        return storeJson({ error: 'Store API unavailable' }, 503, 'no-store')
      }
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) })

    if (request.method === 'GET' && url.pathname === '/health') {
      return json(request, env, { ok: true, service: 'amphon-product-api', employeeManagement: true, storeApi: true, commerceAdmin: true, shopVersion: 6 })
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname.startsWith('/image/')) {
      const key = url.pathname.slice('/image/'.length).split('/').map(decodeURIComponent).join('/')
      const object = await env.IMAGES.get(key)
      if (!object) return new Response('Not found', { status: 404 })
      const headers = new Headers()
      object.writeHttpMetadata(headers)
      if (!headers.get('content-type')) {
        const lowerKey = key.toLowerCase()
        headers.set(
          'content-type',
          lowerKey.endsWith('.png') ? 'image/png'
            : lowerKey.endsWith('.webp') ? 'image/webp'
              : lowerKey.endsWith('.gif') ? 'image/gif'
                : 'image/jpeg',
        )
      }
      headers.set('etag', object.httpEtag)
      headers.set('content-length', String(object.size))
      headers.set('cache-control', 'public, max-age=31536000, immutable')
      headers.set('access-control-allow-origin', '*')
      headers.set('cross-origin-resource-policy', 'cross-origin')
      headers.set('x-content-type-options', 'nosniff')
      return new Response(request.method === 'HEAD' ? null : object.body, { headers })
    }

    try {
      const commerceResponse = await handleCommerceRoutes(request, env, url)
      if (commerceResponse) return commerceResponse

      const employeeResponse = await handleEmployeeRoutes(request, env, url)
      if (employeeResponse) return employeeResponse

      await authenticate(request, env)

      if (request.method === 'POST' && url.pathname === '/upload') {
        const productId = request.headers.get('x-product-id') || ''
        const encodedFilename = request.headers.get('x-filename') || 'image.jpg'
        let decodedFilename = encodedFilename
        try { decodedFilename = decodeURIComponent(encodedFilename) } catch { /* keep encoded value */ }
        const filename = safeFilename(decodedFilename)
        const contentType = request.headers.get('content-type') || 'image/jpeg'
        if (!productId) return json(request, env, { error: 'x-product-id is required' }, 400)
        if (!contentType.startsWith('image/')) return json(request, env, { error: 'Only image uploads are allowed' }, 415)
        if (!request.body) return json(request, env, { error: 'Empty upload body' }, 400)
        const contentLength = Number(request.headers.get('content-length') || 0)
        if (contentLength > 12 * 1024 * 1024) return json(request, env, { error: 'Image is too large' }, 413)

        await assertProductAccess(request, env, productId)
        const objectKey = `products/${productId}/${crypto.randomUUID()}-${filename}`
        await env.IMAGES.put(objectKey, request.body, {
          httpMetadata: { contentType, cacheControl: 'public, max-age=31536000, immutable' },
          customMetadata: { productId },
        })

        const publicUrl = `${url.origin}/image/${encodeObjectPath(objectKey)}`
        return json(request, env, { objectKey, publicUrl }, 201)
      }

      if (request.method === 'DELETE' && url.pathname === '/object') {
        const productId = request.headers.get('x-product-id') || ''
        const objectKey = request.headers.get('x-object-key') || ''
        if (!productId || !objectKey) return json(request, env, { error: 'x-product-id and x-object-key are required' }, 400)
        if (!objectKey.startsWith(`products/${productId}/`)) return json(request, env, { error: 'Object does not belong to product' }, 400)
        await assertProductAccess(request, env, productId)
        await env.IMAGES.delete(objectKey)
        return json(request, env, { ok: true })
      }

      return json(request, env, { error: 'Not found' }, 404)
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error)
      const friendly = friendlyWorkerError(code)
      if (friendly) return json(request, env, { error: friendly.message }, friendly.status)
      if (code.startsWith('USER_REST:')) {
        const raw = code.split(':').slice(2).join(':')
        const lower = raw.toLowerCase()
        if (lower.includes('mismatch') || lower.includes('invalid_series') || lower.includes('invalid_model')) return json(request, env, { error: 'Taxonomy ที่เลือกไม่อยู่ใน Category / Brand / Series เดียวกัน' }, 409)
        if (lower.includes('duplicate') || lower.includes('unique')) return json(request, env, { error: 'มี Taxonomy/slug นี้อยู่แล้ว กรุณาใช้รายการเดิม' }, 409)
        if (lower.includes('forbidden')) return json(request, env, { error: 'ไม่มีสิทธิ์ทำรายการนี้' }, 403)
        return json(request, env, { error: raw || 'Commerce database error' }, 400)
      }
      if (code.startsWith('AUTH_ADMIN:409') || code.toLowerCase().includes('already')) return json(request, env, { error: 'อีเมลนี้มีบัญชีอยู่แล้ว' }, 409)
      if (code.startsWith('AUTH_ADMIN:')) return json(request, env, { error: code.split(':').slice(2).join(':') || 'Supabase Auth Admin error' }, 400)
      console.error(error)
      return json(request, env, { error: 'Internal server error' }, 500)
    }
  },
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    const cron = controller.cron || ''
    const isManual = !cron

    if (isManual || cron === '* * * * *') {
      try {
        await runCommerceAutoPublishSweep(env)
      } catch (error) {
        console.error('SHOP AUTO PUBLISH sweep failed', error)
      }

      try {
        const result = await runShopeePublishSweep(env)
        if (!('skipped' in result)) console.log('SHOPEE publish sweep', result)
      } catch (error) {
        console.error('SHOPEE publish sweep failed', error)
      }
    }

    if (isManual || cron === '*/5 * * * *') {
      try {
        const result = await serviceRest<any>(env, 'rpc/expire_commerce_reservations', {
          method: 'POST',
          body: JSON.stringify({ max_orders: 200 }),
        })
        console.log('SHOP6 reservation expiry sweep', result)
      } catch (error) {
        console.error('SHOP6 reservation expiry sweep failed', error)
      }
    }
  },
}
