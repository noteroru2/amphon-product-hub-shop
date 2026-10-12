export const sampleProviders=['ChatGPT','Gemini','Google AI Overviews','Perplexity','Copilot','Claude']
export function aiSummary(samples:{provider:string;run_status:string;mentioned:boolean|null;cited_sites:string[]}[],provider:string) {
 const completed=samples.filter(s=>s.provider===provider && s.run_status==='COMPLETED' && s.mentioned!==null)
 return {completed:completed.length,mentions:completed.filter(s=>s.mentioned).length,citations:completed.filter(s=>s.cited_sites.length>0).length,rate:completed.length?completed.filter(s=>s.mentioned).length/completed.length:null}
}
export function attributedProfit(rows:{sale_id:string|null;confirmed_lead:boolean;actual_profit:number|null}[]) {
 const seen=new Set<string>();let total=0;let known=0
 for(const row of rows) if(row.confirmed_lead && row.sale_id && !seen.has(row.sale_id)) {seen.add(row.sale_id);if(row.actual_profit!==null){total+=Number(row.actual_profit);known++}}
 return {total:known?total:null,known,sales:seen.size}
}
export function evidenceDraft(query:string,title:string|null,excerpt:string) {
 return `# ${query}\n\n${title || query}\n\n${excerpt.slice(0,1400)}\n\n## คำถามที่ต้องตอบให้ชัด\n- ลูกค้าต้องเตรียมข้อมูลอะไร?\n- มีข้อจำกัดหรือเงื่อนไขใดบ้าง?\n- ขั้นตอนติดต่อและบริการเป็นอย่างไร?\n\n[เรียบเรียงคำตอบจากหลักฐานจริง และลบข้อความในวงเล็บก่อนส่งอนุมัติ]`
}
export const measurementLabels:Record<string,string>={WAITING:'รอข้อมูลหลังเผยแพร่',INSUFFICIENT_DATA:'ข้อมูลไม่พอ',OBSERVED_UP:'สังเกตว่าอันดับดีขึ้น',OBSERVED_DOWN:'สังเกตว่าอันดับลดลง',NO_CLEAR_CHANGE:'ยังไม่เห็นการเปลี่ยนชัด',CONFOUNDED:'มีงานอื่นเปลี่ยนหน้าเดียวกัน'}
