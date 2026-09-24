import type { ProductCategory, ProductDraft } from '../types/product'

export type FieldImportance = 'required' | 'recommended' | 'optional'
export type SmartFieldType = 'text' | 'number' | 'select' | 'textarea' | 'date'

export interface SmartFieldDefinition {
  key: string
  label: string
  importance: FieldImportance
  type?: SmartFieldType
  placeholder?: string
  options?: string[]
  inputMode?: 'text' | 'numeric' | 'decimal'
  section?: 'spec' | 'condition' | 'accessory'
  whenSubtypes?: string[]
}

export interface ProductSubtype {
  value: string
  label: string
}

export interface ImageRoleDefinition {
  value: string
  label: string
  recommended?: boolean
}

export interface ProductCategoryDefinition {
  key: ProductCategory
  label: string
  icon: string
  subtypes: ProductSubtype[]
  fields: SmartFieldDefinition[]
  imageRoles: ImageRoleDefinition[]
}

const yesNoUnknown = ['ปกติ', 'มีปัญหา', 'ไม่ได้ตรวจ']
const normalUnknown = ['ปกติ', 'ไม่ปกติ', 'ไม่ได้ตรวจ']
const commonImageRoles: ImageRoleDefinition[] = [
  { value: 'cover', label: 'รูปหลัก', recommended: true },
  { value: 'front', label: 'ด้านหน้า', recommended: true },
  { value: 'back', label: 'ด้านหลัง' },
  { value: 'side', label: 'ด้านข้าง' },
  { value: 'serial', label: 'Serial / IMEI' },
  { value: 'defect', label: 'ตำหนิ' },
  { value: 'accessories', label: 'อุปกรณ์' },
  { value: 'warranty', label: 'ประกัน' },
  { value: 'other', label: 'อื่นๆ' },
]

const storageField: SmartFieldDefinition = { key: 'storage', label: 'ความจุ', importance: 'required', placeholder: 'เช่น 256GB' }
const colorField: SmartFieldDefinition = { key: 'color', label: 'สี', importance: 'recommended', placeholder: 'เช่น Natural Titanium' }
const modelCodeField: SmartFieldDefinition = { key: 'model_code', label: 'Model Code', importance: 'recommended', placeholder: 'เช่น FA707NV / A3102' }

const commonEvidenceFields: SmartFieldDefinition[] = [
  { key: 'inspection_date', label: 'วันที่ตรวจเครื่อง', importance: 'optional', type: 'date', section: 'condition' },
  { key: 'inspection_result', label: 'ผลตรวจโดยรวม', importance: 'optional', type: 'select', options: ['ผ่านการตรวจใช้งาน', 'พบข้อสังเกตตามที่ระบุ', 'รอตรวจเพิ่มเติม'], section: 'condition' },
  { key: 'basic_function_test', label: 'เปิดเครื่อง / ใช้งานพื้นฐาน', importance: 'optional', type: 'select', options: ['ปกติ', 'มีข้อสังเกต', 'ไม่ได้ตรวจ'], section: 'condition' },
]

const evidenceFieldsByCategory: Partial<Record<ProductCategory, SmartFieldDefinition[]>> = {
  notebook: [
    { key: 'keyboard_test', label: 'ทดสอบคีย์บอร์ด / Trackpad', importance: 'optional', type: 'select', options: ['ปกติ', 'มีข้อสังเกต', 'ไม่ได้ตรวจ'], section: 'condition' },
    { key: 'ports_test', label: 'ทดสอบพอร์ต USB / HDMI / Audio', importance: 'optional', type: 'select', options: ['ปกติ', 'มีข้อสังเกต', 'ไม่ได้ตรวจ'], section: 'condition' },
    { key: 'wifi_bluetooth_test', label: 'ทดสอบ Wi-Fi / Bluetooth', importance: 'optional', type: 'select', options: ['ปกติ', 'มีข้อสังเกต', 'ไม่ได้ตรวจ'], section: 'condition' },
    { key: 'webcam_mic_test', label: 'ทดสอบ Webcam / Microphone', importance: 'optional', type: 'select', options: ['ปกติ', 'มีข้อสังเกต', 'ไม่ได้ตรวจ'], section: 'condition' },
    { key: 'speaker_test', label: 'ทดสอบลำโพง', importance: 'optional', type: 'select', options: ['ปกติ', 'มีข้อสังเกต', 'ไม่ได้ตรวจ'], section: 'condition' },
    { key: 'storage_health', label: 'SSD / Storage Health', importance: 'optional', placeholder: 'เช่น 98% / Good / SMART ปกติ', section: 'condition' },
    { key: 'stress_test', label: 'Stress Test CPU / GPU', importance: 'optional', placeholder: 'เช่น AIDA64 15 นาที ผ่าน / ยังไม่ได้ทดสอบ', section: 'condition', whenSubtypes: ['gaming'] },
    { key: 'temperature_test', label: 'อุณหภูมิขณะทดสอบ', importance: 'optional', placeholder: 'เช่น CPU 86°C / GPU 74°C', section: 'condition', whenSubtypes: ['gaming'] },
  ],
  pc: [
    { key: 'ports_test', label: 'ทดสอบพอร์ตหน้า / หลัง', importance: 'optional', type: 'select', options: ['ปกติ', 'มีข้อสังเกต', 'ไม่ได้ตรวจ'], section: 'condition' },
    { key: 'storage_health', label: 'SSD / Storage Health', importance: 'optional', placeholder: 'เช่น 99% / SMART ปกติ', section: 'condition' },
    { key: 'stress_test', label: 'Stress Test CPU / RAM', importance: 'optional', placeholder: 'เช่น OCCT 20 นาที ผ่าน', section: 'condition' },
    { key: 'gpu_stress_test', label: 'Stress Test GPU', importance: 'optional', placeholder: 'เช่น FurMark 15 นาที ผ่าน', section: 'condition', whenSubtypes: ['gaming', 'workstation'] },
    { key: 'temperature_test', label: 'อุณหภูมิขณะทดสอบ', importance: 'optional', placeholder: 'เช่น CPU 78°C / GPU 72°C', section: 'condition' },
  ],
  iphone: [
    { key: 'charging_test', label: 'ทดสอบชาร์จ / พอร์ตชาร์จ', importance: 'optional', type: 'select', options: ['ปกติ', 'มีข้อสังเกต', 'ไม่ได้ตรวจ'], section: 'condition' },
    { key: 'speaker_mic_test', label: 'ทดสอบลำโพง / ไมค์', importance: 'optional', type: 'select', options: ['ปกติ', 'มีข้อสังเกต', 'ไม่ได้ตรวจ'], section: 'condition' },
    { key: 'camera_test', label: 'ทดสอบกล้องหน้า / หลัง', importance: 'optional', type: 'select', options: ['ปกติ', 'มีข้อสังเกต', 'ไม่ได้ตรวจ'], section: 'condition' },
    { key: 'wifi_bluetooth_test', label: 'ทดสอบ Wi-Fi / Bluetooth', importance: 'optional', type: 'select', options: ['ปกติ', 'มีข้อสังเกต', 'ไม่ได้ตรวจ'], section: 'condition' },
    { key: 'button_test', label: 'ทดสอบปุ่ม / สวิตช์', importance: 'optional', type: 'select', options: ['ปกติ', 'มีข้อสังเกต', 'ไม่ได้ตรวจ'], section: 'condition' },
  ],
  smartphone: [
    { key: 'charging_test', label: 'ทดสอบชาร์จ / พอร์ตชาร์จ', importance: 'optional', type: 'select', options: ['ปกติ', 'มีข้อสังเกต', 'ไม่ได้ตรวจ'], section: 'condition' },
    { key: 'speaker_mic_test', label: 'ทดสอบลำโพง / ไมค์', importance: 'optional', type: 'select', options: ['ปกติ', 'มีข้อสังเกต', 'ไม่ได้ตรวจ'], section: 'condition' },
    { key: 'camera_test', label: 'ทดสอบกล้องหน้า / หลัง', importance: 'optional', type: 'select', options: ['ปกติ', 'มีข้อสังเกต', 'ไม่ได้ตรวจ'], section: 'condition' },
    { key: 'wifi_bluetooth_test', label: 'ทดสอบ Wi-Fi / Bluetooth', importance: 'optional', type: 'select', options: ['ปกติ', 'มีข้อสังเกต', 'ไม่ได้ตรวจ'], section: 'condition' },
    { key: 'button_test', label: 'ทดสอบปุ่ม / สวิตช์', importance: 'optional', type: 'select', options: ['ปกติ', 'มีข้อสังเกต', 'ไม่ได้ตรวจ'], section: 'condition' },
  ],
  tablet: [
    { key: 'charging_test', label: 'ทดสอบชาร์จ / พอร์ตชาร์จ', importance: 'optional', type: 'select', options: ['ปกติ', 'มีข้อสังเกต', 'ไม่ได้ตรวจ'], section: 'condition' },
    { key: 'speaker_mic_test', label: 'ทดสอบลำโพง / ไมค์', importance: 'optional', type: 'select', options: ['ปกติ', 'มีข้อสังเกต', 'ไม่ได้ตรวจ'], section: 'condition' },
    { key: 'camera_test', label: 'ทดสอบกล้อง', importance: 'optional', type: 'select', options: ['ปกติ', 'มีข้อสังเกต', 'ไม่ได้ตรวจ'], section: 'condition' },
    { key: 'wifi_bluetooth_test', label: 'ทดสอบ Wi-Fi / Bluetooth', importance: 'optional', type: 'select', options: ['ปกติ', 'มีข้อสังเกต', 'ไม่ได้ตรวจ'], section: 'condition' },
  ],
  camera: [
    { key: 'autofocus_test', label: 'ทดสอบ Auto Focus', importance: 'optional', type: 'select', options: ['ปกติ', 'มีข้อสังเกต', 'ไม่ได้ตรวจ'], section: 'condition' },
    { key: 'video_test', label: 'ทดสอบบันทึกวิดีโอ', importance: 'optional', type: 'select', options: ['ปกติ', 'มีข้อสังเกต', 'ไม่ได้ตรวจ'], section: 'condition' },
    { key: 'card_slot_test', label: 'ทดสอบช่อง Memory Card', importance: 'optional', type: 'select', options: ['ปกติ', 'มีข้อสังเกต', 'ไม่ได้ตรวจ'], section: 'condition' },
  ],
  lens: [
    { key: 'autofocus_test', label: 'ทดสอบ Auto Focus', importance: 'optional', type: 'select', options: ['ปกติ', 'มีข้อสังเกต', 'ไม่ได้ตรวจ'], section: 'condition' },
    { key: 'zoom_focus_ring_test', label: 'ทดสอบวงแหวน Zoom / Focus', importance: 'optional', type: 'select', options: ['ปกติ', 'มีข้อสังเกต', 'ไม่ได้ตรวจ'], section: 'condition' },
  ],
  monitor: [
    { key: 'input_port_test', label: 'ทดสอบ HDMI / DisplayPort / USB-C', importance: 'optional', type: 'select', options: ['ปกติ', 'มีข้อสังเกต', 'ไม่ได้ตรวจ'], section: 'condition' },
    { key: 'burn_in_test', label: 'ทดสอบ Burn-in / Image Retention', importance: 'optional', type: 'select', options: ['ไม่พบ', 'พบ', 'ไม่ได้ตรวจ'], section: 'condition' },
  ],
  gaming: [
    { key: 'charging_test', label: 'ทดสอบชาร์จ / Power', importance: 'optional', type: 'select', options: ['ปกติ', 'มีข้อสังเกต', 'ไม่ได้ตรวจ'], section: 'condition' },
    { key: 'network_test', label: 'ทดสอบ Wi-Fi / Network', importance: 'optional', type: 'select', options: ['ปกติ', 'มีข้อสังเกต', 'ไม่ได้ตรวจ'], section: 'condition' },
    { key: 'controller_test', label: 'ทดสอบ Controller / ปุ่ม', importance: 'optional', type: 'select', options: ['ปกติ', 'มีข้อสังเกต', 'ไม่ได้ตรวจ'], section: 'condition' },
  ],
  component: [
    { key: 'benchmark_test', label: 'Benchmark / Burn-in Test', importance: 'optional', placeholder: 'เช่น 3DMark / MemTest / CrystalDiskMark ผ่าน', section: 'condition' },
  ],
  accessory: [
    { key: 'connection_test', label: 'ทดสอบการเชื่อมต่อ', importance: 'optional', type: 'select', options: ['ปกติ', 'มีข้อสังเกต', 'ไม่ได้ตรวจ'], section: 'condition' },
  ],
}

const evidenceImageRoles: ImageRoleDefinition[] = [
  { value: 'test', label: 'หลักฐานผลทดสอบ' },
  { value: 'battery', label: 'หลักฐาน Battery Health' },
  { value: 'pixel_test', label: 'หลักฐาน Pixel Test' },
  { value: 'ports', label: 'หลักฐานพอร์ต / Connector' },
  { value: 'benchmark', label: 'Benchmark / Stress Test' },
]


export const productSchemas: ProductCategoryDefinition[] = [
  {
    key: 'notebook', label: 'Notebook', icon: '💻',
    subtypes: [
      { value: 'general', label: 'ทั่วไป' }, { value: 'gaming', label: 'Gaming' },
      { value: 'business', label: 'Business' }, { value: 'macbook', label: 'MacBook' }, { value: 'other', label: 'อื่นๆ' },
    ],
    fields: [
      modelCodeField,
      { key: 'cpu', label: 'CPU', importance: 'required', placeholder: 'เช่น Ryzen 7 8845HS' },
      { key: 'gpu', label: 'GPU', importance: 'required', placeholder: 'เช่น RTX 4060 8GB', whenSubtypes: ['gaming'] },
      { key: 'gpu', label: 'GPU', importance: 'recommended', placeholder: 'เช่น Intel Iris Xe / RTX 2050', whenSubtypes: ['general', 'business', 'macbook', 'other'] },
      { key: 'ram', label: 'RAM', importance: 'required', placeholder: 'เช่น 16GB DDR5' },
      { key: 'ssd', label: 'SSD / Storage', importance: 'required', placeholder: 'เช่น 512GB NVMe' },
      { key: 'screen_size', label: 'ขนาดหน้าจอ', importance: 'recommended', placeholder: 'เช่น 15.6 นิ้ว' },
      { key: 'resolution', label: 'ความละเอียดจอ', importance: 'recommended', placeholder: 'เช่น FHD 1920x1080' },
      { key: 'refresh_rate', label: 'Refresh Rate', importance: 'recommended', placeholder: 'เช่น 144Hz', whenSubtypes: ['gaming'] },
      { key: 'battery', label: 'Battery Health', importance: 'recommended', placeholder: 'เช่น 89% / ปกติ' },
      { key: 'battery_cycle', label: 'Battery Cycle', importance: 'optional', placeholder: 'เช่น 120 รอบ', whenSubtypes: ['macbook'] },
      { key: 'keyboard_layout', label: 'ภาษาแป้นพิมพ์', importance: 'recommended', placeholder: 'เช่น TH/EN หรือ KR' },
      { key: 'charger', label: 'Adapter / Charger', importance: 'recommended', placeholder: 'เช่น แท้ 240W', section: 'accessory' },
      { key: 'screen_condition', label: 'สภาพหน้าจอ', importance: 'recommended', type: 'select', options: ['ปกติ', 'มีรอย', 'มีจุด/เส้น', 'ไม่ได้ตรวจ'], section: 'condition' },
      { key: 'hinge_condition', label: 'สภาพบานพับ', importance: 'recommended', type: 'select', options: yesNoUnknown, section: 'condition' },
    ],
    imageRoles: [...commonImageRoles, { value: 'screen', label: 'หน้าจอ', recommended: true }, { value: 'keyboard', label: 'คีย์บอร์ด', recommended: true }, { value: 'bottom', label: 'ใต้เครื่อง' }, { value: 'spec', label: 'หน้าสเปก' }],
  },
  {
    key: 'pc', label: 'Desktop PC', icon: '🖥️',
    subtypes: [{ value: 'gaming', label: 'Gaming PC' }, { value: 'office', label: 'Office PC' }, { value: 'workstation', label: 'Workstation' }, { value: 'mini_pc', label: 'Mini PC' }, { value: 'aio', label: 'All-in-One' }, { value: 'other', label: 'อื่นๆ' }],
    fields: [
      modelCodeField,
      { key: 'cpu', label: 'CPU', importance: 'required', placeholder: 'เช่น Core i5-14400' },
      { key: 'cooler', label: 'CPU Cooler', importance: 'optional', placeholder: 'เช่น DeepCool AK400' },
      { key: 'mainboard', label: 'Mainboard', importance: 'required', placeholder: 'เช่น B760M' },
      { key: 'ram', label: 'RAM', importance: 'required', placeholder: 'เช่น 16GB DDR5 5600' },
      { key: 'gpu', label: 'GPU', importance: 'required', placeholder: 'เช่น RTX 4060 8GB', whenSubtypes: ['gaming', 'workstation'] },
      { key: 'gpu', label: 'GPU', importance: 'recommended', placeholder: 'เช่น Intel UHD / ไม่มีการ์ดจอแยก', whenSubtypes: ['office', 'mini_pc', 'aio', 'other'] },
      { key: 'ssd', label: 'SSD', importance: 'required', placeholder: 'เช่น NVMe 512GB' },
      { key: 'hdd', label: 'HDD / Storage เพิ่มเติม', importance: 'optional', placeholder: 'เช่น HDD 1TB' },
      { key: 'psu', label: 'Power Supply', importance: 'recommended', placeholder: 'เช่น 650W 80+ Bronze' },
      { key: 'case', label: 'Case', importance: 'recommended', placeholder: 'เช่น Montech Air 100' },
      { key: 'wifi', label: 'Wi-Fi / Bluetooth', importance: 'optional', placeholder: 'เช่น Wi-Fi 6 + BT 5.2' },
      { key: 'warranty_parts', label: 'ประกันรายชิ้น', importance: 'recommended', type: 'textarea', placeholder: 'เช่น VGA ประกัน Advice ถึง ... / อื่นๆ หมดประกัน', section: 'condition' },
    ],
    imageRoles: [...commonImageRoles, { value: 'inside', label: 'ภายในเครื่อง', recommended: true }, { value: 'ports', label: 'พอร์ตด้านหลัง' }, { value: 'spec', label: 'หน้าสเปก', recommended: true }],
  },
  {
    key: 'iphone', label: 'iPhone', icon: '📱',
    subtypes: [{ value: 'iphone', label: 'iPhone' }],
    fields: [
      modelCodeField, storageField, colorField,
      { key: 'region', label: 'รหัสเครื่อง / Region', importance: 'recommended', placeholder: 'เช่น TH/A, LL/A' },
      { key: 'battery', label: 'Battery Health', importance: 'required', placeholder: 'เช่น 89%' },
      { key: 'battery_cycle', label: 'Battery Cycle', importance: 'optional', placeholder: 'เช่น 230 รอบ' },
      { key: 'sim_type', label: 'SIM', importance: 'recommended', placeholder: 'เช่น Dual SIM / eSIM' },
      { key: 'face_id', label: 'Face ID', importance: 'required', type: 'select', options: normalUnknown, section: 'condition' },
      { key: 'true_tone', label: 'True Tone', importance: 'recommended', type: 'select', options: normalUnknown, section: 'condition' },
      { key: 'screen_condition', label: 'หน้าจอ', importance: 'required', type: 'select', options: ['ปกติ', 'มีรอย', 'มีเส้น/จุด', 'แตก', 'ไม่ได้ตรวจ'], section: 'condition' },
      { key: 'repair_history', label: 'ประวัติการซ่อม', importance: 'required', type: 'select', options: ['ไม่เคยซ่อม', 'ไม่ทราบ', 'เคยเปลี่ยนจอ', 'เคยเปลี่ยนแบต', 'เคยซ่อมบอร์ด', 'อื่นๆ'], section: 'condition' },
      { key: 'box_accessories', label: 'กล่อง / อุปกรณ์', importance: 'recommended', placeholder: 'เช่น กล่องครบ + สายชาร์จ', section: 'accessory' },
    ],
    imageRoles: [...commonImageRoles, { value: 'screen', label: 'หน้าจอ', recommended: true }, { value: 'battery', label: 'Battery Health', recommended: true }, { value: 'about', label: 'About / ข้อมูลเครื่อง' }],
  },
  {
    key: 'smartphone', label: 'Android Phone', icon: '📲',
    subtypes: [{ value: 'android', label: 'Android' }, { value: 'other', label: 'อื่นๆ' }],
    fields: [
      modelCodeField,
      { key: 'chipset', label: 'Chipset / CPU', importance: 'required', placeholder: 'เช่น Snapdragon 8 Gen 3' },
      { key: 'ram', label: 'RAM', importance: 'required', placeholder: 'เช่น 12GB' }, storageField, colorField,
      { key: 'battery', label: 'Battery / Battery Health', importance: 'recommended', placeholder: 'เช่น ปกติ / 5000mAh' },
      { key: 'sim_type', label: 'SIM / 5G', importance: 'recommended', placeholder: 'เช่น Dual SIM 5G' },
      { key: 'screen_condition', label: 'หน้าจอ', importance: 'required', type: 'select', options: ['ปกติ', 'มีรอย', 'Burn-in', 'มีเส้น/จุด', 'แตก', 'ไม่ได้ตรวจ'], section: 'condition' },
      { key: 'fingerprint', label: 'Fingerprint', importance: 'recommended', type: 'select', options: normalUnknown, section: 'condition' },
      { key: 'repair_history', label: 'ประวัติการซ่อม', importance: 'recommended', placeholder: 'เช่น ไม่ทราบ / ไม่เคยซ่อม / เปลี่ยนจอ', section: 'condition' },
      { key: 'box_accessories', label: 'กล่อง / อุปกรณ์', importance: 'recommended', placeholder: 'เช่น กล่อง + สายชาร์จ', section: 'accessory' },
    ],
    imageRoles: [...commonImageRoles, { value: 'screen', label: 'หน้าจอ', recommended: true }, { value: 'about', label: 'ข้อมูลเครื่อง' }],
  },
  {
    key: 'tablet', label: 'iPad / Tablet', icon: '▣',
    subtypes: [{ value: 'ipad', label: 'iPad' }, { value: 'android', label: 'Android Tablet' }, { value: 'windows', label: 'Windows Tablet' }, { value: 'other', label: 'อื่นๆ' }],
    fields: [
      modelCodeField, storageField, colorField,
      { key: 'chipset', label: 'Chip / CPU', importance: 'recommended', placeholder: 'เช่น Apple M2 / Snapdragon 8 Gen 2' },
      { key: 'connectivity', label: 'การเชื่อมต่อ', importance: 'required', type: 'select', options: ['Wi-Fi', 'Wi-Fi + Cellular'], section: 'spec' },
      { key: 'battery', label: 'Battery Health', importance: 'recommended', placeholder: 'เช่น 92% / ปกติ' },
      { key: 'pencil_support', label: 'ปากกาที่รองรับ', importance: 'optional', placeholder: 'เช่น Apple Pencil Pro', whenSubtypes: ['ipad'] },
      { key: 'screen_condition', label: 'หน้าจอ / Touch', importance: 'required', type: 'select', options: ['ปกติ', 'มีรอย', 'มีเส้น/จุด', 'Touch มีปัญหา', 'ไม่ได้ตรวจ'], section: 'condition' },
      { key: 'box_accessories', label: 'กล่อง / อุปกรณ์', importance: 'recommended', placeholder: 'เช่น กล่อง + Adapter + สาย', section: 'accessory' },
    ],
    imageRoles: [...commonImageRoles, { value: 'screen', label: 'หน้าจอ', recommended: true }, { value: 'about', label: 'ข้อมูลเครื่อง' }],
  },
  {
    key: 'camera', label: 'Camera', icon: '📷',
    subtypes: [{ value: 'mirrorless', label: 'Mirrorless' }, { value: 'dslr', label: 'DSLR' }, { value: 'compact', label: 'Compact' }, { value: 'action', label: 'Action Camera' }, { value: 'other', label: 'อื่นๆ' }],
    fields: [
      modelCodeField,
      { key: 'mount', label: 'Mount', importance: 'recommended', placeholder: 'เช่น Sony E / Fuji X' },
      { key: 'sensor', label: 'Sensor', importance: 'recommended', placeholder: 'เช่น APS-C 26MP' },
      { key: 'shutter', label: 'Shutter Count', importance: 'required', placeholder: 'เช่น 20,000 / ไม่ทราบ' },
      { key: 'lens', label: 'Lens / Kit ที่มาด้วย', importance: 'optional', placeholder: 'เช่น 18-55mm F2.8-4' },
      { key: 'sensor_condition', label: 'สภาพ Sensor', importance: 'required', type: 'select', options: ['ปกติ', 'มีฝุ่น', 'มีรอย', 'ไม่ได้ตรวจ'], section: 'condition' },
      { key: 'evf_condition', label: 'EVF', importance: 'recommended', type: 'select', options: ['ปกติ', 'มีฝุ่น', 'มีรา', 'ไม่มี EVF', 'ไม่ได้ตรวจ'], section: 'condition' },
      { key: 'lcd_condition', label: 'LCD', importance: 'recommended', type: 'select', options: ['ปกติ', 'มีรอย', 'มีปัญหา', 'ไม่ได้ตรวจ'], section: 'condition' },
      { key: 'battery_count', label: 'จำนวนแบตเตอรี่', importance: 'recommended', placeholder: 'เช่น 1 ก้อน', section: 'accessory' },
      { key: 'camera_accessories', label: 'อุปกรณ์', importance: 'recommended', placeholder: 'เช่น ที่ชาร์จ + สายคล้อง + Body Cap', section: 'accessory' },
    ],
    imageRoles: [...commonImageRoles, { value: 'sensor', label: 'Sensor' }, { value: 'screen', label: 'LCD' }, { value: 'evf', label: 'EVF' }, { value: 'shutter', label: 'Shutter Count', recommended: true }],
  },
  {
    key: 'lens', label: 'Lens', icon: '🔭',
    subtypes: [{ value: 'mirrorless', label: 'Mirrorless Lens' }, { value: 'dslr', label: 'DSLR Lens' }, { value: 'other', label: 'อื่นๆ' }],
    fields: [
      modelCodeField,
      { key: 'mount', label: 'Mount', importance: 'required', placeholder: 'เช่น Sony E / Canon RF' },
      { key: 'focal_length', label: 'Focal Length', importance: 'required', placeholder: 'เช่น 56mm / 18-55mm' },
      { key: 'aperture', label: 'Maximum Aperture', importance: 'required', placeholder: 'เช่น F1.4 / F2.8-4' },
      { key: 'lens_type', label: 'ชนิดเลนส์', importance: 'recommended', type: 'select', options: ['Prime', 'Zoom'] },
      { key: 'autofocus', label: 'Autofocus', importance: 'required', type: 'select', options: normalUnknown, section: 'condition' },
      { key: 'front_glass', label: 'หน้าเลนส์', importance: 'required', type: 'select', options: ['ใสปกติ', 'มีรอย', 'มีรา', 'มีฝ้า', 'ไม่ได้ตรวจ'], section: 'condition' },
      { key: 'rear_glass', label: 'ท้ายเลนส์', importance: 'recommended', type: 'select', options: ['ใสปกติ', 'มีรอย', 'มีรา', 'มีฝ้า', 'ไม่ได้ตรวจ'], section: 'condition' },
      { key: 'internal_optics', label: 'ภายในเลนส์', importance: 'required', type: 'select', options: ['ปกติ', 'มีฝุ่นเล็กน้อย', 'มีฝุ่นมาก', 'มีรา', 'มีฝ้า', 'ไม่ได้ตรวจ'], section: 'condition' },
      { key: 'lens_accessories', label: 'อุปกรณ์', importance: 'recommended', placeholder: 'เช่น Hood + ฝาหน้า + ฝาหลัง', section: 'accessory' },
    ],
    imageRoles: [...commonImageRoles, { value: 'front_glass', label: 'หน้าเลนส์', recommended: true }, { value: 'rear_glass', label: 'ท้ายเลนส์', recommended: true }, { value: 'mount', label: 'Mount' }],
  },
  {
    key: 'monitor', label: 'Monitor', icon: '🖥️',
    subtypes: [{ value: 'gaming', label: 'Gaming' }, { value: 'office', label: 'Office' }, { value: 'professional', label: 'Professional' }, { value: 'portable', label: 'Portable' }, { value: 'other', label: 'อื่นๆ' }],
    fields: [
      modelCodeField,
      { key: 'screen_size', label: 'ขนาดจอ', importance: 'required', placeholder: 'เช่น 27 นิ้ว' },
      { key: 'resolution', label: 'Resolution', importance: 'required', placeholder: 'เช่น 2560x1440 QHD' },
      { key: 'refresh_rate', label: 'Refresh Rate', importance: 'required', placeholder: 'เช่น 180Hz' },
      { key: 'panel', label: 'Panel', importance: 'recommended', placeholder: 'เช่น IPS' },
      { key: 'ports', label: 'Ports', importance: 'recommended', placeholder: 'เช่น HDMI 2.1, DP 1.4, USB-C' },
      { key: 'dead_pixel', label: 'Dead / Bright Pixel', importance: 'required', type: 'select', options: ['ไม่พบ', 'มี', 'ไม่ได้ตรวจ'], section: 'condition' },
      { key: 'light_bleed', label: 'Light Bleed', importance: 'recommended', type: 'select', options: ['ปกติ', 'มีเล็กน้อย', 'มีชัดเจน', 'ไม่ได้ตรวจ'], section: 'condition' },
      { key: 'monitor_accessories', label: 'ขาตั้ง / Adapter / สาย', importance: 'recommended', placeholder: 'เช่น ขาตั้งครบ + Adapter + HDMI', section: 'accessory' },
    ],
    imageRoles: [...commonImageRoles, { value: 'screen_on', label: 'เปิดจอ', recommended: true }, { value: 'pixel_test', label: 'Pixel Test', recommended: true }, { value: 'ports', label: 'Ports' }, { value: 'stand', label: 'ขาตั้ง' }],
  },
  {
    key: 'gaming', label: 'Gaming Console', icon: '🎮',
    subtypes: [{ value: 'switch', label: 'Nintendo Switch' }, { value: 'steam_deck', label: 'Steam Deck' }, { value: 'playstation', label: 'PlayStation' }, { value: 'xbox', label: 'Xbox' }, { value: 'handheld', label: 'Handheld อื่นๆ' }, { value: 'other', label: 'อื่นๆ' }],
    fields: [
      modelCodeField, storageField,
      { key: 'edition', label: 'Edition', importance: 'recommended', placeholder: 'เช่น OLED Splatoon 3 Edition' },
      { key: 'region', label: 'Region', importance: 'optional', placeholder: 'เช่น JP / US / TH' },
      { key: 'battery', label: 'Battery Health', importance: 'recommended', placeholder: 'เช่น ปกติ / 92%', whenSubtypes: ['switch', 'steam_deck', 'handheld'] },
      { key: 'stick_drift', label: 'Stick Drift', importance: 'required', type: 'select', options: ['ไม่พบ', 'มี', 'ไม่ได้ตรวจ'], section: 'condition' },
      { key: 'screen_condition', label: 'หน้าจอ', importance: 'recommended', type: 'select', options: ['ปกติ', 'มีรอย', 'มีปัญหา', 'ไม่มีหน้าจอ', 'ไม่ได้ตรวจ'], section: 'condition' },
      { key: 'gaming_accessories', label: 'อุปกรณ์', importance: 'required', placeholder: 'เช่น Dock + Charger + Joy-Con / Controller', section: 'accessory' },
    ],
    imageRoles: [...commonImageRoles, { value: 'screen', label: 'หน้าจอ', recommended: true }, { value: 'controller', label: 'Controller / Joy-Con' }, { value: 'dock', label: 'Dock' }],
  },
  {
    key: 'component', label: 'Component', icon: '🧩',
    subtypes: [
      { value: 'cpu', label: 'CPU' }, { value: 'gpu', label: 'GPU' }, { value: 'mainboard', label: 'Mainboard' },
      { value: 'ram', label: 'RAM' }, { value: 'ssd', label: 'SSD' }, { value: 'hdd', label: 'HDD' },
      { value: 'psu', label: 'PSU' }, { value: 'cooler', label: 'Cooler' }, { value: 'case', label: 'Case' }, { value: 'other', label: 'อื่นๆ' },
    ],
    fields: [
      modelCodeField,
      { key: 'socket', label: 'Socket', importance: 'required', placeholder: 'เช่น AM5 / LGA1700', whenSubtypes: ['cpu', 'mainboard'] },
      { key: 'vram', label: 'VRAM', importance: 'required', placeholder: 'เช่น 8GB GDDR6', whenSubtypes: ['gpu'] },
      { key: 'gpu_chip', label: 'GPU Model', importance: 'required', placeholder: 'เช่น RTX 4070 SUPER', whenSubtypes: ['gpu'] },
      { key: 'ram_capacity', label: 'ความจุ RAM', importance: 'required', placeholder: 'เช่น 32GB (16x2)', whenSubtypes: ['ram'] },
      { key: 'ram_type', label: 'ชนิด / Bus RAM', importance: 'recommended', placeholder: 'เช่น DDR5 6000', whenSubtypes: ['ram'] },
      { key: 'storage_capacity', label: 'ความจุ', importance: 'required', placeholder: 'เช่น 1TB', whenSubtypes: ['ssd', 'hdd'] },
      { key: 'storage_interface', label: 'Interface', importance: 'required', placeholder: 'เช่น NVMe PCIe 4.0 / SATA', whenSubtypes: ['ssd', 'hdd'] },
      { key: 'drive_health', label: 'Health', importance: 'required', placeholder: 'เช่น 99%', whenSubtypes: ['ssd', 'hdd'], section: 'condition' },
      { key: 'wattage', label: 'Wattage', importance: 'required', placeholder: 'เช่น 850W', whenSubtypes: ['psu'] },
      { key: 'psu_rating', label: '80 Plus', importance: 'recommended', placeholder: 'เช่น Gold', whenSubtypes: ['psu'] },
      { key: 'modular', label: 'Modular', importance: 'recommended', type: 'select', options: ['Full Modular', 'Semi Modular', 'Non-Modular'], whenSubtypes: ['psu'] },
      { key: 'component_condition', label: 'ผลทดสอบ', importance: 'required', type: 'select', options: ['ทดสอบปกติ', 'มีตำหนิ', 'ไม่ได้ทดสอบ'], section: 'condition' },
      { key: 'component_accessories', label: 'กล่อง / อุปกรณ์', importance: 'recommended', placeholder: 'เช่น กล่องครบ / เฉพาะตัว', section: 'accessory' },
    ],
    imageRoles: [...commonImageRoles, { value: 'label', label: 'ฉลากรุ่น / Serial', recommended: true }, { value: 'ports', label: 'Ports / Connector' }, { value: 'test', label: 'ผลทดสอบ' }],
  },
  {
    key: 'accessory', label: 'Accessories', icon: '⌨️',
    subtypes: [{ value: 'keyboard', label: 'Keyboard' }, { value: 'mouse', label: 'Mouse' }, { value: 'headset', label: 'Headset' }, { value: 'controller', label: 'Controller' }, { value: 'dock', label: 'Dock' }, { value: 'charger', label: 'Charger' }, { value: 'other', label: 'อื่นๆ' }],
    fields: [
      modelCodeField,
      { key: 'connection', label: 'การเชื่อมต่อ', importance: 'recommended', placeholder: 'เช่น USB-C / Bluetooth / 2.4G' },
      { key: 'compatibility', label: 'รองรับอุปกรณ์', importance: 'recommended', placeholder: 'เช่น Windows / macOS / PS5' },
      { key: 'accessory_condition', label: 'ผลทดสอบ', importance: 'required', type: 'select', options: ['ทดสอบปกติ', 'มีตำหนิ', 'ไม่ได้ทดสอบ'], section: 'condition' },
      { key: 'box_accessories', label: 'กล่อง / อุปกรณ์', importance: 'recommended', placeholder: 'เช่น กล่องครบ / เฉพาะตัว', section: 'accessory' },
    ],
    imageRoles: commonImageRoles,
  },
  {
    key: 'other', label: 'อื่นๆ', icon: '📦',
    subtypes: [{ value: 'other', label: 'อื่นๆ' }],
    fields: [modelCodeField, { key: 'detail', label: 'รายละเอียดสินค้า', importance: 'required', type: 'textarea', placeholder: 'ระบุสเปก/รายละเอียดสำคัญของสินค้า' }],
    imageRoles: commonImageRoles,
  },
]

export function getCategoryDefinition(category?: ProductCategory) {
  return productSchemas.find((item) => item.key === category)
}

export function getSmartFields(draft: Pick<ProductDraft, 'category' | 'subtype'>) {
  const definition = getCategoryDefinition(draft.category)
  if (!definition) return []
  return definition.fields.filter((field) => !field.whenSubtypes?.length || (draft.subtype ? field.whenSubtypes.includes(draft.subtype) : false))
}

export function getEvidenceFields(draft: Pick<ProductDraft, 'category' | 'subtype'>) {
  const categoryFields = draft.category ? evidenceFieldsByCategory[draft.category] ?? [] : []
  return [...commonEvidenceFields, ...categoryFields]
    .filter((field) => !field.whenSubtypes?.length || (draft.subtype ? field.whenSubtypes.includes(draft.subtype) : false))
}

export function getEvidenceCompleteness(draft: Pick<ProductDraft, 'category' | 'subtype' | 'specs'>) {
  const fields = getEvidenceFields(draft)
  const filled = fields.filter((field) => hasValue(draft.specs?.[field.key]))
  return {
    total: fields.length,
    filled: filled.length,
    score: fields.length ? Math.round((filled.length / fields.length) * 100) : 0,
    labels: filled.map((field) => field.label),
  }
}

export function getImageRoles(category?: ProductCategory) {
  const categoryRoles = getCategoryDefinition(category)?.imageRoles ?? commonImageRoles
  const byValue = new Map<string, ImageRoleDefinition>()
  for (const role of [...categoryRoles, ...evidenceImageRoles]) {
    if (!byValue.has(role.value)) byValue.set(role.value, role)
  }
  return [...byValue.values()]
}

export function getSubtypeLabel(category?: ProductCategory, subtype?: string) {
  if (!subtype) return ''
  return getCategoryDefinition(category)?.subtypes.find((item) => item.value === subtype)?.label ?? subtype
}

export function getSpecRows(draft: ProductDraft) {
  const knownFields = getSmartFields(draft)
  const labels = new Map(knownFields.map((field) => [field.key, field.label]))
  const seen = new Set<string>()
  const rows: Array<[string, string]> = []
  for (const field of knownFields) {
    const value = String(draft.specs?.[field.key] ?? '').trim()
    if (!value || seen.has(field.key)) continue
    seen.add(field.key)
    rows.push([field.label, value])
  }
  for (const [key, rawValue] of Object.entries(draft.specs ?? {})) {
    if (seen.has(key)) continue
    const value = String(rawValue ?? '').trim()
    if (!value) continue
    rows.push([labels.get(key) ?? key, value])
  }
  return rows
}

export interface CompletenessResult {
  score: number
  ready: boolean
  missingRequired: string[]
  missingRecommended: string[]
  completedRequired: number
  totalRequired: number
}

function hasValue(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0
  return String(value ?? '').trim().length > 0
}

export function getCompleteness(draft: ProductDraft): CompletenessResult {
  const definition = getCategoryDefinition(draft.category)
  const required: Array<[string, boolean]> = [
    ['ประเภทสินค้า', Boolean(draft.category)],
    ['ประเภทย่อย', Boolean(draft.subtype)],
    ['แบรนด์', hasValue(draft.brand)],
    ['รุ่น', hasValue(draft.model)],
    ['ราคาขาย', Boolean(draft.price && draft.price > 0)],
    ['รูปสินค้า', draft.images.length > 0],
  ]
  const recommended: Array<[string, boolean]> = [
    ['สภาพสินค้า %', Boolean(draft.conditionPercent)],
    ['ตำหนิ/สภาพภายนอก', hasValue(draft.defects)],
  ]

  if (definition) {
    for (const field of getSmartFields(draft)) {
      const entry: [string, boolean] = [field.label, hasValue(draft.specs?.[field.key])]
      if (field.importance === 'required') required.push(entry)
      if (field.importance === 'recommended') recommended.push(entry)
    }
    for (const role of definition.imageRoles.filter((item) => item.recommended && item.value !== 'cover')) {
      recommended.push([`รูป${role.label}`, draft.images.some((image) => image.imageRole === role.value)])
    }
  }

  const missingRequired = required.filter(([, ok]) => !ok).map(([label]) => label)
  const missingRecommended = recommended.filter(([, ok]) => !ok).map(([label]) => label)
  const requiredDone = required.length - missingRequired.length
  const recommendedDone = recommended.length - missingRecommended.length
  const weightedTotal = required.length * 2 + recommended.length
  const weightedDone = requiredDone * 2 + recommendedDone
  const score = weightedTotal ? Math.round((weightedDone / weightedTotal) * 100) : 0
  return {
    score,
    ready: missingRequired.length === 0 && score >= 80,
    missingRequired,
    missingRecommended,
    completedRequired: requiredDone,
    totalRequired: required.length,
  }
}

export function validateReadyToList(draft: ProductDraft) {
  const result = getCompleteness(draft)
  if (result.missingRequired.length) {
    throw new Error(`ข้อมูลสำหรับลงขายยังไม่ครบ: ${result.missingRequired.slice(0, 5).join(', ')}${result.missingRequired.length > 5 ? ' …' : ''}`)
  }
  if (result.score < 80) throw new Error(`ข้อมูลพร้อมลงขายเพียง ${result.score}% กรุณาเพิ่มข้อมูลสำคัญให้ครบอย่างน้อย 80%`)
}
