import {supabase} from './supabase';
export type OfficeNotebookRule={
 key:string;category:'NOTEBOOK_GENERAL';family:string;cpu:string;gpu:'INTEGRATED_ONLY';
 ram_gb:number;ssd_gb:number[];condition_key:'NORMAL';
 opening_min:number|null;opening_max:number|null;review_type:'RANGE'|'PER_MODEL';
 caution:string;notes:string;
};
export type OfficeNotebookRuleBatch={
 id:string;draft_id:string;title:string;status:'PENDING'|'APPROVED_DRAFT'|'DISMISSED';
 analysis_note:string;rules:OfficeNotebookRule[];created_at:string;reviewed_at:string|null;
};
export async function listOfficeNotebookRules():Promise<OfficeNotebookRuleBatch[]>{
 if(!supabase)throw new Error('ไม่ได้เชื่อมต่อ Supabase');
 const {data,error}=await supabase.from('ai_buyer_office_notebook_rule_batches')
 .select('id,draft_id,title,status,analysis_note,rules,created_at,reviewed_at')
 .order('created_at',{ascending:false}).limit(10);
 if(error)throw new Error(error.message);
 return (data??[]) as OfficeNotebookRuleBatch[];
}
export async function decideOfficeNotebookRules(id:string,action:'APPROVE_DRAFT'|'DISMISS'):Promise<string>{
 if(!supabase)throw new Error('ไม่ได้เชื่อมต่อ Supabase');
 const {data,error}=await supabase.rpc('ai_buyer_office_notebook_rule_decide',{p_batch_id:id,p_action:action});
 if(error)throw new Error(error.message);
 return String(data);
}