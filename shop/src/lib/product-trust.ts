import type { StoreImage, StoreProduct } from './store-api'

const LABELS: Record<string, string> = {
  model_code: 'Model Code',
  cpu: 'CPU', gpu: 'GPU', ram: 'RAM', ssd: 'SSD / Storage', storage: 'ความจุ',
  storage_capacity: 'ความจุ', storage_type: 'ชนิด Storage', storage_interface: 'Interface',
  screen_size: 'ขนาดหน้าจอ', resolution: 'ความละเอียด', refresh_rate: 'Refresh Rate',
  battery: 'แบตเตอรี่', battery_health: 'Battery Health', cycle_count: 'Cycle Count',
  color: 'สี', region: 'Region', edition: 'Edition',
  face_id: 'Face ID', true_tone: 'True Tone', touch_id: 'Touch ID',
  screen_condition: 'สภาพหน้าจอ', body_condition: 'สภาพบอดี้', sensor_condition: 'สภาพ Sensor',
  shutter_count: 'Shutter Count', stick_drift: 'Stick Drift', dead_pixel: 'Dead Pixel',
  light_bleed: 'Light Bleed', drive_health: 'Storage Health', component_condition: 'ผลทดสอบ',
  accessory_condition: 'ผลทดสอบ', connection: 'การเชื่อมต่อ', compatibility: 'รองรับอุปกรณ์',
  monitor_accessories: 'อุปกรณ์จอ', gaming_accessories: 'อุปกรณ์เครื่องเกม',
  component_accessories: 'กล่อง / อุปกรณ์', box_accessories: 'กล่อง / อุปกรณ์',
  camera_accessories: 'อุปกรณ์กล้อง', lens_accessories: 'อุปกรณ์เลนส์',
  notebook_accessories: 'อุปกรณ์โน้ตบุ๊ก', phone_accessories: 'อุปกรณ์มือถือ',
  tablet_accessories: 'อุปกรณ์แท็บเล็ต', pc_accessories: 'อุปกรณ์คอม',
  inspection_date: 'วันที่ตรวจเครื่อง', inspection_result: 'ผลตรวจโดยรวม',
  basic_function_test: 'เปิดเครื่อง / ใช้งานพื้นฐาน',
  keyboard_test: 'คีย์บอร์ด / Trackpad', ports_test: 'พอร์ต / Connector',
  wifi_bluetooth_test: 'Wi-Fi / Bluetooth', webcam_mic_test: 'Webcam / Microphone',
  speaker_test: 'ลำโพง', speaker_mic_test: 'ลำโพง / ไมค์',
  storage_health: 'SSD / Storage Health', stress_test: 'Stress Test CPU / GPU',
  gpu_stress_test: 'Stress Test GPU', temperature_test: 'อุณหภูมิขณะทดสอบ',
  charging_test: 'ชาร์จ / พอร์ตชาร์จ', camera_test: 'กล้อง', button_test: 'ปุ่ม / สวิตช์',
  autofocus_test: 'Auto Focus', video_test: 'บันทึกวิดีโอ', card_slot_test: 'Memory Card Slot',
  zoom_focus_ring_test: 'Zoom / Focus Ring', input_port_test: 'HDMI / DisplayPort / USB-C',
  burn_in_test: 'Burn-in / Image Retention', network_test: 'Wi-Fi / Network',
  controller_test: 'Controller / ปุ่ม', benchmark_test: 'Benchmark / Burn-in Test',
  connection_test: 'การเชื่อมต่อ',
}

const ACCESSORY_RE = /(accessor|box|charger|adapter|dock|controller|joy.?con|cable|สาย|กล่อง|อุปกรณ์)/i
const CONDITION_RE = /(condition|health|battery|cycle|face_id|true_tone|touch_id|dead_pixel|light_bleed|stick_drift|shutter|test|ตรวจ|สภาพ|drive_health|sensor)/i

const PRODUCT_EVIDENCE_KEYS = [
  'inspection_date', 'inspection_result', 'basic_function_test',
  'battery', 'battery_health', 'battery_cycle', 'cycle_count',
  'screen_condition', 'dead_pixel', 'light_bleed', 'hinge_condition',
  'keyboard_test', 'ports_test', 'wifi_bluetooth_test', 'webcam_mic_test',
  'speaker_test', 'speaker_mic_test', 'storage_health', 'drive_health',
  'stress_test', 'gpu_stress_test', 'temperature_test',
  'charging_test', 'camera_test', 'button_test',
  'face_id', 'true_tone', 'touch_id', 'repair_history',
  'sensor_condition', 'shutter', 'shutter_count', 'evf_condition', 'lcd_condition',
  'autofocus_test', 'video_test', 'card_slot_test', 'zoom_focus_ring_test',
  'dead_pixel', 'burn_in_test', 'input_port_test',
  'stick_drift', 'network_test', 'controller_test',
  'component_condition', 'benchmark_test', 'accessory_condition', 'connection_test',
] as const

const PRODUCT_EVIDENCE_IMAGE_ROLES = new Set([
  'defect', 'warranty', 'test', 'battery', 'pixel_test', 'ports',
  'benchmark', 'spec', 'about', 'shutter', 'screen_on',
])

export function humanizeSpecKey(key: string) {
  if (LABELS[key]) return LABELS[key]
  return key
    .replace(/_/g, ' ')
    .replace(/\b(cpu|gpu|ssd|ram|usb|hdmi|imei)\b/gi, (value) => value.toUpperCase())
    .replace(/\b\w/g, (value) => value.toUpperCase())
}

export function specValue(value: unknown) {
  if (Array.isArray(value)) return value.join(', ')
  if (value && typeof value === 'object') return JSON.stringify(value)
  return String(value ?? '').trim()
}

export function groupPublicSpecs(product: StoreProduct) {
  const core: Array<[string, string]> = []
  const condition: Array<[string, string]> = []
  const accessories: Array<[string, string]> = []

  for (const [key, raw] of Object.entries(product.specs || {})) {
    const value = specValue(raw)
    if (!value) continue
    if ((PRODUCT_EVIDENCE_KEYS as readonly string[]).includes(key)) continue
    const row: [string, string] = [humanizeSpecKey(key), value]
    if (ACCESSORY_RE.test(key)) accessories.push(row)
    else if (CONDITION_RE.test(key)) condition.push(row)
    else core.push(row)
  }
  return { core, condition, accessories }
}

export const IMAGE_ROLE_LABELS: Record<string, string> = {
  cover: 'รูปหลัก', front: 'ด้านหน้า', back: 'ด้านหลัง', side: 'ด้านข้าง',
  screen: 'หน้าจอ', screen_on: 'เปิดจอ', keyboard: 'คีย์บอร์ด', ports: 'พอร์ต',
  serial: 'ฉลากรุ่น / Serial', label: 'ฉลากรุ่น', defect: 'รูปตำหนิ',
  accessories: 'รูปอุปกรณ์', warranty: 'หลักฐานประกัน', test: 'ผลทดสอบ',
  pixel_test: 'Pixel Test', battery: 'Battery Health', benchmark: 'Benchmark / Stress Test',
  spec: 'หน้าสเปก / ผลระบบ', about: 'ข้อมูลเครื่อง', shutter: 'Shutter Count',
  controller: 'Controller', dock: 'Dock', stand: 'ขาตั้ง',
  sensor: 'Sensor', mount: 'Mount', lens: 'เลนส์', body: 'ตัวเครื่อง', other: 'รูปเพิ่มเติม',
}

export function imageRoleLabel(role: string | null | undefined) {
  return IMAGE_ROLE_LABELS[String(role || 'other')] || humanizeSpecKey(String(role || 'other'))
}

export function evidenceImages(images: StoreImage[], role: string) {
  return images.filter((image) => image.role === role)
}

export function productEvidence(product: StoreProduct) {
  const roles = new Set(product.images.map((image) => image.role))
  const evidenceRows = PRODUCT_EVIDENCE_KEYS
    .filter((key) => key !== 'inspection_date' && key !== 'inspection_result')
    .map((key) => [humanizeSpecKey(key), specValue(product.specs?.[key])] as [string, string])
    .filter(([, value]) => Boolean(value))
  const evidenceImages = product.images.filter((image) => PRODUCT_EVIDENCE_IMAGE_ROLES.has(String(image.role || '')))

  return {
    hasRealImages: product.images.length > 0,
    imageCount: product.images.length,
    hasDefectImage: roles.has('defect'),
    hasAccessoryImage: roles.has('accessories'),
    hasWarrantyImage: roles.has('warranty'),
    inspectionDate: specValue(product.specs?.inspection_date) || null,
    inspectionResult: specValue(product.specs?.inspection_result) || null,
    evidenceRows,
    evidenceFieldCount: evidenceRows.length
      + (specValue(product.specs?.inspection_date) ? 1 : 0)
      + (specValue(product.specs?.inspection_result) ? 1 : 0),
    evidenceImageCount: evidenceImages.length,
    evidenceImages,
    hasProductEvidence: evidenceRows.length > 0
      || Boolean(specValue(product.specs?.inspection_date))
      || Boolean(specValue(product.specs?.inspection_result))
      || evidenceImages.length > 0,
  }
}
