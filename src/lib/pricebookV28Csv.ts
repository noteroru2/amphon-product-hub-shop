/** Strict preview-only PriceBook CSV reader. Never writes price data. */
export const PRICEBOOK_V28_HEADERS = ["category","brand","model","model_code","condition_key","estimated_resale","opening_offer","target_buy","hard_max"] as const;
export type PricebookV28Row = Record<(typeof PRICEBOOK_V28_HEADERS)[number],string>;
export type PricebookV28CsvResult = {rows:PricebookV28Row[];errors:string[];valid:boolean;};
function tokenizeCsv(input:string):string[][]{
 const rows:string[][]=[];let current:string[]=[];let field="";let quoted=false;
 for(let i=0;i<input.length;i++){const c=input[i];
  if(quoted){if(c==='"'&&input[i+1]==='"'){field+='"';i++;}else if(c==='"'){quoted=false;}else field+=c;}
  else if(c==='"'){if(field!=="")throw new Error("CSV_UNEXPECTED_QUOTE");quoted=true;}
  else if(c===","){current.push(field);field="";}
  else if(c==="\n"){current.push(field.replace(/\r$/,""));rows.push(current);current=[];field="";}
  else field+=c;
 }
 if(quoted)throw new Error("CSV_UNCLOSED_QUOTE");
 if(field!==""||current.length){current.push(field.replace(/\r$/,""));rows.push(current);}
 return rows.filter(row=>row.some(x=>x.trim()!==""));
}
const number=(s:string)=>{if(!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(s))return null;const n=Number(s);return Number.isSafeInteger(Math.round(n*100))&&n>=0?n:null;};
export function validatePricebookV28Csv(csv:string):PricebookV28CsvResult {
 const errors:string[]=[];const rows:PricebookV28Row[]=[];
 if(csv.length>1000000)return {rows,errors:["FILE_TOO_LARGE"],valid:false};
 let parsed:string[][];
 try{parsed=tokenizeCsv(csv.replace(/^\uFEFF/,""));}catch(e){return {rows,errors:[String(e)],valid:false};}
 if(!parsed.length)return {rows,errors:["EMPTY_FILE"],valid:false};
 const headings=parsed[0].map(s=>s.trim().toLowerCase());
 if(new Set(headings).size!==headings.length)errors.push("DUPLICATE_HEADER");
 for(const h of PRICEBOOK_V28_HEADERS)if(!headings.includes(h))errors.push("MISSING_HEADER:"+h);
 if(errors.length)return {rows,errors,valid:false};
 const seen=new Set<string>();
 for(let i=1;i<parsed.length;i++){
  const values=parsed[i];if(values.length!==headings.length){errors.push("ROW_"+(i+1)+":COLUMN_COUNT");continue;}
  const raw=Object.fromEntries(headings.map((h,j)=>[h,values[j].trim()])) as PricebookV28Row;
  if(!raw.category||!raw.brand||!raw.model||!raw.model_code||!raw.condition_key)errors.push("ROW_"+(i+1)+":IDENTITY_MISSING");
  if(Object.values(raw).some(v=>/^[=+@]/.test(v)))errors.push("ROW_"+(i+1)+":FORMULA_LIKE_CELL");
  const key=[raw.category,raw.brand,raw.model_code,raw.condition_key].map(s=>s.toLowerCase()).join("|");
  if(seen.has(key))errors.push("ROW_"+(i+1)+":DUPLICATE_VARIANT");
  seen.add(key);
  const amounts=["estimated_resale","opening_offer","target_buy","hard_max"].map(k=>number(raw[k as keyof PricebookV28Row]));
  if(amounts.some(n=>n===null))errors.push("ROW_"+(i+1)+":INVALID_AMOUNT");
  else {const [resale,opening,target,maximum]=amounts as number[];
   if(opening>target||target>maximum||maximum>resale||resale===0)errors.push("ROW_"+(i+1)+":PRICE_ORDER_INVALID");
  }
  rows.push(raw);
  if(rows.length>5000){errors.push("ROW_LIMIT_EXCEEDED");break;}
 }
 if(!rows.length)errors.push("NO_DATA_ROWS");
 return {rows,errors,valid:errors.length===0};
}
