import {supabase} from './supabase';
import type {ChatPricePrepared} from './aiBuyerChatPriceControl';
export type ChatPriceBatch={
 id:string;draft_id:string;actor_id:string;request_text:string;item_count:number;
 before_data:unknown;after_data:unknown;created_at:string;
};
export async function applyChatPriceDiff(draftId:string,rows:ChatPricePrepared[],instruction:string):Promise<string>{
 if(!supabase)throw new Error('ไม่ได้เชื่อมต่อ Supabase');
 if(rows.length<1||rows.length>20)throw new Error('ปรับได้ทีละ 1–20 รายการ');
 const {data,error}=await supabase.rpc('ai_buyer_chat_price_apply',{
  p_draft_id:draftId,p_items:rows,p_request_text:instruction.slice(0,2000),
 });
 if(error)throw new Error(error.message);
 return String(data);
}
export async function listChatPriceBatches(draftId:string):Promise<ChatPriceBatch[]>{
 if(!supabase)throw new Error('ไม่ได้เชื่อมต่อ Supabase');
 const {data,error}=await supabase.from('ai_buyer_chat_price_batches')
 .select('id,draft_id,actor_id,request_text,item_count,before_data,after_data,created_at')
 .eq('draft_id',draftId).order('created_at',{ascending:false}).limit(40);
 if(error)throw new Error(error.message);
 return (data??[]) as ChatPriceBatch[];
}
