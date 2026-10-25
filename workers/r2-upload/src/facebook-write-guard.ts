type Env = { SUPABASE_URL: string; SUPABASE_SECRET_KEY: string }

export class FacebookWriteDeferred extends Error {
  constructor(public retryAt: string) { super('FACEBOOK_PAGE_COOLDOWN_UNTIL:' + retryAt) }
}

async function rpc(env: Env, name: string, body: object) {
  const response = await fetch(env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/rpc/' + name, {
    method: 'POST', headers: { apikey: env.SUPABASE_SECRET_KEY,
      authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error('FACEBOOK_WRITE_GUARD_DB_' + response.status)
  return response.json() as Promise<{token?: string; retry_at?: string}>
}

// One shared, atomic reservation for sold, price, catalogue and publishing work.
// The database keeps the cooldown across cron runs and worker instances.
export async function withFacebookPageWrite<T>(env: Env, key: string, write: () => Promise<T>): Promise<T> {
  const claim = await rpc(env, 'facebook_page_write_claim', { p_connection_key: key })
  if (!claim?.token) throw new FacebookWriteDeferred(String(claim?.retry_at || 'pending'))
  let result: T
  try { result = await write() }
  catch (error) {
    try {
      await rpc(env, 'facebook_page_write_result', { p_connection_key: key, p_token: claim.token,
        p_error: (error instanceof Error ? error.message : String(error)).slice(0, 800) })
    } catch { console.error('FACEBOOK_WRITE_BACKOFF_RECORD_FAILED', key) }
    throw error
  }
  // A failed completion write must never lose the ID of a successful publish.
  // The reservation still expires safely; the caller must persist its result.
  try {
    await rpc(env, 'facebook_page_write_result', { p_connection_key: key, p_token: claim.token, p_error: null })
  } catch { console.error('FACEBOOK_WRITE_COMPLETION_RECORD_FAILED', key) }
  return result
}
