// Recover a navigation handled by an older PWA worker. The Edge Function owns
// the same OAuth request and is outside the Hub service worker's scope.
export function seoAuthorizationRecovery(location:{origin:string;pathname:string;search:string}):string|null {
 if(location.origin!=='https://hub.amphon.co.th'||location.pathname!=='/seo-connector/authorize')return null
 const params=new URLSearchParams(location.search)
 if(params.get('response_type')!=='code'||!params.get('client_id'))return null
 return 'https://mfpdtlxwdbxitgfzdape.supabase.co/functions/v1/seo-connector/authorize'+location.search
}
