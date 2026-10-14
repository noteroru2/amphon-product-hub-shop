import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source=readFileSync(new URL('../src/lib/inventoryWorkQueue.ts',import.meta.url),'utf8')
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText
const queue=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)

test('staff queue includes incomplete inventory only; never sold or published stock',()=>{
  assert.equal(queue.needsListingWork({status:'draft'}),true)
  assert.equal(queue.needsListingWork({status:'photo_ready'}),true)
  for(const status of ['published','sold','ready_to_list','reserved','cancelled'])assert.equal(queue.needsListingWork({status}),false)
})
test('oldest first queue is stable and does not mutate source products',()=>{
  const rows=[
    {sku:'NEW',status:'draft',createdAt:'2026-10-14T00:00:00Z',updatedAt:'2026-10-14T00:00:00Z'},
    {sku:'OLD',status:'photo_ready',createdAt:'2026-09-24T00:00:00Z',updatedAt:'2026-10-13T00:00:00Z'},
  ]
  const sorted=queue.sortPendingListingWork(rows)
  assert.deepEqual(sorted.map(x=>x.sku),['OLD','NEW'])
  assert.deepEqual(rows.map(x=>x.sku),['NEW','OLD'])
})
test('Hub homepage and inventory have staff-facing listing backlog filter',()=>{
  const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8')
  assert.match(app,/onNeedsDetails/)
  assert.match(app,/งานรอลงขาย/)
  assert.match(app,/filter === "needs_details"/)
  assert.match(app,/sortPendingListingWork\(matched\)/)
})
