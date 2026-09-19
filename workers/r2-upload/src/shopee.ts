import {
  confirmOne4SystemSale,
  releaseOne4SystemStock,
  reserveOne4SystemStock,
  type One4SystemStockEnv,
  type One4SystemStockResult,
} from './one4-system-stock'

type ShopeeRole = 'owner' | 'admin' | 'sales' | 'technician'

export interface ShopeeEnv extends One4SystemStockEnv {
  SUPABASE_URL: string
  SUPABASE_PUBLISHABLE_KEY: string
  SUPABASE_SECRET_KEY: string
  SHOPEE_PARTNER_ID?: string
  SHOPEE_PARTNER_KEY?: string
  SHOPEE_API_BASE_URL?: string
  SHOPEE_AUTH_URL?: string
  SHOPEE_REDIRECT_URI?: string
  SHOPEE_HUB_REDIRECT_URL?: string
}

type ShopeeProfile = {
  id: string
  display_name?: string | null
  role: ShopeeRole
  active: boolean
}

type ShopeeConnectionSecret = {
  shop_id: number
  merchant_id?: number | null
  status: string
  access_token: string
  refresh_token: string
  access_expires_at: string
  refresh_expires_at: string
  authorization_expires_at?: string | null
}

type ShopeeQueueClaim = {
  id: string
  product_id: string
  shop_id: number
  action: 'CREATE' | 'UPDATE' | 'STOCK_SYNC' | 'END'
  attempt_count: number
}

type ShopeeOrderEventClaim = {
  id: string
  shop_id: number
  code: number
  payload: any
  attempt_count: number
}

type ShopeeOrderItem = {
  item_sku?: string | null
  model_sku?: string | null
  model_quantity_purchased?: number | null
  model_original_price?: number | null
  model_discounted_price?: number | null
}

type ShopeeOrderDetail = {
  order_sn: string
  order_status: string
  cod?: boolean
  create_time?: number
  update_time?: number
  pay_time?: number
  payment_method?: string | null
  item_list?: ShopeeOrderItem[]
}

type ShopeeProduct = {
  id: string
  sku: string
  category: string
  subtype?: string | null
  brand?: string | null
  model?: string | null
  title: string
  status: string
  price: number | string | null
  warranty_until?: string | null
  defects?: string | null
  notes?: string | null
  specs?: Record<string, unknown> | null
  one_managed?: boolean | null
  one_availability?: string | null
}

type ShopeeImage = {
  public_url: string
  is_cover: boolean
  sort_order: number
}

type ShopeeCategoryMapping = {
  id: string
  source_category: string
  source_subtype?: string | null
  shopee_category_id: number
  shopee_category_name?: string | null
  attribute_list?: unknown[]
  logistic_info?: unknown[]
  weight_kg?: number | string | null
  dimension?: Record<string, unknown> | null
  brand?: Record<string, unknown> | null
  active: boolean
}

type ShopeeProductMapping = {
  id: string
  product_id: string
  shop_id: number
  shopee_item_id?: number | null
  seller_sku: string
  status: string
}

type ShopeeSettings = {
  auto_publish_enabled: boolean
  publish_delay_seconds: number
  price_markup_percent: number | string
  default_condition: string
}

class ShopeeError extends Error {
  retryable: boolean
  constructor(message: string, retryable = true) {
    super(message)
    this.name = 'ShopeeError'
    this.retryable = retryable
  }
}

function serviceHeaders(env: ShopeeEnv, body = true) {
  return {
    apikey: env.SUPABASE_SECRET_KEY,
    authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
    accept: 'application/json',
    ...(body ? { 'content-type': 'application/json' } : {}),
  }
}

async function serviceRest<T>(
  env: ShopeeEnv,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(
    `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`,
    {
      ...init,
      headers: {
        ...serviceHeaders(env, Boolean(init.body)),
        ...(init.headers || {}),
      },
    },
  )
  const text = await response.text()
  if (!response.ok) {
    throw new ShopeeError(
      `SHOPEE_DB:${response.status}:${text.slice(0, 800)}`,
      response.status >= 500,
    )
  }
  return (text ? JSON.parse(text) : undefined) as T
}

async function serviceRpc<T>(
  env: ShopeeEnv,
  name: string,
  body: Record<string, unknown>,
): Promise<T> {
  return serviceRest<T>(env, `rpc/${name}`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

function requiredConfig(env: ShopeeEnv) {
  const partnerId = Number(env.SHOPEE_PARTNER_ID || 0)
  const partnerKey = String(env.SHOPEE_PARTNER_KEY || '')
  const redirectUri = String(
    env.SHOPEE_REDIRECT_URI ||
      'https://amphon-product-images.noteroru2.workers.dev/shopee/callback',
  )
  if (!Number.isInteger(partnerId) || partnerId <= 0 || !partnerKey) {
    throw new ShopeeError('SHOPEE_NOT_CONFIGURED', false)
  }
  return {
    partnerId,
    partnerKey,
    redirectUri,
    apiBase: String(
      env.SHOPEE_API_BASE_URL || 'https://partner.shopeemobile.com',
    ).replace(/\/$/, ''),
    authUrl: String(env.SHOPEE_AUTH_URL || 'https://open.shopee.com/auth'),
    hubRedirect: String(
      env.SHOPEE_HUB_REDIRECT_URL || 'https://hub.amphon.co.th/',
    ),
  }
}

function configured(env: ShopeeEnv) {
  try {
    requiredConfig(env)
    return true
  } catch {
    return false
  }
}

function hex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function hmacHex(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return hex(
    await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(value),
    ),
  )
}

async function sha256Hex(value: string) {
  return hex(
    await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(value),
    ),
  )
}

async function publicApiUrl(
  env: ShopeeEnv,
  path: string,
  extra: Record<string, string | number> = {},
) {
  const cfg = requiredConfig(env)
  const timestamp = Math.floor(Date.now() / 1000)
  const sign = await hmacHex(
    cfg.partnerKey,
    `${cfg.partnerId}${path}${timestamp}`,
  )
  const url = new URL(`${cfg.apiBase}${path}`)
  url.searchParams.set('partner_id', String(cfg.partnerId))
  url.searchParams.set('timestamp', String(timestamp))
  url.searchParams.set('sign', sign)
  for (const [key, value] of Object.entries(extra)) {
    url.searchParams.set(key, String(value))
  }
  return url
}

async function shopApiUrl(
  env: ShopeeEnv,
  path: string,
  accessToken: string,
  shopId: number,
  extra: Record<string, string | number> = {},
) {
  const cfg = requiredConfig(env)
  const timestamp = Math.floor(Date.now() / 1000)
  const sign = await hmacHex(
    cfg.partnerKey,
    `${cfg.partnerId}${path}${timestamp}${accessToken}${shopId}`,
  )
  const url = new URL(`${cfg.apiBase}${path}`)
  url.searchParams.set('partner_id', String(cfg.partnerId))
  url.searchParams.set('timestamp', String(timestamp))
  url.searchParams.set('sign', sign)
  url.searchParams.set('access_token', accessToken)
  url.searchParams.set('shop_id', String(shopId))
  for (const [key, value] of Object.entries(extra)) {
    url.searchParams.set(key, String(value))
  }
  return url
}

async function parseShopeeResponse(response: Response) {
  const raw = await response.text()
  let payload: any
  try {
    payload = raw ? JSON.parse(raw) : {}
  } catch {
    throw new ShopeeError(
      `SHOPEE_HTTP_${response.status}:INVALID_JSON:${raw.slice(0, 500)}`,
      response.status >= 500,
    )
  }
  const error = String(payload?.error || '')
  if (!response.ok || error) {
    const message = String(payload?.message || payload?.msg || error || 'Shopee API error')
    const permanent = /invalid_|category|attribute|logistic|item_name|description|weight|price|image|forbidden|banned/i.test(
      `${error} ${message}`,
    )
    throw new ShopeeError(
      `SHOPEE_API:${error || response.status}:${message}`,
      !permanent && response.status !== 400 && response.status !== 403,
    )
  }
  return payload
}

async function publicPost(
  env: ShopeeEnv,
  path: string,
  body: Record<string, unknown>,
) {
  const url = await publicApiUrl(env, path)
  return parseShopeeResponse(
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

async function shopRequest(
  env: ShopeeEnv,
  connection: ShopeeConnectionSecret,
  path: string,
  init: RequestInit = {},
  extra: Record<string, string | number> = {},
) {
  const accessToken = await ensureAccessToken(env, connection)
  const url = await shopApiUrl(
    env,
    path,
    accessToken,
    Number(connection.shop_id),
    extra,
  )
  return parseShopeeResponse(
    await fetch(url, {
      ...init,
      headers: {
        ...(init.body && !(init.body instanceof FormData)
          ? { 'content-type': 'application/json' }
          : {}),
        ...(init.headers || {}),
      },
    }),
  )
}

async function loadProfile(
  env: ShopeeEnv,
  userId: string,
): Promise<ShopeeProfile | null> {
  const rows = await serviceRest<ShopeeProfile[]>(
    env,
    `profiles?id=eq.${encodeURIComponent(userId)}&select=id,display_name,role,active&limit=1`,
  )
  return rows[0] || null
}

async function authenticateAdmin(request: Request, env: ShopeeEnv) {
  const authorization = request.headers.get('authorization') || ''
  if (!authorization.toLowerCase().startsWith('bearer ')) {
    throw new ShopeeError('SHOPEE_ADMIN_AUTH_REQUIRED', false)
  }
  const response = await fetch(
    `${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/user`,
    {
      headers: {
        apikey: env.SUPABASE_PUBLISHABLE_KEY,
        authorization,
      },
    },
  )
  if (!response.ok) throw new ShopeeError('SHOPEE_ADMIN_AUTH_INVALID', false)
  const user = (await response.json()) as { id?: string }
  if (!user.id) throw new ShopeeError('SHOPEE_ADMIN_AUTH_INVALID', false)
  const profile = await loadProfile(env, user.id)
  if (!profile?.active || !['owner', 'admin'].includes(profile.role)) {
    throw new ShopeeError('SHOPEE_ADMIN_ACCESS_DENIED', false)
  }
  return { userId: user.id, profile }
}

async function getConnection(
  env: ShopeeEnv,
  shopId: number,
): Promise<ShopeeConnectionSecret> {
  const rows = await serviceRpc<ShopeeConnectionSecret[]>(
    env,
    'shopee_get_connection_secret',
    { p_shop_id: shopId },
  )
  if (!rows?.[0]) throw new ShopeeError('SHOPEE_CONNECTION_REQUIRED', false)
  return rows[0]
}

async function storeTokens(
  env: ShopeeEnv,
  args: {
    shopId: number
    merchantId?: number | null
    accessToken: string
    refreshToken: string
    expiresIn: number
    authorizationExpiresAt?: string | null
  },
) {
  const now = Date.now()
  const accessExpiresAt = new Date(
    now + Math.max(60, args.expiresIn || 14400) * 1000,
  ).toISOString()
  const refreshExpiresAt = new Date(
    now + 30 * 24 * 60 * 60 * 1000,
  ).toISOString()

  await serviceRpc(env, 'shopee_store_tokens', {
    p_shop_id: args.shopId,
    p_merchant_id: args.merchantId ?? null,
    p_access_token: args.accessToken,
    p_refresh_token: args.refreshToken,
    p_access_expires_at: accessExpiresAt,
    p_refresh_expires_at: refreshExpiresAt,
    p_authorization_expires_at: args.authorizationExpiresAt ?? null,
  })
}

async function exchangeAuthorizationCode(
  env: ShopeeEnv,
  code: string,
  shopId: number,
) {
  const cfg = requiredConfig(env)
  const payload = await publicPost(env, '/api/v2/auth/token/get', {
    code,
    shop_id: shopId,
    partner_id: cfg.partnerId,
  })
  const accessToken = String(payload?.access_token || '')
  const refreshToken = String(payload?.refresh_token || '')
  if (!accessToken || !refreshToken) {
    throw new ShopeeError('SHOPEE_TOKEN_EXCHANGE_INVALID', false)
  }
  const merchantId = Array.isArray(payload?.merchant_id_list)
    ? Number(payload.merchant_id_list[0] || 0) || null
    : null
  await storeTokens(env, {
    shopId,
    merchantId,
    accessToken,
    refreshToken,
    expiresIn: Number(payload?.expire_in || 14400),
  })
  return { merchantId }
}

async function refreshConnectionToken(
  env: ShopeeEnv,
  connection: ShopeeConnectionSecret,
) {
  const cfg = requiredConfig(env)
  if (new Date(connection.refresh_expires_at).getTime() <= Date.now()) {
    throw new ShopeeError('SHOPEE_REAUTH_REQUIRED', false)
  }
  const payload = await publicPost(env, '/api/v2/auth/access_token/get', {
    refresh_token: connection.refresh_token,
    shop_id: Number(connection.shop_id),
    partner_id: cfg.partnerId,
  })
  const accessToken = String(payload?.access_token || '')
  const refreshToken = String(payload?.refresh_token || '')
  if (!accessToken || !refreshToken) {
    throw new ShopeeError('SHOPEE_TOKEN_REFRESH_INVALID', false)
  }
  await storeTokens(env, {
    shopId: Number(connection.shop_id),
    merchantId: connection.merchant_id ?? null,
    accessToken,
    refreshToken,
    expiresIn: Number(payload?.expire_in || 14400),
    authorizationExpiresAt: connection.authorization_expires_at || null,
  })
  connection.access_token = accessToken
  connection.refresh_token = refreshToken
  connection.access_expires_at = new Date(
    Date.now() + Number(payload?.expire_in || 14400) * 1000,
  ).toISOString()
  connection.refresh_expires_at = new Date(
    Date.now() + 30 * 24 * 60 * 60 * 1000,
  ).toISOString()
  return accessToken
}

async function ensureAccessToken(
  env: ShopeeEnv,
  connection: ShopeeConnectionSecret,
) {
  const expiresAt = new Date(connection.access_expires_at).getTime()
  if (
    connection.status === 'CONNECTED' &&
    expiresAt > Date.now() + 5 * 60 * 1000
  ) {
    return connection.access_token
  }
  return refreshConnectionToken(env, connection)
}

async function loadProductBundle(
  env: ShopeeEnv,
  productId: string,
): Promise<{
  product: ShopeeProduct
  images: ShopeeImage[]
  category: ShopeeCategoryMapping
  settings: ShopeeSettings
  existing?: ShopeeProductMapping | null
}> {
  const products = await serviceRest<ShopeeProduct[]>(
    env,
    `products?id=eq.${encodeURIComponent(productId)}&select=id,sku,category,subtype,brand,model,title,status,price,warranty_until,defects,notes,specs,one_managed,one_availability&limit=1`,
  )
  const product = products[0]
  if (!product) throw new ShopeeError('SHOPEE_PRODUCT_NOT_FOUND', false)

  const [images, mappings, settingsRows] = await Promise.all([
    serviceRest<ShopeeImage[]>(
      env,
      `product_images?product_id=eq.${encodeURIComponent(productId)}&public_url=not.is.null&select=public_url,is_cover,sort_order&order=is_cover.desc,sort_order.asc`,
    ),
    serviceRest<ShopeeCategoryMapping[]>(
      env,
      `shopee_category_mappings?source_category=eq.${encodeURIComponent(product.category)}&active=eq.true&select=*&order=updated_at.desc`,
    ),
    serviceRest<ShopeeSettings[]>(env, 'shopee_settings?id=eq.1&select=*&limit=1'),
  ])

  const category =
    mappings.find((row) => row.source_subtype === product.subtype) ||
    mappings.find((row) => !row.source_subtype)

  if (!category) {
    throw new ShopeeError('SHOPEE_CATEGORY_MAPPING_REQUIRED', false)
  }
  if (
    !Array.isArray(category.logistic_info) ||
    !category.logistic_info.length ||
    !Number(category.weight_kg || 0)
  ) {
    throw new ShopeeError('SHOPEE_MAPPING_INCOMPLETE', false)
  }
  if (images.length < 2 || !images.some((image) => image.is_cover)) {
    throw new ShopeeError('SHOPEE_IMAGES_INCOMPLETE', false)
  }

  return {
    product,
    images: images.slice(0, 8),
    category,
    settings: settingsRows[0] || {
      auto_publish_enabled: true,
      publish_delay_seconds: 60,
      price_markup_percent: 0,
      default_condition: 'USED',
    },
  }
}

function projectedStock(product: ShopeeProduct) {
  if (product.one_availability) {
    return product.one_availability === 'IN_STOCK' ? 1 : 0
  }
  return product.status === 'published' ? 1 : 0
}

function roundPrice(value: number) {
  return Math.max(1, Math.round(value))
}

function shopeePrice(product: ShopeeProduct, settings: ShopeeSettings) {
  const base = Number(product.price || 0)
  const markup = Number(settings.price_markup_percent || 0)
  return roundPrice(base * (1 + markup / 100))
}

function cleanText(value: unknown, max: number) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

function buildDescription(product: ShopeeProduct) {
  const specs = Object.entries(product.specs || {})
    .slice(0, 30)
    .map(([key, value]) => `• ${cleanText(key, 80)}: ${cleanText(value, 180)}`)
  const lines = [
    cleanText(product.title, 180),
    '',
    'สินค้ามือสอง รูปถ่ายสินค้าจริงจาก AMPHON TRADING',
    `รหัสสินค้า: ${product.sku}`,
    product.brand ? `แบรนด์: ${product.brand}` : '',
    product.model ? `รุ่น: ${product.model}` : '',
    product.defects ? `ตำหนิ/สภาพ: ${cleanText(product.defects, 600)}` : '',
    product.warranty_until
      ? `ประกันถึง: ${cleanText(product.warranty_until, 80)}`
      : '',
    specs.length ? '' : '',
    ...specs,
    '',
    'สินค้ามีชิ้นเดียว สต๊อกยึดตามระบบ AMPHON System',
  ].filter(Boolean)
  return lines.join('\n').slice(0, 3000)
}

async function uploadShopeeImage(
  env: ShopeeEnv,
  connection: ShopeeConnectionSecret,
  sourceUrl: string,
) {
  const source = await fetch(sourceUrl)
  if (!source.ok) {
    throw new ShopeeError(`SHOPEE_SOURCE_IMAGE_${source.status}`, true)
  }
  const contentType = source.headers.get('content-type') || 'image/jpeg'
  if (!/^image\/(?:jpeg|jpg|png)/i.test(contentType)) {
    throw new ShopeeError('SHOPEE_IMAGE_TYPE_UNSUPPORTED', false)
  }
  const bytes = await source.arrayBuffer()
  if (!bytes.byteLength || bytes.byteLength > 10 * 1024 * 1024) {
    throw new ShopeeError('SHOPEE_IMAGE_SIZE_INVALID', false)
  }

  const form = new FormData()
  form.append(
    'image',
    new Blob([bytes], { type: contentType }),
    contentType.includes('png') ? 'image.png' : 'image.jpg',
  )
  form.append('scene', 'normal')

  const payload = await shopRequest(
    env,
    connection,
    '/api/v2/media_space/upload_image',
    { method: 'POST', body: form },
  )

  const list = payload?.response?.image_info_list
  const first = Array.isArray(list) ? list[0]?.image_info?.image_id : null
  const fallback = payload?.response?.image_info?.image_id
  const imageId = String(first || fallback || '')
  if (!imageId) throw new ShopeeError('SHOPEE_IMAGE_UPLOAD_NO_ID', true)
  return imageId
}

async function uploadProductImages(
  env: ShopeeEnv,
  connection: ShopeeConnectionSecret,
  images: ShopeeImage[],
) {
  const ids: string[] = []
  for (const image of images) {
    ids.push(await uploadShopeeImage(env, connection, image.public_url))
  }
  return ids
}

async function addShopeeItem(
  env: ShopeeEnv,
  connection: ShopeeConnectionSecret,
  bundle: Awaited<ReturnType<typeof loadProductBundle>>,
  imageIds: string[],
) {
  const { product, category, settings } = bundle
  const payload: Record<string, unknown> = {
    original_price: shopeePrice(product, settings),
    description: buildDescription(product),
    weight: Number(category.weight_kg),
    item_name: cleanText(product.title, 120),
    item_status: 'NORMAL',
    normal_stock: projectedStock(product),
    logistic_info: category.logistic_info,
    attribute_list: Array.isArray(category.attribute_list)
      ? category.attribute_list
      : [],
    category_id: Number(category.shopee_category_id),
    image: { image_id_list: imageIds },
    item_sku: cleanText(product.sku, 80),
    condition: settings.default_condition || 'USED',
  }
  if (category.dimension && Object.keys(category.dimension).length) {
    payload.dimension = category.dimension
  }
  if (category.brand && Object.keys(category.brand).length) {
    payload.brand = category.brand
  }

  const response = await shopRequest(
    env,
    connection,
    '/api/v2/product/add_item',
    { method: 'POST', body: JSON.stringify(payload) },
  )
  const itemId = Number(
    response?.response?.item_id ||
      response?.item_id ||
      response?.response?.item?.item_id ||
      0,
  )
  if (!Number.isFinite(itemId) || itemId <= 0) {
    throw new ShopeeError('SHOPEE_ADD_ITEM_NO_ITEM_ID', true)
  }
  return {
    itemId,
    price: Number(payload.original_price),
    stock: Number(payload.normal_stock),
    response,
  }
}

async function updateShopeeStock(
  env: ShopeeEnv,
  connection: ShopeeConnectionSecret,
  itemId: number,
  stock: number,
) {
  return shopRequest(
    env,
    connection,
    '/api/v2/product/update_stock',
    {
      method: 'POST',
      body: JSON.stringify({
        item_id: itemId,
        stock_list: [{ model_id: 0, normal_stock: stock }],
      }),
    },
  )
}

async function upsertProductMapping(
  env: ShopeeEnv,
  args: {
    productId: string
    shopId: number
    itemId: number
    sellerSku: string
    categoryId: number
    title: string
    price: number
    stock: number
    imageIds: string[]
  },
) {
  await serviceRest(
    env,
    'shopee_product_mappings?on_conflict=shop_id,product_id',
    {
      method: 'POST',
      headers: {
        prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({
        product_id: args.productId,
        shop_id: args.shopId,
        shopee_item_id: args.itemId,
        seller_sku: args.sellerSku,
        shopee_category_id: args.categoryId,
        published_title: args.title,
        published_price: args.price,
        projection_stock: args.stock,
        image_ids: args.imageIds,
        status: 'PUBLISHED',
        last_error: null,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    },
  )
}

async function loadExistingMapping(
  env: ShopeeEnv,
  productId: string,
  shopId: number,
) {
  const rows = await serviceRest<ShopeeProductMapping[]>(
    env,
    `shopee_product_mappings?product_id=eq.${encodeURIComponent(productId)}&shop_id=eq.${shopId}&select=*&limit=1`,
  )
  return rows[0] || null
}

async function processQueueClaim(
  env: ShopeeEnv,
  claim: ShopeeQueueClaim,
) {
  const connection = await getConnection(env, Number(claim.shop_id))
  const bundle = await loadProductBundle(env, claim.product_id)
  const existing = await loadExistingMapping(
    env,
    claim.product_id,
    Number(claim.shop_id),
  )

  if (claim.action === 'CREATE') {
    if (existing?.shopee_item_id && existing.status === 'PUBLISHED') {
      const stock = projectedStock(bundle.product)
      const response = await updateShopeeStock(
        env,
        connection,
        Number(existing.shopee_item_id),
        stock,
      )
      await serviceRest(
        env,
        `shopee_product_mappings?id=eq.${encodeURIComponent(existing.id)}`,
        {
          method: 'PATCH',
          headers: { prefer: 'return=minimal' },
          body: JSON.stringify({
            projection_stock: stock,
            last_synced_at: new Date().toISOString(),
            last_error: null,
            updated_at: new Date().toISOString(),
          }),
        },
      )
      return { mode: 'existing', stock, response }
    }

    const imageIds = await uploadProductImages(env, connection, bundle.images)
    const result = await addShopeeItem(env, connection, bundle, imageIds)
    await upsertProductMapping(env, {
      productId: bundle.product.id,
      shopId: Number(claim.shop_id),
      itemId: result.itemId,
      sellerSku: bundle.product.sku,
      categoryId: Number(bundle.category.shopee_category_id),
      title: bundle.product.title,
      price: result.price,
      stock: result.stock,
      imageIds,
    })
    return {
      mode: 'created',
      itemId: result.itemId,
      stock: result.stock,
      price: result.price,
    }
  }

  if (!existing?.shopee_item_id) {
    if (claim.action === 'STOCK_SYNC' || claim.action === 'END') {
      return { mode: 'no_mapping' }
    }
    throw new ShopeeError('SHOPEE_ITEM_MAPPING_REQUIRED', false)
  }

  if (claim.action === 'STOCK_SYNC' || claim.action === 'END') {
    const stock = claim.action === 'END' ? 0 : projectedStock(bundle.product)
    const response = await updateShopeeStock(
      env,
      connection,
      Number(existing.shopee_item_id),
      stock,
    )
    await serviceRest(
      env,
      `shopee_product_mappings?id=eq.${encodeURIComponent(existing.id)}`,
      {
        method: 'PATCH',
        headers: { prefer: 'return=minimal' },
        body: JSON.stringify({
          projection_stock: stock,
          status: claim.action === 'END' ? 'ENDED' : existing.status,
          last_synced_at: new Date().toISOString(),
          last_error: null,
          updated_at: new Date().toISOString(),
        }),
      },
    )
    return { mode: claim.action.toLowerCase(), stock, response }
  }

  throw new ShopeeError('SHOPEE_UPDATE_NOT_IMPLEMENTED', false)
}


function shopeeOrderSn(payload: any) {
  return cleanText(
    payload?.data?.ordersn
      || payload?.data?.order_sn
      || payload?.ordersn
      || payload?.order_sn,
    80,
  )
}

async function fetchShopeeOrderDetail(
  env: ShopeeEnv,
  connection: ShopeeConnectionSecret,
  orderSn: string,
): Promise<ShopeeOrderDetail> {
  const payload = await shopRequest(
    env,
    connection,
    '/api/v2/order/get_order_detail',
    { method: 'GET' },
    {
      order_sn_list: orderSn,
      request_order_status_pending: 'true',
      response_optional_fields:
        'item_list,pay_time,payment_method,total_amount,shipping_carrier',
    },
  )
  const order = Array.isArray(payload?.response?.order_list)
    ? payload.response.order_list[0]
    : null
  if (!order?.order_sn) {
    throw new ShopeeError('SHOPEE_ORDER_DETAIL_MISSING', true)
  }
  return order as ShopeeOrderDetail
}

function normalizeOrderItems(order: ShopeeOrderDetail) {
  return (Array.isArray(order.item_list) ? order.item_list : [])
    .map((item) => {
      const sku = cleanText(item.model_sku || item.item_sku, 80).toUpperCase()
      const quantity = Number(item.model_quantity_purchased || 1)
      const unitPrice = Number(
        item.model_discounted_price
          || item.model_original_price
          || 0,
      )
      return { sku, quantity, unitPrice }
    })
    .filter((item) => Boolean(item.sku))
}

async function publishedShopeeSkus(
  env: ShopeeEnv,
  shopId: number,
) {
  const rows = await serviceRest<Array<{
    seller_sku: string
    published_price?: number | string | null
  }>>(
    env,
    `shopee_product_mappings?shop_id=eq.${shopId}&status=eq.PUBLISHED&select=seller_sku,published_price`,
  )
  return new Map(
    rows.map((row) => [
      cleanText(row.seller_sku, 80).toUpperCase(),
      Number(row.published_price || 0),
    ]),
  )
}

function systemActionForOrder(status: string) {
  const normalized = cleanText(status, 40).toUpperCase()
  if (normalized === 'CANCELLED') return 'RELEASE' as const
  if (normalized === 'COMPLETED') return 'CONFIRM_SOLD' as const
  return 'RESERVE' as const
}

function assertSystemResult(
  result: One4SystemStockResult,
  action: 'RESERVE' | 'RELEASE' | 'CONFIRM_SOLD',
) {
  if (result.ok || result.duplicate) return
  const permanent =
    result.outcome === 'CONFLICT'
    || result.outcome === 'REJECTED'
  throw new ShopeeError(
    `SHOPEE_SYSTEM_${action}_FAILED:${result.outcome || ''}:${result.errorCode || ''}`,
    !permanent,
  )
}

async function saveShopeeOrderSync(
  env: ShopeeEnv,
  input: {
    shopId: number
    orderSn: string
    orderStatus: string
    skus: string[]
    systemAction: string
    result: One4SystemStockResult
    eventTime?: number | null
  },
) {
  await serviceRest(
    env,
    'shopee_order_syncs?on_conflict=shop_id,order_sn',
    {
      method: 'POST',
      headers: {
        prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({
        shop_id: input.shopId,
        order_sn: input.orderSn,
        order_status: input.orderStatus,
        skus: input.skus,
        system_action: input.systemAction,
        system_outcome: input.result.outcome || null,
        system_response: input.result,
        last_error: input.result.ok || input.result.duplicate
          ? null
          : input.result.errorCode || input.result.outcome || 'SYSTEM_FAILED',
        last_event_at: input.eventTime
          ? new Date(input.eventTime * 1000).toISOString()
          : new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    },
  )
}

async function processShopeeOrderEvent(
  env: ShopeeEnv,
  claim: ShopeeOrderEventClaim,
) {
  const orderSn = shopeeOrderSn(claim.payload)
  if (!orderSn) {
    throw new ShopeeError('SHOPEE_ORDER_SN_MISSING', false)
  }

  const connection = await getConnection(env, Number(claim.shop_id))
  const order = await fetchShopeeOrderDetail(env, connection, orderSn)
  const channelSkus = await publishedShopeeSkus(env, Number(claim.shop_id))
  const items = normalizeOrderItems(order).filter((item) =>
    channelSkus.has(item.sku),
  )

  if (!items.length) {
    return {
      ignored: true,
      orderSn,
      reason: 'NO_AMPHON_SKU',
    }
  }

  const invalidQuantity = items.find((item) => item.quantity !== 1)
  if (invalidQuantity) {
    throw new ShopeeError(
      `SHOPEE_ORDER_QUANTITY_INVALID:${invalidQuantity.sku}:${invalidQuantity.quantity}`,
      false,
    )
  }

  const skus = [...new Set(items.map((item) => item.sku))].sort()
  const checkoutIdempotencyKey =
    `shopee:${claim.shop_id}:${orderSn}`
  const action = systemActionForOrder(order.order_status)
  let result: One4SystemStockResult

  if (action === 'RELEASE') {
    result = await releaseOne4SystemStock(env, {
      checkoutIdempotencyKey,
      skus,
      reason: 'SHOPEE_ORDER_CANCELLED',
    })
    assertSystemResult(result, action)
  } else if (action === 'CONFIRM_SOLD') {
    const reserveResult = await reserveOne4SystemStock(env, {
      checkoutIdempotencyKey,
      skus,
      expiresAt: new Date(
        Date.now() + 30 * 24 * 60 * 60 * 1000,
      ).toISOString(),
    })
    if (!reserveResult.ok && !reserveResult.duplicate) {
      assertSystemResult(reserveResult, 'RESERVE')
    }

    result = await confirmOne4SystemSale(env, {
      checkoutIdempotencyKey,
      orderId: `shopee:${orderSn}`,
      skus,
      saleItems: items.map((item) => ({
        sku: item.sku,
        unitPrice:
          item.unitPrice
          || channelSkus.get(item.sku)
          || 0,
      })),
      paymentProvider: 'SHOPEE',
      paymentReference: orderSn,
      paidAt: new Date(
        Number(order.pay_time || order.update_time || order.create_time || Math.floor(Date.now() / 1000))
          * 1000,
      ).toISOString(),
    })
    assertSystemResult(result, action)
  } else {
    result = await reserveOne4SystemStock(env, {
      checkoutIdempotencyKey,
      skus,
      expiresAt: new Date(
        Date.now() + 30 * 24 * 60 * 60 * 1000,
      ).toISOString(),
    })
    assertSystemResult(result, action)
  }

  await saveShopeeOrderSync(env, {
    shopId: Number(claim.shop_id),
    orderSn,
    orderStatus: cleanText(order.order_status, 40).toUpperCase(),
    skus,
    systemAction: action,
    result,
    eventTime:
      Number(claim.payload?.data?.update_time || order.update_time || 0)
      || null,
  })

  return {
    ignored: false,
    orderSn,
    orderStatus: order.order_status,
    action,
    skus,
    outcome: result.outcome,
    duplicate: Boolean(result.duplicate),
  }
}

export async function runShopeeOrderSweep(env: ShopeeEnv) {
  if (!configured(env)) return { skipped: 'SHOPEE_NOT_CONFIGURED' }

  const workerId = `shopee-order:${crypto.randomUUID()}`
  const claims = await serviceRpc<ShopeeOrderEventClaim[]>(
    env,
    'claim_shopee_order_events',
    { p_worker_id: workerId, p_limit: 10 },
  )

  let completed = 0
  let ignored = 0
  let failed = 0

  for (const claim of Array.isArray(claims) ? claims : []) {
    try {
      const result = await processShopeeOrderEvent(env, claim)
      await serviceRpc(env, 'complete_shopee_order_event', {
        p_event_id: claim.id,
        p_worker_id: workerId,
        p_status: result.ignored ? 'IGNORED' : 'DONE',
      })
      if (result.ignored) ignored += 1
      else completed += 1
    } catch (error) {
      failed += 1
      const retryable =
        error instanceof ShopeeError ? error.retryable : true
      const message =
        error instanceof Error ? error.message : String(error)

      await serviceRpc(env, 'fail_shopee_order_event', {
        p_event_id: claim.id,
        p_worker_id: workerId,
        p_error: message.slice(0, 1500),
        p_retryable: retryable,
      }).catch((markError) => {
        console.error('SHOPEE order event fail marker error', {
          eventId: claim.id,
          markError,
        })
      })

      console.error('SHOPEE order event failed', {
        eventId: claim.id,
        shopId: claim.shop_id,
        error: message,
      })
    }
  }

  return {
    claimed: Array.isArray(claims) ? claims.length : 0,
    completed,
    ignored,
    failed,
  }
}

export async function runShopeePublishSweep(env: ShopeeEnv) {
  if (!configured(env)) return { skipped: 'SHOPEE_NOT_CONFIGURED' }
  const workerId = `shopee:${crypto.randomUUID()}`
  const claims = await serviceRpc<ShopeeQueueClaim[]>(
    env,
    'claim_shopee_publish_queue',
    { p_worker_id: workerId, p_limit: 5 },
  )

  let completed = 0
  let failed = 0

  for (const claim of Array.isArray(claims) ? claims : []) {
    try {
      const result = await processQueueClaim(env, claim)
      await serviceRpc(env, 'complete_shopee_publish_queue', {
        p_queue_id: claim.id,
        p_worker_id: workerId,
        p_response: result,
      })
      completed += 1
    } catch (error) {
      failed += 1
      const retryable =
        error instanceof ShopeeError ? error.retryable : true
      const message =
        error instanceof Error ? error.message : String(error)
      await serviceRpc(env, 'fail_shopee_publish_queue', {
        p_queue_id: claim.id,
        p_worker_id: workerId,
        p_error: message.slice(0, 1500),
        p_retryable: retryable,
      }).catch((markError) => {
        console.error('SHOPEE queue fail marker error', {
          queueId: claim.id,
          markError,
        })
      })
      console.error('SHOPEE queue item failed', {
        queueId: claim.id,
        productId: claim.product_id,
        action: claim.action,
        error: message,
      })
    }
  }

  return {
    claimed: Array.isArray(claims) ? claims.length : 0,
    completed,
    failed,
  }
}

async function getConnectionStatus(env: ShopeeEnv) {
  const [connections, settings, queue, categoryMappings, productMappings] =
    await Promise.all([
      serviceRest<any[]>(
        env,
        'shopee_connections?select=id,shop_id,merchant_id,region,status,access_expires_at,refresh_expires_at,authorization_expires_at,last_refresh_at,last_error,created_at,updated_at&order=updated_at.desc',
      ),
      serviceRest<any[]>(env, 'shopee_settings?id=eq.1&select=*&limit=1'),
      serviceRest<any[]>(
        env,
        'shopee_publish_queue?select=status,action&order=created_at.desc&limit=500',
      ),
      serviceRest<any[]>(
        env,
        'shopee_category_mappings?active=eq.true&select=id',
      ),
      serviceRest<any[]>(
        env,
        'shopee_product_mappings?status=eq.PUBLISHED&select=id',
      ),
    ])
  return {
    configured: configured(env),
    connections: connections.map((row) => ({
      id: row.id,
      shopId: Number(row.shop_id),
      merchantId: row.merchant_id == null ? null : Number(row.merchant_id),
      region: row.region,
      status: row.status,
      accessExpiresAt: row.access_expires_at,
      refreshExpiresAt: row.refresh_expires_at,
      authorizationExpiresAt: row.authorization_expires_at,
      lastRefreshAt: row.last_refresh_at,
      lastError: row.last_error,
      updatedAt: row.updated_at,
    })),
    settings: settings[0]
      ? {
          autoPublishEnabled: Boolean(settings[0].auto_publish_enabled),
          publishDelaySeconds: Number(settings[0].publish_delay_seconds || 60),
          priceMarkupPercent: Number(settings[0].price_markup_percent || 0),
        }
      : null,
    queue: {
      pending: queue.filter((row) => row.status === 'PENDING').length,
      processing: queue.filter((row) => row.status === 'PROCESSING').length,
      failed: queue.filter((row) => row.status === 'FAILED').length,
    },
    mappings: {
      categories: categoryMappings.length,
      publishedProducts: productMappings.length,
    },
  }
}

async function createAuthorizationUrl(
  request: Request,
  env: ShopeeEnv,
) {
  const actor = await authenticateAdmin(request, env)
  const cfg = requiredConfig(env)
  const state = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '')
  await serviceRpc(env, 'shopee_create_auth_state', {
    p_state: state,
    p_actor_id: actor.userId,
  })
  const url = new URL(cfg.authUrl)
  url.searchParams.set('partner_id', String(cfg.partnerId))
  url.searchParams.set('auth_type', 'seller')
  url.searchParams.set('redirect_uri', cfg.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('state', state)
  return url.toString()
}

async function handleCallback(
  request: Request,
  env: ShopeeEnv,
  url: URL,
) {
  const cfg = requiredConfig(env)
  const code = String(url.searchParams.get('code') || '')
  const state = String(url.searchParams.get('state') || '')
  const shopId = Number(url.searchParams.get('shop_id') || 0)
  if (!code || !state || !Number.isInteger(shopId) || shopId <= 0) {
    return new Response('Shopee callback invalid', { status: 400 })
  }

  await serviceRpc(env, 'shopee_consume_auth_state', { p_state: state })
  await exchangeAuthorizationCode(env, code, shopId)
  const queued = await serviceRpc<number>(
    env,
    'seed_shopee_publish_queue',
    { p_shop_id: shopId },
  ).catch(() => 0)

  const redirect = new URL(cfg.hubRedirect)
  redirect.searchParams.set('shopee', 'connected')
  redirect.searchParams.set('shop_id', String(shopId))
  redirect.searchParams.set('queued', String(Number(queued || 0)))
  return Response.redirect(redirect.toString(), 302)
}

async function verifyShopeePush(
  request: Request,
  env: ShopeeEnv,
  rawBody: string,
) {
  const cfg = requiredConfig(env)
  const supplied = String(request.headers.get('authorization') || '').toLowerCase()
  if (!supplied) return false
  const expected = await hmacHex(
    cfg.partnerKey,
    `${request.url}|${rawBody}`,
  )
  if (expected.length !== supplied.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ supplied.charCodeAt(i)
  }
  return diff === 0
}

async function handleShopeeWebhook(
  request: Request,
  env: ShopeeEnv,
) {
  if (!configured(env)) return new Response(null, { status: 503 })
  const raw = await request.text()
  if (!(await verifyShopeePush(request, env, raw))) {
    return new Response(null, { status: 401 })
  }
  let payload: any
  try {
    payload = JSON.parse(raw)
  } catch {
    return new Response(null, { status: 400 })
  }
  const eventHash = await sha256Hex(`${request.url}|${raw}`)
  await serviceRest(env, 'shopee_webhook_events?on_conflict=event_hash', {
    method: 'POST',
    headers: { prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({
      event_hash: eventHash,
      shop_id: Number(payload?.shop_id || 0) || null,
      code: Number(payload?.code || 0) || null,
      payload,
    }),
  })
  return new Response(null, { status: 204 })
}

async function discovery(
  env: ShopeeEnv,
  shopId: number,
  kind: 'categories' | 'logistics' | 'attributes',
  categoryIds?: string,
) {
  const connection = await getConnection(env, shopId)
  if (kind === 'categories') {
    return shopRequest(
      env,
      connection,
      '/api/v2/product/get_category',
      { method: 'GET' },
      { language: 'th' },
    )
  }
  if (kind === 'logistics') {
    return shopRequest(
      env,
      connection,
      '/api/v2/logistics/get_channel_list',
      { method: 'GET' },
    )
  }
  const ids = String(categoryIds || '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => /^\d+$/.test(value))
    .slice(0, 20)
    .join(',')
  if (!ids) throw new ShopeeError('SHOPEE_CATEGORY_IDS_REQUIRED', false)
  return shopRequest(
    env,
    connection,
    '/api/v2/product/get_attribute_tree',
    { method: 'GET' },
    { category_ids: ids, language: 'th' },
  )
}

async function saveCategoryMapping(
  request: Request,
  env: ShopeeEnv,
) {
  const actor = await authenticateAdmin(request, env)
  const body = (await request.json().catch(() => ({}))) as any
  const sourceCategory = cleanText(body.sourceCategory, 80)
  const sourceSubtype = cleanText(body.sourceSubtype, 80) || null
  const categoryId = Number(body.shopeeCategoryId || 0)
  const weightKg = Number(body.weightKg || 0)
  if (!sourceCategory || !Number.isInteger(categoryId) || categoryId <= 0) {
    throw new ShopeeError('SHOPEE_MAPPING_INVALID', false)
  }
  if (!Number.isFinite(weightKg) || weightKg <= 0) {
    throw new ShopeeError('SHOPEE_MAPPING_WEIGHT_REQUIRED', false)
  }
  if (!Array.isArray(body.logisticInfo) || !body.logisticInfo.length) {
    throw new ShopeeError('SHOPEE_MAPPING_LOGISTICS_REQUIRED', false)
  }

  const existing = await serviceRest<any[]>(
    env,
    `shopee_category_mappings?source_category=eq.${encodeURIComponent(sourceCategory)}&active=eq.true&select=id,source_subtype`,
  )
  const same = existing.find(
    (row) => (row.source_subtype || null) === sourceSubtype,
  )
  const payload = {
    source_category: sourceCategory,
    source_subtype: sourceSubtype,
    shopee_category_id: categoryId,
    shopee_category_name: cleanText(body.shopeeCategoryName, 180) || null,
    attribute_list: Array.isArray(body.attributeList) ? body.attributeList : [],
    logistic_info: body.logisticInfo,
    weight_kg: weightKg,
    dimension:
      body.dimension && typeof body.dimension === 'object'
        ? body.dimension
        : null,
    brand:
      body.brand && typeof body.brand === 'object' ? body.brand : null,
    active: true,
    reviewed_at: new Date().toISOString(),
    reviewed_by: actor.userId,
    updated_at: new Date().toISOString(),
  }

  if (same?.id) {
    await serviceRest(
      env,
      `shopee_category_mappings?id=eq.${encodeURIComponent(same.id)}`,
      {
        method: 'PATCH',
        headers: { prefer: 'return=minimal' },
        body: JSON.stringify(payload),
      },
    )
  } else {
    await serviceRest(env, 'shopee_category_mappings', {
      method: 'POST',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify(payload),
    })
  }

  const connections = await serviceRest<any[]>(
    env,
    'shopee_connections?status=eq.CONNECTED&select=shop_id',
  )
  let queued = 0
  for (const connection of connections) {
    queued += Number(
      await serviceRpc(env, 'seed_shopee_publish_queue', {
        p_shop_id: Number(connection.shop_id),
      }).catch(() => 0),
    )
  }
  return { ok: true, queued }
}

export async function handleShopeeRoutes(
  request: Request,
  env: ShopeeEnv,
  url: URL,
): Promise<Response | null> {
  if (
    url.pathname !== '/webhooks/shopee' &&
    !url.pathname.startsWith('/shopee')
  ) {
    return null
  }

  if (request.method === 'POST' && url.pathname === '/webhooks/shopee') {
    return handleShopeeWebhook(request, env)
  }

  if (request.method === 'GET' && url.pathname === '/shopee/callback') {
    try {
      return await handleCallback(request, env, url)
    } catch (error) {
      const cfg = configured(env) ? requiredConfig(env) : null
      if (cfg) {
        const redirect = new URL(cfg.hubRedirect)
        redirect.searchParams.set('shopee', 'error')
        redirect.searchParams.set(
          'message',
          error instanceof Error ? error.message.slice(0, 180) : 'unknown',
        )
        return Response.redirect(redirect.toString(), 302)
      }
      return new Response('Shopee authorization failed', { status: 500 })
    }
  }

  if (request.method === 'GET' && url.pathname === '/shopee/status') {
    await authenticateAdmin(request, env)
    return Response.json(await getConnectionStatus(env), {
      headers: { 'cache-control': 'no-store' },
    })
  }

  if (request.method === 'POST' && url.pathname === '/shopee/auth/start') {
    const authorizationUrl = await createAuthorizationUrl(request, env)
    return Response.json({ authorizationUrl }, {
      headers: { 'cache-control': 'no-store' },
    })
  }

  if (request.method === 'POST' && url.pathname === '/shopee/queue/seed') {
    await authenticateAdmin(request, env)
    const body = (await request.json().catch(() => ({}))) as any
    const shopId = Number(body.shopId || 0)
    if (!Number.isInteger(shopId) || shopId <= 0) {
      throw new ShopeeError('SHOPEE_SHOP_ID_REQUIRED', false)
    }
    const queued = await serviceRpc<number>(
      env,
      'seed_shopee_publish_queue',
      { p_shop_id: shopId },
    )
    return Response.json({ queued: Number(queued || 0) })
  }

  if (request.method === 'GET' && url.pathname === '/shopee/discovery') {
    await authenticateAdmin(request, env)
    const shopId = Number(url.searchParams.get('shop_id') || 0)
    const kind = String(url.searchParams.get('kind') || '') as
      | 'categories'
      | 'logistics'
      | 'attributes'
    if (!Number.isInteger(shopId) || shopId <= 0) {
      throw new ShopeeError('SHOPEE_SHOP_ID_REQUIRED', false)
    }
    if (!['categories', 'logistics', 'attributes'].includes(kind)) {
      throw new ShopeeError('SHOPEE_DISCOVERY_KIND_INVALID', false)
    }
    const data = await discovery(
      env,
      shopId,
      kind,
      url.searchParams.get('category_ids') || undefined,
    )
    return Response.json(data, {
      headers: { 'cache-control': 'no-store' },
    })
  }

  if (request.method === 'POST' && url.pathname === '/shopee/mappings') {
    return Response.json(await saveCategoryMapping(request, env))
  }

  return Response.json({ error: 'Not found' }, { status: 404 })
}
