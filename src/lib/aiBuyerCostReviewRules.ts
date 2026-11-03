import type {CostHistoryRecord} from './aiBuyerCostLearning';
import {extractStructuredSpecs} from './aiBuyerStructuredSpecs';

export const REVIEW_CATEGORIES=['NOTEBOOK','MACBOOK','DESKTOP_PC','SMARTPHONE','TABLET','CAMERA','OTHER'] as const;
export type ReviewCategory=(typeof REVIEW_CATEGORIES)[number];
export type CostSpecReview={
 source_kind:'INVENTORY';source_key:string;source_name_snapshot:string;source_category_snapshot:string;
 reviewed_name:string;reviewed_category:ReviewCategory;review_note:string;
 reviewed_by:string;reviewed_at:string;
};
export type CostReviewQueueEntry={
 source_key:string;product_name:string;category:string;source_type:string;
 condition:string;soldEvents:number;review:CostSpecReview|null;stale:boolean;
 proposedCategory:ReviewCategory|null;priority:'HIGH'|'MEDIUM'|'LOW';
 flags:string[];parsed:ReturnType<typeof extractStructuredSpecs>;
};
const categoryFromName=(name:string):ReviewCategory|null=>{
 const n=name.normalize('NFKC').toLowerCase();
 if(/\bmacbook\b|แมคบุ๊ค/.test(n))return 'MACBOOK';
 if(/\biphone\b|ไอโฟน/.test(n))return 'SMARTPHONE';
 if(/\bipad\b|ไอแพด/.test(n))return 'TABLET';
 if(/\b(?:eos|canon|fujifilm|fujinon|nikon|insta360|lumix)\b|กล้อง/.test(n))return 'CAMERA';
 if(/\b(?:pc gaming|pc ryzen|pc i[3579]|desktop|gaming pc|imac|mac mini|mac studio)\b/.test(n))return 'DESKTOP_PC';
 if(/\b(?:lenovo|asus|acer|dell|hp|msi|huawei)\b/.test(n)&&/\b(?:loq|legion|thinkpad|ideapad|vivobook|expertbook|tuf|rog|nitro|aspire|swift|latitude|inspiron|probook|victus|pavilion|matebook|modern|zbook)\b/.test(n))return 'NOTEBOOK';
 return null;
};
const categoryLabelToCanonical=(raw:string):ReviewCategory|null=>{
 const c=raw.trim().toLowerCase();
 if(['notebook','โน๊ตบุ๊ค','โน้ตบุ๊ก','laptop'].includes(c))return 'NOTEBOOK';
 if(['macbook','แมคบุ๊ค'].includes(c))return 'MACBOOK';
 if(['desktop_pc','คอมตั้งโต๊ะ'].includes(c))return 'DESKTOP_PC';
 if(['smartphone','โทรศัพท์มือถือ','โทรศัพท์'].includes(c))return 'SMARTPHONE';
 if(['tablet','แท็บเล็ต'].includes(c))return 'TABLET';
 if(['camera','กล้อง'].includes(c))return 'CAMERA';
 if(['other','อื่นๆ'].includes(c))return 'OTHER';
 return null;
};
export function generateCostSpecReviewQueue(records:CostHistoryRecord[],reviews:CostSpecReview[]):CostReviewQueueEntry[]{
 const reviewed=new Map(reviews.filter(r=>r.source_kind==='INVENTORY').map(r=>[r.source_key,r]));
 const soldCounts=new Map<string,number>();
 for(const r of records)if(r.source_kind==='SALE'&&r.inventory_code)soldCounts.set(r.inventory_code,(soldCounts.get(r.inventory_code)??0)+1);
 const result:CostReviewQueueEntry[]=[];
 for(const r of records){
  if(r.source_kind!=='INVENTORY')continue;
  const review=reviewed.get(r.source_key)??null;
  const stale=!!review&&(review.source_name_snapshot!==r.product_name||review.source_category_snapshot!==r.category);
  const proposedCategory=categoryFromName(r.product_name);
  const recognized=categoryLabelToCanonical(r.category);
  const parsed=extractStructuredSpecs(r.product_name,proposedCategory??recognized??'OTHER');
  const flags:string[]=[];
  if(!r.category.trim())flags.push('MISSING_CATEGORY');
  if(proposedCategory&&recognized&&proposedCategory!==recognized)flags.push('CATEGORY_CONFLICT');
  if(parsed.confidence!=='COMPLETE')flags.push('INCOMPLETE_SPECS');
  if(parsed.warnings.includes('CONDITION_REVIEW')||/เสีย|ซาก|น้ำเข้า|ตำหนิ|จอแตก|แบตเสื่อม/.test(String(r.details?.condition??'')))flags.push('DEFECT_REVIEW');
  if(stale)flags.push('REVIEW_STALE');
  if(r.source_type==='FORFEIT')flags.push('FORFEIT');
  const soldEvents=soldCounts.get(r.inventory_code)??0;
  const priority:CostReviewQueueEntry['priority']=stale||flags.includes('CATEGORY_CONFLICT')||(!r.category.trim()&&soldEvents>0)?'HIGH':
   flags.includes('MISSING_CATEGORY')||soldEvents>0||flags.includes('DEFECT_REVIEW')?'MEDIUM':'LOW';
  result.push({source_key:r.source_key,product_name:r.product_name,category:r.category,
   source_type:r.source_type,condition:String(r.details?.condition??''),
   soldEvents,review,stale,proposedCategory,priority,flags,parsed});
 }
 return result.sort((a,b)=>
   (a.review&&!a.stale?1:0)-(b.review&&!b.stale?1:0)||
   ({HIGH:0,MEDIUM:1,LOW:2}[a.priority]-{HIGH:0,MEDIUM:1,LOW:2}[b.priority])||
   b.soldEvents-a.soldEvents||a.source_key.localeCompare(b.source_key));
}
// A review is an overlay only; it can never rewrite the original cost, quantity,
// sale, profit, source type, or accounting records.
export function applyCostSpecReviews(records:CostHistoryRecord[],reviews:CostSpecReview[]):CostHistoryRecord[]{
 const byKey=new Map(reviews.filter(r=>r.source_kind==='INVENTORY').map(r=>[r.source_key,r]));
 return records.map(item=>{
  if(item.source_kind!=='INVENTORY')return item;
  const review=byKey.get(item.source_key);
  if(!review||review.source_name_snapshot!==item.product_name||review.source_category_snapshot!==item.category)return item;
  return {...item,product_name:review.reviewed_name,category:review.reviewed_category,
   details:{...item.details,_original_product_name:item.product_name,_original_category:item.category,_manual_spec_review:true}};
 });
}
