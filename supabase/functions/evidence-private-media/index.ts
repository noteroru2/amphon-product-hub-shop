import {createPrivateMediaHandler} from '../_shared/evidence-private-media.mjs'
Deno.serve(createPrivateMediaHandler({url:Deno.env.get('SUPABASE_URL'),key:Deno.env.get('SUPABASE_ANON_KEY'),
 allowedOrigin:Deno.env.get('EVIDENCE_MEDIA_ORIGIN')||'https://hub.amphon.co.th'}))
