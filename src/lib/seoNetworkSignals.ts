import type { SeoNetworkSite } from './seoNetwork'

export function sourceState(site: Pick<SeoNetworkSite, 'source_at' | 'gsc_state'>, now = Date.now()) {
  if (!site.source_at) return 'MISSING'
  const time = Date.parse(site.source_at)
  if (!Number.isFinite(time) || time > now + 60_000 || now - time > 4 * 86_400_000) return 'STALE'
  return site.gsc_state === 'READY' ? 'FRESH' : 'BLOCKED'
}

export function networkIssues(site: SeoNetworkSite) {
  const issues: { level: 'critical' | 'warning' | 'info'; text: string; action: string }[] = []
  if (site.health_error || (site.home_status !== null && site.home_status >= 400)) {
    issues.push({ level: 'critical', text: site.health_error || `หน้าแรกตอบ HTTP ${site.home_status}`, action: 'ตรวจโฮสติ้งและเส้นทางหน้าแรก' })
  }
  if (site.noindex) issues.push({ level: 'critical', text: 'พบ noindex ที่หน้าแรก', action: 'ตรวจ meta robots และ X-Robots-Tag ของหน้าแรก' })
  if (site.robots_blocks_all) issues.push({ level: 'critical', text: 'พบรูปแบบ robots.txt ที่อาจปิดการเก็บข้อมูลทั้งเว็บ', action: 'ตรวจกลุ่ม User-agent และ Disallow ใน robots.txt' })
  if ((site.robots_status ?? 0) >= 400 || (site.sitemap_status ?? 0) >= 400 || site.robots_error || site.sitemap_error) {
    issues.push({ level: 'warning', text: `robots.txt: ${site.robots_error || site.robots_status || '—'} • sitemap.xml: ${site.sitemap_error || site.sitemap_status || '—'}`, action: 'ตรวจไฟล์และ URL sitemap ที่เว็บประกาศใช้งานจริง' })
  }
  if (site.health_state === 'STALE') issues.push({ level: 'warning', text: 'ผลตรวจสุขภาพเว็บเกินรอบที่กำหนด', action: 'ตรวจประวัติการทำงานของตัวตรวจทุก 3 วัน' })
  if (site.robots_changed || site.sitemap_changed) issues.push({ level: 'info', text: 'robots.txt หรือ sitemap เปลี่ยนจากรอบก่อน', action: 'ตรวจเทียบกับการเผยแพร่เว็บไซต์ล่าสุด' })
  const source = sourceState(site)
  if (source !== 'FRESH') issues.push({ level: 'warning', text: source === 'MISSING' ? 'ยังไม่มีข้อมูล GSC ของเว็บนี้' : source === 'STALE' ? 'ข้อมูล GSC เก่า' : 'ดึงข้อมูล GSC ใหม่ถูกระงับ', action: site.gsc_note })
  return issues
}
