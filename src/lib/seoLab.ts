import { supabase } from './supabase'
export interface ContentJob { id:number; site_id:string; page:string; focus_query:string; status:string; draft_body:string; approved_body:string|null; evidence_id:number|null; approved_at:string|null; published_at:string|null; publication_url:string|null; render_error?:string|null; render_requested_at?:string|null }
export interface ContentEvidence {id:number;job_id:number;source_url:string;source_at:string;page_title:string|null;excerpt:string;source_hash:string}
export interface ContentMeasurement {job_id:number;checkpoint_days:number;verdict:string;next_at:string;last_error:string|null;before_data:{clicks:number;impressions:number;position:number|null}|null;after_data:{clicks:number;impressions:number;position:number|null}|null;windows:unknown}
export interface AiPrompt {id:number;prompt:string;provider_setup:string}
export interface AiSample {id:number;prompt_id:number;provider:string;observed_at:string;evidence_url:string;mentioned:boolean|null;run_status:string;citations:string[];cited_sites:string[];source_kind:string}
export interface ContactEvent {id:string;token:string;site_id:string;page:string;source_channel:string;created_at:string;confirmed_lead:boolean;lead_reference:string|null;sale_id:string|null;sku:string|null;actual_profit:number|null;actual_unit_price:number|null;quantity:number|null;attribution_status:string}
export interface SaleChoice {id:string;sku:string;sold_at:string;actual_profit:number|null}
export async function loadSeoLab() {
 if(!supabase) throw new Error('ยังไม่ได้เชื่อมฐานข้อมูล')
 const results=await Promise.all([
 supabase.from('commerce_seo_content_jobs').select('*').order('id',{ascending:false}).limit(100),
 supabase.from('commerce_seo_content_evidence').select('*').order('id',{ascending:false}).limit(150),
 supabase.from('commerce_seo_content_measurements').select('*').order('job_id',{ascending:false}).limit(300),
 supabase.from('commerce_seo_ai_prompts').select('*').order('id'),
 supabase.from('commerce_seo_ai_samples').select('*').gte('observed_at',new Date(Date.now()-30*86400000).toISOString()).order('observed_at',{ascending:false}).limit(500),
 supabase.from('commerce_seo_attribution_v').select('*').gte('created_at',new Date(Date.now()-30*86400000).toISOString()).order('created_at',{ascending:false}).limit(300),
 supabase.from('distribution_sale_outcomes').select('id,sku,sold_at,actual_profit').not('source_event_id','is',null).order('sold_at',{ascending:false}).limit(100),
 ])
 for(const r of results) if(r.error) throw new Error(r.error.message)
 return {jobs:(results[0].data||[]) as ContentJob[],evidence:(results[1].data||[]) as ContentEvidence[],measurements:(results[2].data||[]) as ContentMeasurement[],prompts:(results[3].data||[]) as AiPrompt[],samples:(results[4].data||[]) as AiSample[],contacts:(results[5].data||[]) as ContactEvent[],sales:(results[6].data||[]) as SaleChoice[]}
}
export async function manageSeoLab(action:string,data:Record<string,unknown>) {
 if(!supabase) throw new Error('ยังไม่ได้เชื่อมฐานข้อมูล')
 const result=await supabase.rpc('seo_lab_manage',{p_action:action,p_data:data})
 if(result.error) throw new Error(result.error.message); return result.data
}
export async function runSeoWorkbench(action:string,data:Record<string,unknown>) {
 if(!supabase) throw new Error('ยังไม่ได้เชื่อมฐานข้อมูล')
 const result=await supabase.functions.invoke('seo-workbench',{body:{action,...data}})
 if(result.error) { const context=(result.error as {context?:Response}).context; if(context) { const body=await context.json().catch(()=>null); if(body?.error) throw new Error(body.error) }; throw new Error(result.error.message) }
 if(result.data?.error) throw new Error(result.data.error);return result.data
}
