export function facebookSoldMessage(original:string,p:any){
 const header='#ขายแล้วครับ #ขอบคุณลูกค้าทุกท่าน'
 let content=String(original||p.title||p.sku).replace(/^#ขายแล้วครับ\s+#ขอบคุณลูกค้าทุกท่าน\s*/u,'')
 content=content.replace(/((?:ราคา(?:ขาย|พิเศษ|เพียง)?|ขายเพียง|ขาย|เพียง)\s*[:：]?\s*)(?:฿\s*)?\d[\d,]*(?:\.\d+)?(?:\s*(?:บาท|฿|.-|.-บาท))?/gu,'$1XXX')
 content=content.replace(/(?:฿\s*\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s*(?:บาท|฿))/gu,'XXX')
 if(!content.includes('XXX'))content+='\nราคา XXX'
 return header+'\n\n'+content.trim()
}

/**
 * Patch just the public price line in an existing post. Leave the original
 * warranty, defects, specifications, links and hashtags untouched.
 */
export function facebookPriceMessage(original: string, retailPrice: number): {message: string, changed: boolean} {
  if (!Number.isFinite(retailPrice) || retailPrice <= 0) throw new Error('FACEBOOK_PRICE_INVALID')
  const input = String(original || '')
  if (/^\s*#ขายแล้ว/u.test(input)) throw new Error('FACEBOOK_PRICE_SOLD_POST')
  if (!input.trim()) throw new Error('FACEBOOK_PRICE_EMPTY_POST')
  const priceLine = /^(\s*(?:(?:💰|💵|🔥)\s*)?(?:ราคา(?:ขาย|พิเศษ|เพียง)?|ขายเพียง)\s*[:：]?\s*(?:฿\s*)?)(\d[\d,]*(?:\.\d{1,2})?)(\s*(?:(?:บาท|฿|\.-))?(?:\s*\([^)]*\))?\s*)$/u
  const lines = input.split(/\r?\n/)
  const matches = lines.flatMap((line, i) => priceLine.test(line) ? [i] : [])
  if (matches.length !== 1) throw new Error(matches.length ? 'FACEBOOK_PRICE_AMBIGUOUS' : 'FACEBOOK_PRICE_LINE_NOT_FOUND')
  const index = matches[0]
  const prior = lines[index]
  const formatted = new Intl.NumberFormat('th-TH', {maximumFractionDigits:2}).format(retailPrice)
  lines[index] = prior.replace(priceLine, (_, prefix: string, _old: string, suffix: string) => prefix + formatted + suffix)
  const message = lines.join('\n')
  return {message, changed: message !== input}
}
