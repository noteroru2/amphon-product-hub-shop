import { facebookPriceMessage } from './facebook-content'

type Env = { SUPABASE_URL: string; SUPABASE_SECRET_KEY: string }
type PriceCandidate = {
  id: string
  product_id: string
  connection_key: string
  post_id: string
  sku: string
  price: number | string
  one_pricing_updated_at: string
  price_sync_attempts: number
}

async function db<T>(env: Env, path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/' + path, {
    ...options,
    headers: {
      apikey: env.SUPABASE_SECRET_KEY,
      authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY,
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const body = await response.text()
  if (!response.ok) throw new Error('PRICE_SYNC_DATABASE_' + response.status + ':' + body.slice(0, 300))
  return body ? JSON.parse(body) as T : null as T
}

async function pageToken(env: Env, key: string) {
  const credentials = await db<{pageAccessToken?: string; pageId?: string}>(
    env, 'rpc/central_channel_read_credentials',
    {method: 'POST', body: JSON.stringify({p_channel_key: 'facebook_page', p_connection_key: key})},
  )
  if (!credentials?.pageAccessToken || !credentials.pageId) throw new Error('FACEBOOK_PRICE_PAGE_NOT_AUTHORIZED')
  return credentials.pageAccessToken
}

async function graphGetMessage(postId: string, token: string) {
  const response = await fetch('https://graph.facebook.com/v23.0/' + encodeURIComponent(postId) +
    '?' + new URLSearchParams({fields:'id,message',access_token:token}))
  const result = await response.json() as {id?:string;message?:string;error?:{message?:string}}
  if (!response.ok || result.error || String(result.id) !== postId) {
    throw new Error('FACEBOOK_PRICE_READ_FAILED:' + String(result.error?.message || response.status).slice(0, 250))
  }
  return String(result.message || '')
}

async function graphUpdateMessage(postId: string, token: string, message: string) {
  // Graph API POST to the known post ID: NEVER POST to /feed.
  const response = await fetch('https://graph.facebook.com/v23.0/' + encodeURIComponent(postId), {
    method: 'POST',
    headers: {'content-type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({message, access_token: token}),
  })
  const result = await response.json() as {success?:boolean;id?:string;error?:{message?:string}}
  if (!response.ok || result.error || (result.success !== true && result.id !== postId)) {
    throw new Error('FACEBOOK_PRICE_EDIT_FAILED:' + String(result.error?.message || response.status).slice(0, 250))
  }
}

async function markSynced(env: Env, candidate: PriceCandidate) {
  await db(env, 'facebook_post_ledger?id=eq.' + encodeURIComponent(candidate.id), {
    method: 'PATCH', headers: {prefer:'return=minimal'},
    body: JSON.stringify({
      price_synced_at: candidate.one_pricing_updated_at,
      price_sync_attempts: 0,
      price_sync_retry_at: null,
      price_sync_error: null,
      updated_at: new Date().toISOString(),
    }),
  })
}

async function markError(env: Env, candidate: PriceCandidate, error: unknown) {
  const attempts = Math.max(0, Number(candidate.price_sync_attempts) || 0) + 1
  const reason = (error instanceof Error ? error.message : String(error)).slice(0, 750)
  const needsReview = /FACEBOOK_PRICE_LINE_NOT_FOUND|FACEBOOK_PRICE_AMBIGUOUS|FACEBOOK_PRICE_SOLD_POST/.test(reason)
  const delay = needsReview ? 24 * 60 * 60 * 1000
    : Math.min(60 * 60 * 1000, 60_000 * (2 ** Math.min(6, attempts - 1)))
  await db(env, 'facebook_post_ledger?id=eq.' + encodeURIComponent(candidate.id), {
    method: 'PATCH', headers: {prefer:'return=minimal'},
    body: JSON.stringify({
      price_sync_attempts: attempts,
      price_sync_retry_at: new Date(Date.now() + delay).toISOString(),
      price_sync_error: reason,
      updated_at: new Date().toISOString(),
    }),
  })
}

async function currentAuthority(env: Env, candidate: PriceCandidate) {
  const rows = await db<Array<{
    price: number | string
    one_quick_sale_price: number | string | null
    one_stock_age_days: number | null
    one_dealer_eligibility: string | null
    one_pricing_updated_at: string | null
    one_availability: string
    status: string
  }>>(env, 'products?id=eq.' + encodeURIComponent(candidate.product_id) +
    '&select=price,one_quick_sale_price,one_stock_age_days,one_dealer_eligibility,one_pricing_updated_at,one_availability,status&limit=1')
  const current = rows?.[0]
  if (!current || !['IN_STOCK','RESERVED'].includes(current.one_availability)
     || !['ready_to_list','published','reserved'].includes(current.status)) return false
  // Product may have changed again since the candidate query. The next sweep
  // must use its newer revision, never overwrite it with the old price.
  const age = Number(current.one_stock_age_days || 0)
  const quick = Number(current.one_quick_sale_price || 0)
  const promotional = current.one_dealer_eligibility === 'CLEARANCE' || age > 60 || (age > 30 && age <= 45)
  const advertised = promotional && quick > 0 ? quick : Number(current.price)
  return advertised === Number(candidate.price)
    && current.one_pricing_updated_at === candidate.one_pricing_updated_at
}

export async function runFacebookPriceSyncSweep(env: Env) {
  const rows = await db<PriceCandidate[]>(env, 'rpc/facebook_price_sync_candidates', {
    method: 'POST', body: JSON.stringify({max_posts: 5}),
  })
  const results: Array<{sku: string; postId: string; status: string; error?: string}> = []
  for (const candidate of Array.isArray(rows) ? rows : []) {
    try {
      if (!await currentAuthority(env, candidate)) {
        results.push({sku:candidate.sku,postId:candidate.post_id,status:'STALE_OR_SOLD'})
        continue
      }
      const token = await pageToken(env, candidate.connection_key)
      const original = await graphGetMessage(candidate.post_id, token)
      const next = facebookPriceMessage(original, Number(candidate.price))
      if (next.changed) {
        // Recheck stock/price right before externally mutating the post.
        if (!await currentAuthority(env, candidate)) {
          results.push({sku:candidate.sku,postId:candidate.post_id,status:'STALE_OR_SOLD'})
          continue
        }
        await graphUpdateMessage(candidate.post_id, token, next.message)
        const verified = await graphGetMessage(candidate.post_id, token)
        if (verified !== next.message) throw new Error('FACEBOOK_PRICE_VERIFY_MISMATCH')
      }
      await markSynced(env, candidate)
      results.push({sku:candidate.sku,postId:candidate.post_id,status:next.changed?'UPDATED':'UNCHANGED'})
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('FACEBOOK PRICE SYNC failed', {sku:candidate.sku,postId:candidate.post_id,error:message.slice(0,500)})
      try {
        await markError(env, candidate, error)
      } catch (markError) {
        console.error('FACEBOOK PRICE SYNC failed to record retry', markError)
      }
      results.push({sku:candidate.sku,postId:candidate.post_id,status:'FAILED',error:message.slice(0,300)})
    }
  }
  return results
}
