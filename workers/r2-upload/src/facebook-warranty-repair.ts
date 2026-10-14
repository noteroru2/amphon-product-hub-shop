/** One-time correction of existing Facebook posts; never creates new posts. */
export const WARRANTY_POST_REPAIR_TAG = 'WARRANTY_BE_YEAR_REPAIRED_20261014'

export const WARRANTY_POST_REPAIRS = [
  { sku: 'AT-IT-2610-500011', postId: '108838761559012_1116116790926802', fromYear: '3114', toYear: '2571', canonicalDate: '2028-06-15' },
  { sku: 'AT-IT-2610-500011', postId: '151011312169935_1405880285054291', fromYear: '3114', toYear: '2571', canonicalDate: '2028-06-15' },
  { sku: 'AT-IT-2610-500005', postId: '108838761559012_1115476247657523', fromYear: '3113', toYear: '2570', canonicalDate: '2027-04-05' },
  { sku: 'AT-IT-2610-500005', postId: '151011312169935_1405263795115940', fromYear: '3113', toYear: '2570', canonicalDate: '2027-04-05' },
] as const

/** Only replace the Buddhist year in lines actually mentioning a warranty. */
export function correctFacebookWarrantyText(original: string, fromYear: string, toYear: string): { message: string; changed: boolean } {
  if (!original.trim()) throw new Error('FACEBOOK_WARRANTY_MESSAGE_EMPTY')
  const oldYear = new RegExp(`\\b${fromYear}\\b`, 'g')
  const newYear = new RegExp(`\\b${toYear}\\b`)
  let replacements = 0
  let alreadyCorrect = false
  const message = original.split('\n').map(line => {
    if (!/ประกัน(?:ศูนย์|ร้าน)?\s*ถึง|warranty\s*(?:until|to|ends)/i.test(line)) return line
    if (newYear.test(line)) alreadyCorrect = true
    return line.replace(oldYear, () => {
      replacements += 1
      return toYear
    })
  }).join('\n')
  if (replacements > 0) return { message, changed: true }
  if (alreadyCorrect) return { message: original, changed: false }
  throw new Error('FACEBOOK_WARRANTY_YEAR_NOT_PRESENT')
}

/** Append the canonical expiry to an existing sales caption that omitted warranty entirely. */
export function addMissingFacebookWarrantyText(original: string, expiryDisplay: string): { message: string; changed: boolean } {
  if (!original.trim()) throw new Error('FACEBOOK_WARRANTY_MESSAGE_EMPTY')
  if (!/^\d{1,2}\s+[^\n]+\s+\d{4}$/.test(expiryDisplay)) throw new Error('FACEBOOK_WARRANTY_DATE_INVALID')
  const lines=original.split('\n')
  if (lines.some(line=>/ประกัน(?:ศูนย์|ร้าน)?\s*ถึง|warranty\s*(?:until|to|ends)/i.test(line))) {
    if (lines.some(line=>line.includes(expiryDisplay)&&/ประกัน/i.test(line))) return {message:original,changed:false}
    throw new Error('FACEBOOK_WARRANTY_EXISTING_CLAIM_REVIEW_REQUIRED')
  }
  if (lines.some(line=>/หมดประกัน|ไม่มีประกัน/i.test(line))) throw new Error('FACEBOOK_WARRANTY_NEGATIVE_CLAIM_REVIEW_REQUIRED')
  const priceIndex=lines.findIndex(line=>/^\s*(?:💰\s*)?ราคา\s*[\d,]+\s*บาท/i.test(line))
  if(priceIndex<0)throw new Error('FACEBOOK_WARRANTY_PRICE_ANCHOR_MISSING')
  lines.splice(priceIndex,0,'🛡️ มีประกันถึง '+expiryDisplay)
  return { message:lines.join('\n'), changed:true }
}
