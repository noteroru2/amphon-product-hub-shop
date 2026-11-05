import {supabase} from './supabase';
export type NotebookGapRule={
 key:string;category:'NOTEBOOK_GAMING'|'NOTEBOOK_GENERAL'|'NOTEBOOK_BUSINESS'|'MACBOOK';
 cpu:string;gpu:string;condition_key:'NORMAL';opening_min:number|null;opening_max:number|null;
 review_type:'RANGE'|'PER_MODEL';sample_count:number;evidence:string[];notes:string;risk:'HIGH'|'CAUTION'|'NORMAL';
 source:string;
};
export type NotebookGapBatch={
 id:string;draft_id:string;title:string;status:'PENDING'|'APPROVED_DRAFT'|'DISMISSED';
 analysis_note:string;rules:NotebookGapRule[];created_at:string;reviewed_at:string|null;
};
export async function listNotebookGapBatches():Promise<NotebookGapBatch[]>{
 if(!supabase)throw new Error('ไม่ได้เชื่อมต่อ Supabase');
 const {data,error}=await supabase.from('ai_buyer_notebook_gap_rule_batches')
 .select('id,draft_id,title,status,analysis_note,rules,created_at,reviewed_at')
 .order('created_at',{ascending:false}).limit(10);
 if(error)throw new Error(error.message);
 return (data??[]) as NotebookGapBatch[];
}
export async function decideNotebookGapBatch(id:string,action:'APPROVE_DRAFT'|'DISMISS'):Promise<string>{
 if(!supabase)throw new Error('ไม่ได้เชื่อมต่อ Supabase');
 const {data,error}=await supabase.rpc('ai_buyer_notebook_gap_rule_decide',{p_batch_id:id,p_action:action});
 if(error)throw new Error(error.message);
 return String(data);
}