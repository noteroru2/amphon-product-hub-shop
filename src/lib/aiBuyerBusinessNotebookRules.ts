import {supabase} from './supabase';
export type BusinessNotebookRule={
 key:string;category:'NOTEBOOK_BUSINESS';family:string;cpu:string;gpu:'INTEGRATED_ONLY';
 condition_key:'NORMAL';
 opening_min:number|null;opening_max:number|null;review_type:'RANGE'|'PER_MODEL';
 review:string;notes:string;
};
export type BusinessNotebookRuleBatch={
 id:string;draft_id:string;title:string;status:'PENDING'|'APPROVED_DRAFT'|'DISMISSED';
 analysis_note:string;rules:BusinessNotebookRule[];created_at:string;reviewed_at:string|null;
};
export async function listBusinessNotebookRules():Promise<BusinessNotebookRuleBatch[]>{
 if(!supabase)throw new Error('ไม่ได้เชื่อมต่อ Supabase');
 const {data,error}=await supabase.from('ai_buyer_business_notebook_rule_batches')
 .select('id,draft_id,title,status,analysis_note,rules,created_at,reviewed_at')
 .order('created_at',{ascending:false}).limit(10);
 if(error)throw new Error(error.message);
 return (data??[]) as BusinessNotebookRuleBatch[];
}
export async function decideBusinessNotebookRules(id:string,action:'APPROVE_DRAFT'|'DISMISS'):Promise<string>{
 if(!supabase)throw new Error('ไม่ได้เชื่อมต่อ Supabase');
 const {data,error}=await supabase.rpc('ai_buyer_business_notebook_rule_decide',{p_batch_id:id,p_action:action});
 if(error)throw new Error(error.message);
 return String(data);
}