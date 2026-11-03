import {supabase} from './supabase';
import {analyzeCostHistory,type CostHistoryRecord,type LearningReport} from './aiBuyerCostLearning';
import {applyCostSpecReviews,type CostSpecReview} from './aiBuyerCostReviewRules';
const selection='source_kind,source_key,inventory_code,product_name,category,source_type,source_status,buy_cost,actual_sale,actual_profit,quantity,occurred_at,details';

export async function loadCostLearningRecords():Promise<CostHistoryRecord[]>{
 if(!supabase)throw new Error('ไม่ได้ตั้งค่า Supabase');
 const all:CostHistoryRecord[]=[];
 for(let start=0;start<4000;start+=500){
  const {data,error}=await supabase.from('ai_buyer_cost_history').select(selection).order('id',{ascending:true}).range(start,start+499);
  if(error)throw new Error(error.message);
  if(!data?.length)break;
  all.push(...data as CostHistoryRecord[]);
  if(data.length<500)break;
 }
 if(all.length===4000)throw new Error('ข้อมูลประวัติเกินเพดานที่ตรวจได้ กรุณาเพิ่ม pagination');
 return all;
}

export async function loadCostSpecReviews():Promise<CostSpecReview[]>{
 if(!supabase)throw new Error('ไม่ได้ตั้งค่า Supabase');
 const {data,error}=await supabase.from('ai_buyer_cost_spec_reviews')
 .select('source_kind,source_key,source_name_snapshot,source_category_snapshot,reviewed_name,reviewed_category,review_note,reviewed_by,reviewed_at')
 .order('source_key').limit(2000);
 if(error)throw new Error(error.message);
 return (data??[]) as CostSpecReview[];
}

export async function loadCostLearningReport():Promise<LearningReport>{
 const [records,reviews]=await Promise.all([loadCostLearningRecords(),loadCostSpecReviews()]);
 return analyzeCostHistory(applyCostSpecReviews(records,reviews));
}
