/**
 * Supabase elevated server-side credentials — never expose to browser bundles.
 * New sb_secret_* keys MUST be sent only in apikey; legacy service_role JWT
 * additionally uses Authorization Bearer. See Supabase API key migration docs.
 */
export function evidenceServiceHeaders(key) {
 if(typeof key!=='string' || !key || key.startsWith('sb_publishable_'))
   throw Error('EVIDENCE_SUPABASE_SERVER_KEY_REQUIRED')
 if(key.startsWith('sb_secret_')) return {apikey:key}
 return {apikey:key,authorization:'Bearer '+key}
}
