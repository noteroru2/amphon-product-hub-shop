export function facebookSoldMessage(original:string,p:any){
 const header='#ขายแล้วครับ #ขอบคุณลูกค้าทุกท่าน'
 let content=String(original||p.title||p.sku).replace(/^#ขายแล้วครับ\s+#ขอบคุณลูกค้าทุกท่าน\s*/u,'')
 content=content.replace(/((?:ราคา(?:ขาย|พิเศษ|เพียง)?|ขายเพียง|ขาย|เพียง)\s*[:：]?\s*)(?:฿\s*)?\d[\d,]*(?:\.\d+)?(?:\s*(?:บาท|฿|.-|.-บาท))?/gu,'$1XXX')
 content=content.replace(/(?:฿\s*\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s*(?:บาท|฿))/gu,'XXX')
 if(!content.includes('XXX'))content+='\nราคา XXX'
 return header+'\n\n'+content.trim()
}
