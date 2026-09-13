import type { ProductCategory, ProductStatus } from '../types/product'

export interface DemoProduct {
  id: string
  sku: string
  category: ProductCategory
  title: string
  subtitle: string
  price: number
  status: ProductStatus
  updatedAt: string
}

export const demoProducts: DemoProduct[] = [
  { id: '1', sku: 'AT-NB-2609-0012', category: 'notebook', title: 'ASUS ROG Zephyrus G14', subtitle: 'Ryzen 9 · 32GB · 1TB · RTX 5050', price: 42900, status: 'ready_to_list', updatedAt: 'วันนี้ 14:32' },
  { id: '2', sku: 'AT-PH-2609-0013', category: 'iphone', title: 'iPhone 15 Pro 256GB', subtitle: 'Natural Titanium · Battery 89%', price: 25900, status: 'published', updatedAt: 'วันนี้ 13:08' },
  { id: '3', sku: 'AT-CAM-2609-0014', category: 'camera', title: 'Sony A6600', subtitle: 'Body · Shutter 20,000', price: 23900, status: 'reserved', updatedAt: 'เมื่อวาน 18:40' }
]
