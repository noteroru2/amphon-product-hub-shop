import test from 'node:test'
import assert from 'node:assert/strict'
import {evidenceServiceHeaders} from '../src/lib/evidenceSupabaseServerAuth.mjs'

test('Supabase sb_secret server key goes into apikey ONLY (no invalid bearer JWT)',()=>{
 const key='sb_secret_'+('synthetic-safe-secret-'.repeat(3))
 assert.deepEqual(evidenceServiceHeaders(key),{apikey:key})
 assert.ok(!('authorization' in evidenceServiceHeaders(key)))
})
test('Supabase legacy service_role JWT retains bearer authentication for backwards compatibility',()=>{
 const key='eyJhbGciOiJIUzI1NiJ9.'+'abc'.repeat(15)+'.synthetic'
 assert.deepEqual(evidenceServiceHeaders(key),{apikey:key,authorization:'Bearer '+key})
})
test('publishable keys cannot be used as privileged server credentials',()=>{
 assert.throws(()=>evidenceServiceHeaders('sb_publishable_foo'))
 assert.throws(()=>evidenceServiceHeaders(''))
 assert.throws(()=>evidenceServiceHeaders(null))
})
