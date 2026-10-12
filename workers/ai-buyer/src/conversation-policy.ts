import { informationTemplate, missingInformationTemplate } from './reply-templates'

export type ConversationIntent = 'SELL_ITEM' | 'BUY_ITEM' | 'IDENTIFY_MODEL' | 'GENERAL' | 'UNKNOWN'
export type PolicyMessage = {
  id: string; direction: string; message_type: string; text_content: string | null; created_at: string
}
export type ConversationMemory = {
  version: 2; intent: ConversationIntent; modelCandidate: string; knownModel: string;
  storage: string; modelUnknown: boolean; hasCustomerImage: boolean;
  lastRequestKey: string; lastReply: string; lastInboundId: string
}
export type ReplyPlan = {
  route: 'REPLY' | 'SUPPRESS' | 'HANDOFF' | 'AI'; reply: string; requestKey: string;
  memory: ConversationMemory; reason: string
}

const intents: ConversationIntent[] = ['SELL_ITEM', 'BUY_ITEM', 'IDENTIFY_MODEL', 'GENERAL', 'UNKNOWN']
const clean = (v: unknown, max = 180) => String(v ?? '').trim().slice(0, max)
const normalize = (v: string) => v.toLowerCase().replace(/[\s.,!?！]+/g, '')

export function readConversationMemory(value: unknown): ConversationMemory {
  const data = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  return {
    version: 2, intent: intents.includes(data.intent as ConversationIntent) ? data.intent as ConversationIntent : 'UNKNOWN',
    modelCandidate: clean(data.modelCandidate, 80), knownModel: clean(data.knownModel, 120), storage: clean(data.storage, 24),
    modelUnknown: data.modelUnknown === true, hasCustomerImage: data.hasCustomerImage === true,
    lastRequestKey: clean(data.lastRequestKey, 240), lastReply: clean(data.lastReply, 500), lastInboundId: clean(data.lastInboundId, 80),
  }
}

export function safeCustomerReply(value: unknown) {
  const text = clean(value, 400)
  // A conversational model cannot provide prices, availability guarantees or unattended purchase promises.
  if (/\d[\d,.]*\s*(?:บาท|฿|thb)|฿\s*\d|(?:ราคา|รับซื้อให้|เสนอรับ|ให้ได้).*(?:\d|พัน|หมื่น)|รับซื้อแน่นอน|รับแน่นอน|มีสินค้าแน่นอน/i.test(text)) return ''
  return text
}

export function contextualReplyPlan(input: {
  recent: PolicyMessage[]; incoming: PolicyMessage[]; metadata: Record<string, unknown> | null;
  observations: Array<{ model_name: string | null; model_code: string | null; confirmed: Record<string, unknown>; identity_confidence: number | null }>;
  category: string | null; state: string; readyImages: number;
}): ReplyPlan {
  const memory = readConversationMemory(input.metadata?.conversationMemory)
  const messages = [...new Map([...input.recent, ...input.incoming].map(m => [m.id, m])).values()]
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
  const inbound = messages.filter(m => m.direction === 'INBOUND')
  const latest = [...input.incoming].sort((a,b) => Date.parse(a.created_at)-Date.parse(b.created_at)).at(-1)
  const latestText = clean(latest?.text_content, 1200)
  const texts = inbound.filter(m => m.message_type === 'TEXT')
  for (const message of inbound) {
    if (message.message_type === 'IMAGE') memory.hasCustomerImage = true
    const text = clean(message.text_content, 1200)
    if (!text) continue
    const cannotKnow = /จำ.*(?:รุ่น|ไม่ได้)|ไม่(?:รู้|ทราบ|แน่ใจ).*รุ่น|รุ่น.*ไม่(?:รู้|ทราบ|แน่ใจ)|ไม่รู้รุ่น/i.test(text)
    const helpModel = cannotKnow || /อยากทราบรุ่น|ดูรุ่น(?:ยังไง|อย่างไร)|หารุ่น|รุ่นอะไร/i.test(text)
    const wantsBuy = /(?:อยาก|จะ|ต้องการ)ซื้อ|ซื้อเคส|หาเคส|มี.*ขาย(?:ไหม|มั้ย)|หาซื้อ/i.test(text)
    const wantsSell = /รับ[ซช]ื้อ|(?:อยาก|จะ|ต้องการ)ขาย|ขายเครื่อง|ปล่อยเครื่อง|ตีราคา|ประเมินราคา/i.test(text)
    if (wantsSell && !/ไม่ได้ขาย|ไม่(?:ได้)?ต้องการขาย/.test(text)) memory.intent = 'SELL_ITEM'
    else if (wantsBuy) memory.intent = /เคส|รุ่น/.test(text) ? 'IDENTIFY_MODEL' : 'BUY_ITEM'
    else if (helpModel) memory.intent = 'IDENTIFY_MODEL'
    else if (/รับซ่อม|ซ่อม(?:ไหม|มั้ย)|ร้านอยู่|เปิดกี่|ปิดกี่|เวลาทำการ|จัดส่ง.*(?:ไหม|มั้ย)|สอบถามทั่วไป/.test(text)) memory.intent = 'GENERAL'
    else if (/ไม่ได้ขาย|ไม่(?:ได้)?ต้องการขาย/.test(text)) memory.intent = 'GENERAL'
    if (cannotKnow) memory.modelUnknown = true
    const normalized = text.replace(/\s*[-–—]\s*/g, '-')
    const modelMatch = /\b([a-z]{1,6}-\d[a-z0-9-]{1,16}|A\d{4})\b/i.exec(normalized)
    if (modelMatch) memory.modelCandidate = modelMatch[1].toUpperCase()
    const storage = /(?:ความจุ|จุ|storage)\s*(32|64|128|256|512|1024)\b|\b(32|64|128|256|512|1024)\s*(?:gb|กิ๊ก|กิก|จีบี)\b/i.exec(text)
    if (storage) memory.storage = (storage[1] || storage[2]) + ' GB'
  }
  // Only confirmed observation identity becomes knownModel. A raw customer code is never a pricing identity.
  const observed = input.observations.find(o => Number(o.identity_confidence) >= 0.9 && o.model_name
    && !/^(tablet|camera|notebook|smartphone|unknown|other)$/i.test(o.model_name))
  if (observed && !memory.modelUnknown) {
    memory.knownModel = clean(observed.model_name, 120)
    if (!memory.modelCandidate && observed.model_code) memory.modelCandidate = clean(observed.model_code, 80)
  }
  const recentReplies = messages.filter(m => m.direction === 'OUTBOUND').map(m => normalize(m.text_content || ''))
  const plan = (route: ReplyPlan['route'], reply: string, key: string, reason: string): ReplyPlan => ({
    route, reply, requestKey: key, reason, memory: { ...memory, lastInboundId: latest?.id || memory.lastInboundId },
  })
  const handoff = (reason: string) => plan('HANDOFF', 'ส่งให้พนักงานตรวจข้อมูลและตอบต่อครับ', '', reason)
  const askOnce = (reply: string, key: string, reason: string) => {
    if (memory.lastRequestKey === key || recentReplies.includes(normalize(reply))) return handoff('QUESTION_ALREADY_ASKED:' + reason)
    return plan('REPLY', reply, key, reason)
  }
  if (!latest) return plan('SUPPRESS', '', '', 'NO_NEW_MESSAGE')
  if (latest.id === memory.lastInboundId) return plan('SUPPRESS', '', '', 'ALREADY_HANDLED')
  if (/^(ครับ|ค่ะ|คะ|คับ|ขอบคุณ(?:ครับ|ค่ะ)?|โอเค(?:ครับ|ค่ะ)?|ok)[!.\s]*$/i.test(latestText)) {
    return plan('SUPPRESS', '', '', 'ACKNOWLEDGEMENT')
  }
  if (/คุย.*(?:คน|แอดมิน|พนักงาน)|ขอ.*(?:แอดมิน|พนักงาน)|ให้คนตอบ|ติดต่อเจ้าหน้าที่/.test(latestText)) return handoff('CUSTOMER_REQUESTED_HUMAN')
  if (/เป็น.*(?:ai|เอไอ|บอท)|ตอบ.*(?:อัตโนมัติ|บอท)|ใช่.*(?:ai|เอไอ)/i.test(latestText)) {
    return plan('REPLY', 'เป็นผู้ช่วยอัตโนมัติของร้านครับ ถ้าต้องการให้พนักงานดูต่อบอกได้เลยครับ', '', 'AI_DISCLOSURE')
  }
  if (memory.knownModel && /จริงๆ|จริง ๆ|ขอแก้|ไม่ใช่|เปลี่ยนเป็น|อีกเครื่อง/.test(latestText)) return handoff('PRODUCT_OR_SPEC_CORRECTION')
  if (memory.intent === 'SELL_ITEM' && observed?.confirmed.storage && memory.storage
    && String(observed.confirmed.storage).replace(/\D/g, '') !== memory.storage.replace(/\D/g, '')) return handoff('STORAGE_CORRECTION_REQUIRES_REPRICING')
  if (memory.intent === 'IDENTIFY_MODEL') {
    if (/^A\d{4}$/.test(memory.modelCandidate) && !memory.knownModel && !input.readyImages) {
      return plan('HANDOFF', 'ได้รับหมายเลขรุ่น ' + memory.modelCandidate + ' แล้วครับ ส่งให้พนักงานตรวจชื่อรุ่นและขนาดเคสครับ', '', 'MODEL_NUMBER_SUPPLIED_LOOKUP_REQUIRED')
    }
    if (memory.knownModel && !memory.modelUnknown) {
      return plan('REPLY', 'ข้อมูลที่มีระบุรุ่น ' + memory.knownModel + ' ครับ หากจะซื้อเคสให้เทียบรุ่นและขนาดก่อนสั่งครับ', '', 'KNOWN_MODEL_HELP')
    }
    if (input.readyImages > 0 || latest.message_type === 'IMAGE') return plan('AI', '', '', 'IDENTIFY_MODEL_FROM_IMAGE')
    if (/ipad|ไอแพด/i.test(texts.map(m => m.text_content).join(' ')) || input.category === 'TABLET') {
      const serialOnly = /หมายเลขเครื่อง|serial|มี\s*[a-z]{2}\b/i.test(latestText)
      if (/ซื้อเคส|หาเคส/.test(latestText) && memory.lastRequestKey === 'IPAD_MODEL_HELP') {
        return plan('REPLY', 'ได้ครับ การเลือกเคสต้องดูรุ่นและขนาดจอครับ ความจุอย่างเดียวระบุรุ่นไม่ได้ครับ', '', 'CASE_COMPATIBILITY_CONTEXT')
      }
      const steps = serialOnly
        ? 'ขอหมายเลขรุ่นแทนเลขเครื่องครับ เปิด การตั้งค่า > ทั่วไป > เกี่ยวกับ แล้วแตะหมายเลขรุ่นให้ขึ้นรหัส A ตามด้วยตัวเลข 4 หลัก ส่งรหัสนั้นมาได้เลยครับ'
        : 'ดูรุ่นได้ที่ การตั้งค่า > ทั่วไป > เกี่ยวกับ ครับ ส่งรูปชื่อรุ่นหรือหมายเลขรุ่นมาได้เลย หากยังไม่ขึ้นรหัส A ให้แตะหมายเลขรุ่นอีกครั้งครับ'
      return askOnce(steps, serialOnly ? 'IPAD_MODEL_NUMBER_NOT_SERIAL' : 'IPAD_MODEL_HELP', 'HELP_FIND_MODEL_NOT_BUYBACK')
    }
    return askOnce('ถ้าไม่ทราบรุ่น ส่งรูปตัวเครื่องและป้ายรุ่นใกล้ ๆ มาได้เลยครับ', 'HELP_MODEL_LABEL', 'MODEL_UNKNOWN')
  }
  if (memory.intent === 'BUY_ITEM') return handoff('BUYER_INQUIRY_REQUIRES_STOCK_CHECK')
  if (/^(สอบถาม|สอบถามได้(?:ไหม|มั้ย|มั้ยคะ)|สอบถามได้มั้ยคะ|สอบถามได้ไหมครับ)[?\s]*$/i.test(latestText)) {
    return plan('REPLY', 'สอบถามได้เลยครับ', '', 'GENERAL_INVITATION')
  }
  const greeting = informationTemplate(latestText, null)
  if (greeting) return plan('REPLY', greeting, '', 'GREETING')
  if (memory.modelUnknown) {
    return askOnce('ถ้าไม่ทราบรุ่น ส่งรูปตัวเครื่องและป้ายรุ่นใกล้ ๆ มาได้เลยครับ', 'HELP_MODEL_LABEL', 'MODEL_UNKNOWN')
  }
  if (memory.modelCandidate && !memory.knownModel && ['NEW','IDENTIFYING_PRODUCT','NEED_MORE_INFO','COLLECTING_PHOTOS'].includes(input.state)) {
    if (input.readyImages > 0) return plan('AI', '', '', 'CHECK_SUPPLIED_MODEL_WITH_IMAGES')
    if (memory.hasCustomerImage) return handoff('SUPPLIED_MODEL_STILL_UNVERIFIED_AFTER_IMAGE')
    return askOnce('ได้รับรหัส ' + memory.modelCandidate + ' แล้วครับ ขอรูปตัวเครื่องและป้ายรุ่นใกล้ ๆ เพื่อยืนยันรุ่นก่อนครับ',
      'VERIFY_MODEL_LABEL:' + memory.modelCandidate, 'RAW_MODEL_CODE_RECEIVED')
  }
  if (input.readyImages > 0) return plan('AI', '', '', 'NEW_IMAGES')
  if (memory.intent === 'GENERAL') return plan('AI', '', '', 'GENERAL_QUESTION_NEEDS_CONTEXT')
  // Never treat a stale missing-fields list as a reason to ask for information already provided.
  let requested = Array.isArray(input.metadata?.lastRequestedInputs) ? input.metadata!.lastRequestedInputs.map(String) : []
  if (memory.knownModel || memory.modelCandidate) requested = requested.filter(k => k !== 'MODEL' && k !== 'MODEL_CODE')
  if (memory.storage) requested = requested.filter(k => k !== 'STORAGE_VARIANT')
  if (memory.hasCustomerImage) requested = requested.filter(k => !['FULL_DEVICE','CAMERA_FRONT_BACK','BACK'].includes(k))
  if (['NEW','IDENTIFYING_PRODUCT','NEED_MORE_INFO','COLLECTING_PHOTOS'].includes(input.state)
    && !/เสีย|พัง|แตก|บวม|เปลี่ยน|ซ่อม|ดับ|ล็อค|ล็อก|น้ำ|ตำหนิ|defect|broken|damage/i.test(latestText)) {
    const reply = missingInformationTemplate(requested)
    if (reply) {
      const key = 'MISSING:' + [...requested].sort().join(',')
      const legacyModelQuestion = requested.includes('MODEL') && recentReplies.some(r => /ขอรุ่น|รุ่นไหน/.test(r))
      if (legacyModelQuestion) return askOnce('ถ้าไม่ทราบรุ่น ส่งรูปตัวเครื่องและป้ายรุ่นใกล้ ๆ มาได้เลยครับ', 'HELP_MODEL_LABEL', 'LEGACY_MODEL_QUESTION_ALREADY_ASKED')
      return askOnce(reply, key, 'MISSING_INFORMATION')
    }
  }
  return plan('AI', '', '', 'AMBIGUOUS_CONTEXT')
}
