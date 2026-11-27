/** Review artifact only. Does not connect to a database or invoke deployment. */
import {mkdirSync,readFileSync,writeFileSync,readdirSync} from 'node:fs'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {createHash} from 'node:crypto'
import {root,inspectMigrationPackaging,productionEvidenceMigrations} from './evidence-local-bootstrap.mjs'
export function writeEvidenceMigrationPackage(directory) {
 const inventory=inspectMigrationPackaging()
 mkdirSync(directory,{recursive:true})
 const expected=[...productionEvidenceMigrations.map(p=>p.split('/').at(-1)),'manifest.json']
 if(readdirSync(directory).some(p=>!expected.includes(p)))throw Error('PACKAGE_DIRECTORY_NOT_EXCLUSIVE')
 const migrations=productionEvidenceMigrations.map(path=>{
  const bytes=readFileSync(resolve(root,path)),name=path.split('/').at(-1)
  writeFileSync(resolve(directory,name),bytes)
  return {path,sha256:createHash('sha256').update(bytes).digest('hex')}
 })
 const manifest={purpose:'REVIEW_ONLY_NO_APPLY',migrations,discovered_production_migrations:inventory,
  warning:'Pending hosted migration history is unverified. Never apply all discovered migrations implicitly.'}
 writeFileSync(resolve(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n')
 return manifest
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
 if(process.argv.length!==2)throw Error('NO_DESTINATION_OR_HOSTED_ARGUMENTS_ACCEPTED')
 const manifest=writeEvidenceMigrationPackage(resolve(root,'.evidence-review-package'))
 console.log('PASS review package: exactly '+manifest.migrations.length+' production Evidence migrations; '+manifest.discovered_production_migrations.length+' root discovery entries inventoried; no apply')
}
