import {supabase} from './supabase';
export type NotebookSpecOfferRule={
 key:string;category:'NOTEBOOK_GAMING';spec:string;cpu:string;gpu:string[];
 ram_gb:number[]|null;ssd_gb:number[]|null;
 opening_min:number;opening_max:number;review:'NORMAL'|'CAUTION'|'HIGH';note:string;
};
export type NotebookSpecOfferBatch={
 id:string;draft_id:string;title:string;rules:NotebookSpecOfferRule[];
 status:'PENDING'|'APPROVED_DRAFT'|'DISMISSED';analysis_note:string;
 created_at:string;reviewed_at:string|null;approved_by:string|null;
};
export async function listNotebookRuleBatches():Promise<NotebookSpecOfferBatch[]>{
 if(!supabase)throw new Error('Supabase ไม่ได้เชื่อมต่อ');
 const {data,error}=await supabase.from('ai_buyer_notebook_rule_batches')
 .select('id,draft_id,title,rules,status,analysis_note,created_at,reviewed_at,approved_by')
 .order('created_at',{ascending:false}).limit(25);
 if(error)throw new Error(error.message);
 return (data??[]) as NotebookSpecOfferBatch[];
}
export async function decideNotebookRuleBatch(batchId:string,action:'APPROVE_DRAFT'|'DISMISS'):Promise<string>{
 if(!supabase)throw new Error('Supabase ไม่ได้เชื่อมต่อ');
 const {data,error}=await supabase.rpc('ai_buyer_notebook_rule_decide',
  {p_batch_id:batchId,p_action:action});
 if(error)throw new Error(error.message);
 return String(data);
}
