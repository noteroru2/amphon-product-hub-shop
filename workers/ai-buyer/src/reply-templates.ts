// Short wording based on captured OWNER_MANUAL examples. Prices never live in these templates.
export function informationTemplate(text: string, requestedInputs: unknown) {
  const value = text.trim().replace(/[!！.]+$/g, '').trim()
  if (/^(สวัสดี(?:ครับ|ค่ะ|คับ)?|หวัดดี(?:ครับ|ค่ะ)?|hello|hi)$/i.test(value)) {
    return 'สวัสดีครับ ส่งรุ่น สเปค และรูปสินค้า มาเช็คราคาได้เลยครับ'
  }
  return null
}

export function missingInformationTemplate(requestedInputs: unknown) {
  if (!Array.isArray(requestedInputs) || !requestedInputs.length) return null
  const labels: Record<string, string> = {
    PRODUCT_TYPE: 'ประเภทสินค้า', MODEL: 'รุ่น', MODEL_CODE: 'รหัสรุ่น',
    CORE_SPEC: 'สเปคเครื่อง', STORAGE_VARIANT: 'ความจุ',
    MODEL_LABEL: 'รูปป้ายรุ่น', SYSTEM_SCREEN: 'รูปหน้าสเปคเครื่อง',
    BATTERY_HEALTH: 'สุขภาพแบต', CONDITION: 'สภาพและตำหนิ',
  }
  const items = requestedInputs.map(x => labels[String(x)])
  if (items.some(x => !x)) return null
  return 'ขอ' + Array.from(new Set(items)).join(' และ') + 'ทีครับ'
}
