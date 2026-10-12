export const growthKindLabels: Record<string, string> = {
  NEAR_FIRST_PAGE: 'ใกล้หน้าแรก', LOW_CTR_REVIEW: 'ตรวจ CTR', OWNERSHIP_REVIEW: 'ตรวจเจ้าของคำ',
}
export const guardLabels: Record<string, string> = {
  WAITING: 'รอคิวตรวจ', RUNNING: 'กำลังตรวจ', CRITICAL: 'ควรตรวจเร่งด่วน',
  REVIEW: 'ต้องตรวจรายละเอียด', STALE: 'ผลตรวจเก่า', HTTP_OK: 'HTTP/HTML ผ่านเบื้องต้น',
}
export function activeOpportunity(row: { source_at: string; status: string }, now = Date.now()) {
  const time = Date.parse(row.source_at)
  return row.status === 'OPEN' && Number.isFinite(time) && time >= now - 4 * 86_400_000 && time <= now + 300_000
}
export function guardNotes(row: { error: string | null; noindex: boolean | null; canonical: string | null; title: string | null; h1_count: number | null; changed: boolean; completed_at: string | null }) {
  if (!row.completed_at) return ['รอผลตรวจ • ยังสรุปไม่ได้']
  const notes: string[] = []
  if (row.error) notes.push(row.error)
  if (row.noindex) notes.push('พบสัญญาณ noindex ใน HTTP/HTML')
  if (!row.title) notes.push('อ่าน Title ไม่ได้')
  if (!row.canonical) notes.push('อ่าน canonical ไม่ได้')
  if (row.h1_count !== null && row.h1_count !== 1) notes.push(`พบ H1 ${row.h1_count} จุด`)
  if (row.changed) notes.push('Title / canonical / noindex เปลี่ยนจากรอบก่อน')
  return notes
}
