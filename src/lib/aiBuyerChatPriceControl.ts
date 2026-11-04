import {supabase} from './supabase';

export type ChatPriceValues={
 estimated_resale:number;opening_offer:number;target_buy:number;hard_max:number;
};
export type ChatPriceEntrySnapshot=ChatPriceValues&{
 id:string;draft_id:string;category:string;brand:string;model:string;
 model_code:string;condition_key:string;active:boolean;note:string;
 aliases:unknown;spec_match:unknown;adjustments:unknown;created_at:string;updated_at:string;
};
export type ChatPriceProposal={
 id:string;batch_id:string;draft_id:string;entry_id:string;request_origin:'CHATGPT_CONNECTOR'|'HUB_OWNER';
 summary:string;reason:string;expected_entry_updated_at:string;
 before_snapshot:ChatPriceEntrySnapshot;proposed_prices:ChatPriceValues;preview_hash:string;
 status:'PENDING'|'APPROVED'|'REJECTED';created_at:string;expires_at:string;
 reviewed_by:string|null;reviewed_at:string|null;
};
const client=()=>{if(!supabase)throw Error('Supabase ไม่ได้เชื่อมต่อ');return supabase};
const names:Record<keyof ChatPriceValues,string>={
 estimated_resale:'ราคาขายต่อ',opening_offer:'ราคาเปิดรับ',target_buy:'เป้าหมายรับซื้อ',hard_max:'เพดานรับซื้อ'
};
export const chatPriceFields=['estimated_resale','opening_offer','target_buy','hard_max'] as const;
export const chatPriceFieldNames=names;

export function validateChatPriceValues(v:ChatPriceValues):string|null{
 if(chatPriceFields.some(k=>typeof v[k]!=='number'||!Number.isFinite(v[k])||v[k]>10_000_000))return 'ราคาไม่ถูกต้อง';
 if(!(v.estimated_resale>0&&v.opening_offer>=0&&v.opening_offer<=v.target_buy&&v.target_buy<=v.hard_max&&v.hard_max<=v.estimated_resale))return 'ลำดับราคาผิด: เปิดรับ ≤ เป้าหมาย ≤ เพดาน ≤ ราคาขายต่อ';
 return null;
}
export function chatPriceDiff(p:ChatPriceProposal){
 return chatPriceFields.map(k=>({
  key:k,label:names[k],before:Number(p.before_snapshot[k]),after:Number(p.proposed_prices[k]),
  delta:Number(p.proposed_prices[k])-Number(p.before_snapshot[k])
 }));
}
export function chatPriceIsStale(p:ChatPriceProposal,current:ChatPriceEntrySnapshot|null){
 if(!current||p.entry_id!==current.id||p.draft_id!==current.draft_id)return true;
 const before=p.before_snapshot;
 // Re-check entire snapshot, not only price fields; any concurrent identity, spec or status edit makes approval stale.
 return current.updated_at!==p.expected_entry_updated_at ||
  JSON.stringify(current)!==JSON.stringify(before);
}

export async function loadChatPriceProposals(){
 const {data,error}=await client().from('ai_buyer_chat_price_proposals')
 .select('id,batch_id,draft_id,entry_id,request_origin,summary,reason,expected_entry_updated_at,before_snapshot,proposed_prices,preview_hash,status,created_at,expires_at,reviewed_by,reviewed_at')
 .order('created_at',{ascending:false}).limit(200);
 if(error)throw new Error(error.message);
 return (data??[]) as ChatPriceProposal[];
}
export async function loadChatPriceEntries(ids:string[]):Promise<ChatPriceEntrySnapshot[]>{
 if(!ids.length)return [];
 const unique=[...new Set(ids)];
 if(unique.length>200)throw new Error('คำขอมากเกินกว่าจะตรวจได้ในครั้งเดียว');
 const {data,error}=await client().from('ai_buyer_pb28_entries')
  .select('id,draft_id,category,brand,model,model_code,condition_key,estimated_resale,opening_offer,target_buy,hard_max,active,note,aliases,spec_match,adjustments,created_at,updated_at')
  .in('id',unique);
 if(error)throw new Error(error.message);
 return (data??[]) as ChatPriceEntrySnapshot[];
}
export async function decideChatPriceProposal(id:string,action:'APPROVE'|'REJECT',previewHash:string){
 const {data,error}=await client().rpc('ai_buyer_chat_price_decide',{
  p_proposal_id:id,p_action:action,p_preview_hash:previewHash
 });
 if(error)throw new Error(error.message);
 return data as {proposal_id:string;status:string;entry_id:string;draft_id:string};
}
export async function loadChatPriceAudit(proposalId:string){
 const {data,error}=await client().from('ai_buyer_chat_price_audit')
 .select('action,actor_id,before_data,after_data,recorded_at')
 .eq('proposal_id',proposalId).order('recorded_at',{ascending:false}).limit(30);
 if(error)throw new Error(error.message);
 return data??[];
}
