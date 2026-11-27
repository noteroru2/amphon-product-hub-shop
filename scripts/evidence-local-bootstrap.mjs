/** Local Docker socket only. No hosted URL/DB arguments, migration generation,
 * db push/reset or Production credential. Fixtures are not migration files.
 */
import {execFileSync} from 'node:child_process'
import {readFileSync,existsSync,mkdirSync,copyFileSync,readdirSync} from 'node:fs'
import {resolve,dirname} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
export const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
export const productionEvidenceMigrations=['supabase/migrations/20261124_evidence_publisher.sql','supabase/migrations/20261126160233_evidence_recovery_local_qa.sql']
export function inspectMigrationPackaging() {
 const files=readdirSync(resolve(root,'supabase/migrations')).filter(x=>x.endsWith('.sql')).sort()
 for(const file of files)if(/synthetic_retention_clock|amphon_synthetic_local_fixture|SYNTHETIC_LOCAL_RUNNER_REQUIRED/.test(readFileSync(resolve(root,'supabase/migrations',file),'utf8')))throw Error('TEST_FIXTURE_IN_PRODUCTION_DISCOVERY')
 const testDir=resolve(root,'tests/evidence-local-supabase/supabase/migrations')
 if(existsSync(testDir)&&readdirSync(testDir).some(x=>x.endsWith('.sql')))throw Error('TEST_MIGRATIONS_MUST_BE_EMPTY')
 return files
}
const local='tests/evidence-local-supabase/supabase'
export function prepareLocalFunctions() {
 if(!readFileSync(resolve(root,local,'config.toml'),'utf8').includes('project_id = "amphon-evidence-local-qa"')||
  existsSync(resolve(root,local,'.temp/project-ref')))throw Error('LOCAL_PROJECT_REQUIRED')
 inspectMigrationPackaging()
 for(const path of ['_shared/evidence-private-media.mjs','evidence-private-media/index.ts']) {
  const dest=resolve(root,local,'functions',path);mkdirSync(dirname(dest),{recursive:true});copyFileSync(resolve(root,'supabase/functions',path),dest)
 }
}
export function localSql(sql,{fixture=false}={}) {
 const host=process.platform==='win32'?'npipe:////./pipe/dockerDesktopLinuxEngine':'unix:///var/run/docker.sock'
 const args=['--host',host],container='supabase_db_amphon-evidence-local-qa'
 const env={...process.env};for(const name of Object.keys(env))if(/^DOCKER_|^SUPABASE_ACCESS_TOKEN$|^PG/.test(name))delete env[name]
 const info=JSON.parse(execFileSync('docker',[...args,'inspect',container],{encoding:'utf8',env,stdio:['ignore','pipe','pipe']}))[0]
 if(info.Name!=='/'+container||!info.State.Running||!info.Config.Image.includes('supabase/postgres:')||
  !info.HostConfig.PortBindings['5432/tcp']?.some(x=>x.HostPort==='55322'))throw Error('ISOLATED_SYNTHETIC_CONTAINER_REQUIRED')
 return execFileSync('docker',[...args,'exec','-i',...(fixture?['-e','PGOPTIONS=-c amphon.synthetic_fixture=local-only-20261127']:[]),container,
  'psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','--single-transaction'],{env,input:sql,encoding:'utf8',stdio:['pipe','pipe','pipe']})
}
export function bootstrapLocal(mode) {
 if(!['server','hub'].includes(mode))throw Error('LOCAL_MODE_REQUIRED')
 prepareLocalFunctions()
 const first=mode==='server'?'tests/fixtures/evidence-local-baseline.sql':'tests/fixtures/evidence-hub-dependencies.sql'
 const historical=mode==='hub'?['supabase/migrations/20261118135133_trade_evidence_library.sql','supabase/migrations/20261118135336_trade_evidence_anon_revoke.sql','supabase/migrations/20261118135723_trade_evidence_approval_edit_guard.sql']:[]
 const files=[first,...historical,...productionEvidenceMigrations,...(mode==='server'?['tests/fixtures/evidence-local-clock.sql']:[])]
 localSql(files.map(file=>readFileSync(resolve(root,file),'utf8')).join('\n')+"\nNOTIFY pgrst, 'reload schema';",{fixture:true})
 console.log('PASS LOCAL BOOTSTRAP: '+mode+'; fresh schema; '+files.join(' -> '))
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
 const action=process.argv[2]
 if(action==='prepare')prepareLocalFunctions()
 else if(['server','hub'].includes(action))bootstrapLocal(action)
 else throw Error('LOCAL_ACTION_REQUIRED')
}
