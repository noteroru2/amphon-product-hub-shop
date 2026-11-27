import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,existsSync,mkdtempSync,readdirSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve,sep} from 'node:path'
import {writeEvidenceMigrationPackage} from '../scripts/evidence-migration-package.mjs'
import {inspectMigrationPackaging,productionEvidenceMigrations} from '../scripts/evidence-local-bootstrap.mjs'
test('production discovery contains both publisher migrations in order and no test clock or fixture',()=>{
 const all=inspectMigrationPackaging()
 assert.ok(all.indexOf(productionEvidenceMigrations[0].split('/').at(-1))<all.indexOf(productionEvidenceMigrations[1].split('/').at(-1)))
 for(const path of ['tests/fixtures/evidence-local-baseline.sql','tests/fixtures/evidence-local-clock.sql','tests/fixtures/evidence-hub-dependencies.sql'])
  assert.match(readFileSync(path,'utf8'),/current_setting\('amphon.synthetic_fixture',true\).*is distinct from 'local-only-20261127'/)
 assert.equal(existsSync('tests/evidence-local-supabase/supabase/migrations/20261125000400_recovery_test_clock.sql'),false)
 const runner=readFileSync('scripts/evidence-local-bootstrap.mjs','utf8')
 assert.match(runner,/npipe:|unix:\/\/\/var\/run\/docker.sock/)
 assert.doesNotMatch(runner,/execFileSync\('supabase'/)
})
test('local and hosted private function configurations both require gateway JWT validation',()=>{
 for(const path of ['supabase/config.toml','tests/evidence-local-supabase/supabase/config.toml'])
  assert.match(readFileSync(path,'utf8'),/\[functions\.evidence-private-media\]\s*(?:#[^\n]*\n)*verify_jwt = true/)
})
test('review migration artifact contains exactly the two production schemas, byte-for-byte; no fixtures or clock',()=>{
 const dir=mkdtempSync(join(tmpdir(),'amphon-migration-review-'))
 try {
  const manifest=writeEvidenceMigrationPackage(dir)
  assert.deepEqual(readdirSync(dir).sort(),[...productionEvidenceMigrations.map(p=>p.split('/').at(-1)),'manifest.json'].sort())
  for(const path of productionEvidenceMigrations)assert.deepEqual(readFileSync(join(dir,path.split('/').at(-1))),readFileSync(path))
  assert.deepEqual(manifest.migrations.map(x=>x.path),productionEvidenceMigrations)
 }finally{assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true})}
})
