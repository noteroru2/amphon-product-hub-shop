import Dexie, { type EntityTable } from 'dexie'
import type { ProductDraft } from '../types/product'

const db = new Dexie('amphon-product-hub') as Dexie & {
  drafts: EntityTable<ProductDraft, 'localId'>
}

db.version(1).stores({
  drafts: 'localId, category, status, updatedAt'
})

db.version(2).stores({
  drafts: 'localId, ownerUserId, category, status, updatedAt'
})

export { db }
