export const MAIN_SITE_URL = 'https://amphon.co.th';
export const MAIN_ORGANIZATION_ID = `${MAIN_SITE_URL}/#organization`;
export const MAIN_LEGAL_NAME = 'บริษัท อำพล เทรดดิ้ง จำกัด';
export const MAIN_BUYBACK_URL = `${MAIN_SITE_URL}/รับซื้อสินค้าไอที`;

export type BuybackTarget = {
  href: string;
  label: string;
  itemName: string;
};

export const BUYBACK_BY_SHOP_CATEGORY: Record<string, BuybackTarget> = {
  notebooks: {
    href: `${MAIN_SITE_URL}/บริการ/รับซื้อโน๊ตบุ๊ค`,
    label: 'ประเมินราคาขายโน้ตบุ๊ก',
    itemName: 'โน้ตบุ๊ก',
  },
  macbooks: {
    href: `${MAIN_SITE_URL}/บริการ/รับซื้อ-macbook`,
    label: 'ประเมินราคาขาย MacBook',
    itemName: 'MacBook',
  },
  'desktop-pcs': {
    href: `${MAIN_SITE_URL}/บริการ/รับซื้อคอมพิวเตอร์`,
    label: 'ประเมินราคาขายคอมพิวเตอร์',
    itemName: 'คอมพิวเตอร์',
  },
  'gaming-pcs': {
    href: `${MAIN_SITE_URL}/บริการ/รับซื้อ-gaming-pc`,
    label: 'ประเมินราคาขาย Gaming PC',
    itemName: 'Gaming PC',
  },
  iphones: {
    href: `${MAIN_SITE_URL}/บริการ/รับซื้อ-iphone`,
    label: 'ประเมินราคาขาย iPhone',
    itemName: 'iPhone',
  },
  smartphones: {
    href: `${MAIN_SITE_URL}/บริการ/รับซื้อโทรศัพท์มือสอง`,
    label: 'ประเมินราคาขายมือถือ',
    itemName: 'มือถือ',
  },
  tablets: {
    href: `${MAIN_SITE_URL}/บริการ/รับซื้อแท็บเล็ต`,
    label: 'ประเมินราคาขาย iPad / Tablet',
    itemName: 'iPad / Tablet',
  },
  monitors: {
    href: `${MAIN_SITE_URL}/บริการ/รับซื้อจอคอม`,
    label: 'ประเมินราคาขายจอคอม',
    itemName: 'จอคอม',
  },
  cameras: {
    href: `${MAIN_SITE_URL}/บริการ/รับซื้อกล้อง`,
    label: 'ประเมินราคาขายกล้อง',
    itemName: 'กล้อง',
  },
  'gaming-consoles': {
    href: `${MAIN_SITE_URL}/บริการ/รับซื้อเครื่องเกม`,
    label: 'ประเมินราคาขายเครื่องเกม',
    itemName: 'เครื่องเกม',
  },
  'camera-lenses': {
    href: `${MAIN_SITE_URL}/บริการ/รับซื้อเลนส์กล้อง`,
    label: 'ประเมินราคาขายเลนส์กล้อง',
    itemName: 'เลนส์กล้อง',
  },
  'graphics-cards': {
    href: `${MAIN_SITE_URL}/บริการ/รับซื้อการ์ดจอ`,
    label: 'ประเมินราคาขายการ์ดจอ',
    itemName: 'การ์ดจอ',
  },
  'pc-components': {
    href: `${MAIN_SITE_URL}/บริการ/รับซื้ออุปกรณ์คอมพิวเตอร์`,
    label: 'ประเมินราคาขายอุปกรณ์คอม',
    itemName: 'อุปกรณ์คอม',
  },
  accessories: {
    href: `${MAIN_SITE_URL}/บริการ/รับซื้ออุปกรณ์ไอที`,
    label: 'ประเมินราคาขายอุปกรณ์ไอที',
    itemName: 'อุปกรณ์ไอที',
  },
};

export function getBuybackTarget(categorySlug: string | null | undefined) {
  if (!categorySlug) return null;
  return BUYBACK_BY_SHOP_CATEGORY[categorySlug] ?? null;
}
