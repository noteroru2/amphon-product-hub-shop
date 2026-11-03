import {supabase} from './supabase';
import {REVIEW_CATEGORIES,type ReviewCategory,type CostSpecReview} from './aiBuyerCostReviewRules';

export async function saveCostSpecReview(input:{
 sourceKey:string;sourceName:string;sourceCategory:string;
 reviewedName:string;reviewedCategory:ReviewCategory;note:string;
}):Promise<number>{
 if(!supabase)throw new Error('Supabase ไม่ได้เชื่อมต่อ');
 if(!REVIEW_CATEGORIES.includes(input.reviewedCategory)||input.reviewedName.trim().length<3||input.reviewedName.length>300||input.note.length>800)
  throw new Error('ข้อมูลตรวจสเปกไม่ครบหรือผิดรูปแบบ');
 const {data,error}=await supabase.rpc('ai_buyer_cost_spec_review_save',{
  p_source_key:input.sourceKey,p_source_name:input.sourceName,p_source_category:input.sourceCategory,
  p_reviewed_name:input.reviewedName.trim(),p_reviewed_category:input.reviewedCategory,p_note:input.note
 });
 if(error)throw new Error(error.message);
 return Number(data);
}
export async function revokeCostSpecReview(sourceKey:string):Promise<void>{
 if(!supabase)throw new Error('Supabase ไม่ได้เชื่อมต่อ');
 const {error}=await supabase.rpc('ai_buyer_cost_spec_review_revoke',{p_source_key:sourceKey});
 if(error)throw new Error(error.message);
}
export async function loadCostReviewAudit(sourceKey:string){
 if(!supabase)throw new Error('Supabase ไม่ได้เชื่อมต่อ');
 const {data,error}=await supabase.from('ai_buyer_cost_spec_review_audit')
 .select('source_key,actor_id,action,before_data,after_data,changed_at')
 .eq('source_kind','INVENTORY').eq('source_key',sourceKey)
 .order('changed_at',{ascending:false}).limit(30);
 if(error)throw new Error(error.message);
 return (data??[]) as {source_key:string;actor_id:string;action:string;before_data:CostSpecReview|null;after_data:CostSpecReview|null;changed_at:string}[];
}
