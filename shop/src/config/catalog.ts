export type IndexPolicy = 'INDEX' | 'NOINDEX' | 'HOLD' | 'RETIRED'

export interface CatalogCategory {
  key: string
  slug: string
  name: string
  navName: string
  h1: string
  title: string
  description: string
  sourceCategory: string
  sourceSubtype?: string
  query?: string
  indexPolicy: IndexPolicy
  order: number
}

const categories: CatalogCategory[] = [
  {
    key: 'notebooks', slug: 'notebooks', name: 'โน้ตบุ๊กมือสอง', navName: 'โน้ตบุ๊ก',
    h1: 'โน้ตบุ๊กมือสอง สภาพจริง พร้อมราคา',
    title: 'โน้ตบุ๊กมือสอง สภาพจริง พร้อมราคา | AMPHON TRADING',
    description: 'เลือกซื้อโน้ตบุ๊กมือสองจาก AMPHON TRADING ดูรูป สเปก ราคา สภาพและประกันของสินค้าจริงก่อนสั่งซื้อ',
    sourceCategory: 'notebook', indexPolicy: 'INDEX', order: 10,
  },
  {
    key: 'macbooks', slug: 'macbooks', name: 'MacBook มือสอง', navName: 'MacBook',
    h1: 'MacBook มือสอง พร้อมดูสภาพและราคา',
    title: 'MacBook มือสอง สภาพจริง พร้อมราคา | AMPHON TRADING',
    description: 'เลือกซื้อ MacBook มือสอง ดูรูปจริง สเปก ราคา สภาพและประกันจาก AMPHON TRADING',
    sourceCategory: 'notebook', sourceSubtype: 'macbook', query: 'MacBook', indexPolicy: 'INDEX', order: 20,
  },
  {
    key: 'gaming-laptops', slug: 'gaming-laptops', name: 'โน้ตบุ๊กเกมมิ่งมือสอง', navName: 'Gaming Laptop',
    h1: 'โน้ตบุ๊กเกมมิ่งมือสอง พร้อมดูสเปกและราคา',
    title: 'โน้ตบุ๊กเกมมิ่งมือสอง Gaming Laptop พร้อมราคา | AMPHON TRADING',
    description: 'เลือกซื้อโน้ตบุ๊กเกมมิ่งมือสอง ดู CPU การ์ดจอ RAM SSD จอ ราคา สภาพและรูปเครื่องจริงก่อนสั่งซื้อ',
    sourceCategory: 'notebook', sourceSubtype: 'gaming', indexPolicy: 'INDEX', order: 25,
  },
  {
    key: 'desktop-pcs', slug: 'desktop-pcs', name: 'คอมพิวเตอร์มือสอง', navName: 'คอมมือสอง',
    h1: 'คอมพิวเตอร์มือสอง พร้อมใช้งาน',
    title: 'คอมพิวเตอร์มือสอง พร้อมใช้งาน | AMPHON TRADING',
    description: 'คอมพิวเตอร์ตั้งโต๊ะมือสองและชุด PC พร้อมดูสเปก ราคา รูปจริงและสถานะสินค้าก่อนสั่งซื้อ',
    sourceCategory: 'pc', indexPolicy: 'INDEX', order: 30,
  },
  {
    key: 'gaming-pcs', slug: 'gaming-pcs', name: 'คอมเกมมิ่งมือสอง', navName: 'PC Gaming',
    h1: 'คอมเกมมิ่งมือสอง สเปกคุ้ม',
    title: 'คอมเกมมิ่งมือสอง สเปกคุ้ม | AMPHON TRADING',
    description: 'เลือกซื้อ PC Gaming มือสอง ดู CPU การ์ดจอ RAM SSD ราคาและรูปสินค้าจริง',
    sourceCategory: 'pc', sourceSubtype: 'gaming', indexPolicy: 'INDEX', order: 40,
  },
  {
    key: 'iphones', slug: 'iphones', name: 'iPhone มือสอง', navName: 'iPhone',
    h1: 'iPhone มือสอง ดูเครื่องจริงและราคา',
    title: 'iPhone มือสอง ดูเครื่องจริงและราคา | AMPHON TRADING',
    description: 'เลือกซื้อ iPhone มือสอง ดูรุ่น ความจุ สภาพ ราคา รูปสินค้าจริงและรายละเอียดก่อนซื้อ',
    sourceCategory: 'iphone', indexPolicy: 'INDEX', order: 50,
  },
  {
    key: 'smartphones', slug: 'smartphones', name: 'มือถือมือสอง', navName: 'มือถือ',
    h1: 'มือถือ Android มือสอง พร้อมราคา',
    title: 'มือถือมือสอง Android พร้อมราคา | AMPHON TRADING',
    description: 'เลือกซื้อมือถือ Android มือสองจากสินค้าจริง พร้อมสเปก ราคา สภาพและรูปประกอบ',
    sourceCategory: 'smartphone', indexPolicy: 'INDEX', order: 60,
  },
  {
    key: 'tablets', slug: 'tablets', name: 'iPad และ Tablet มือสอง', navName: 'iPad / Tablet',
    h1: 'iPad และ Tablet มือสอง',
    title: 'iPad และ Tablet มือสอง | AMPHON TRADING',
    description: 'เลือกซื้อ iPad และ Tablet มือสอง ดูรุ่น ความจุ สภาพ ราคาและรูปสินค้าจริง',
    sourceCategory: 'tablet', indexPolicy: 'INDEX', order: 70,
  },
  {
    key: 'monitors', slug: 'monitors', name: 'จอคอมมือสอง', navName: 'จอคอม',
    h1: 'จอคอมมือสอง พร้อมราคา',
    title: 'จอคอมมือสอง พร้อมราคา | AMPHON TRADING',
    description: 'เลือกซื้อจอคอมมือสอง ดูขนาด ความละเอียด รีเฟรชเรต ราคาและรูปสินค้าจริง',
    sourceCategory: 'monitor', indexPolicy: 'INDEX', order: 80,
  },
  {
    key: 'cameras', slug: 'cameras', name: 'กล้องมือสอง', navName: 'กล้อง',
    h1: 'กล้องมือสอง Mirrorless และ DSLR',
    title: 'กล้องมือสอง Mirrorless DSLR | AMPHON TRADING',
    description: 'เลือกซื้อกล้องมือสอง ดูบอดี้ เลนส์ สภาพ ราคาและรูปสินค้าจริงจาก AMPHON TRADING',
    sourceCategory: 'camera', indexPolicy: 'INDEX', order: 90,
  },
  {
    key: 'gaming-consoles', slug: 'gaming-consoles', name: 'เครื่องเกมมือสอง', navName: 'เครื่องเกม',
    h1: 'เครื่องเกมมือสอง PS5 Nintendo Switch',
    title: 'เครื่องเกมมือสอง PS5 Nintendo Switch | AMPHON TRADING',
    description: 'เลือกซื้อเครื่องเกมมือสอง ดูรุ่น อุปกรณ์ สภาพ ราคาและรูปสินค้าจริง',
    sourceCategory: 'gaming', indexPolicy: 'INDEX', order: 100,
  },
  {
    key: 'camera-lenses', slug: 'camera-lenses', name: 'เลนส์กล้องมือสอง', navName: 'เลนส์กล้อง',
    h1: 'เลนส์กล้องมือสอง พร้อมดูสภาพและราคา',
    title: 'เลนส์กล้องมือสอง | AMPHON TRADING',
    description: 'เลือกซื้อเลนส์กล้องมือสอง ดูรุ่น เมาท์ สภาพ ราคาและรูปสินค้าจริง',
    sourceCategory: 'lens', indexPolicy: 'HOLD', order: 105,
  },
  {
    key: 'graphics-cards', slug: 'graphics-cards', name: 'การ์ดจอมือสอง', navName: 'การ์ดจอ',
    h1: 'การ์ดจอมือสอง NVIDIA และ AMD',
    title: 'การ์ดจอมือสอง NVIDIA AMD | AMPHON TRADING',
    description: 'รวมการ์ดจอมือสองสำหรับคอมพิวเตอร์และเกมมิ่ง พร้อมดูรุ่น ราคาและสภาพจริง',
    sourceCategory: 'component', indexPolicy: 'HOLD', order: 110,
  },
  {
    key: 'pc-components', slug: 'pc-components', name: 'อุปกรณ์คอมมือสอง', navName: 'อะไหล่คอม',
    h1: 'อุปกรณ์คอมพิวเตอร์มือสอง',
    title: 'อุปกรณ์คอมมือสอง | AMPHON TRADING',
    description: 'เลือกซื้ออุปกรณ์คอมพิวเตอร์มือสองจากสินค้าจริง พร้อมราคา สเปกและสภาพสินค้า',
    sourceCategory: 'component', indexPolicy: 'HOLD', order: 120,
  },
  {
    key: 'accessories', slug: 'accessories', name: 'อุปกรณ์ไอทีมือสอง', navName: 'อุปกรณ์ไอที',
    h1: 'อุปกรณ์ไอทีมือสอง',
    title: 'อุปกรณ์ไอทีมือสอง | AMPHON TRADING',
    description: 'รวมอุปกรณ์ไอทีมือสองจากสินค้าจริง พร้อมราคาและรายละเอียดก่อนสั่งซื้อ',
    sourceCategory: 'accessory', indexPolicy: 'HOLD', order: 130,
  },
  {
    key: 'other-it', slug: 'other-it', name: 'สินค้าไอทีมือสองอื่น ๆ', navName: 'สินค้าอื่น',
    h1: 'สินค้าไอทีมือสองอื่น ๆ',
    title: 'สินค้าไอทีมือสองอื่น ๆ | AMPHON TRADING',
    description: 'สินค้าไอทีมือสองประเภทอื่นจากสต๊อกจริงของ AMPHON TRADING',
    sourceCategory: 'other', indexPolicy: 'HOLD', order: 140,
  },
]

export const catalogCategories = categories.sort((a, b) => a.order - b.order)

export const indexCategories = catalogCategories.filter((category) => category.indexPolicy === 'INDEX')

export function getCategoryBySlug(slug: string | undefined) {
  return catalogCategories.find((category) => category.slug === slug)
}
