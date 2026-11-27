import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import * as fs from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {spawnSync} from 'node:child_process'
import {getManifest} from 'workbox-build'
const require=createRequire(import.meta.url)
const workboxRequire=createRequire(require.resolve('workbox-build'))
const globRequire=createRequire(workboxRequire.resolve('glob'))
const {glob}=workboxRequire('glob')

function fixture(t) {
 const dir=fs.mkdtempSync(join(tmpdir(),'amphon-synthetic-pwa-'))
 t.after(()=>{assert.ok(resolve(dir).startsWith(resolve(tmpdir())+require('node:path').sep));fs.rmSync(dir,{recursive:true,force:true})})
 return dir
}
test('scoped override preserves actual Workbox precache enumeration, ignores, hashes and size limits',async t=>{
 assert.equal(workboxRequire('glob/package.json').version,'14.0.2')
 assert.equal(globRequire('minimatch/package.json').version,'11.0.1')
 const dir=fixture(t)
 fs.mkdirSync(join(dir,'assets'))
 for(const [file,body] of Object.entries({'index.html':'<p>Synthetic</p>',
  'assets/app.js':'console.log("synthetic")','assets/style.css':'body{}',
  'assets/private.js':'excluded','assets/large.js':'x'.repeat(1001),'note.txt':'excluded'}))
  fs.writeFileSync(join(dir,file),body)
 const result=await getManifest({globDirectory:dir,globPatterns:['**/*.{js,css,html}'],
  globIgnores:['**/private.js'],globFollow:false,maximumFileSizeToCacheInBytes:1000})
 assert.deepEqual(result.manifestEntries.map(x=>x.url).sort(),['assets/app.js','assets/style.css','index.html'])
 assert.ok(result.manifestEntries.every(x=>/^[a-f0-9]{32}$/.test(x.revision)))
 assert.equal(result.count,3)
 assert.ok(result.warnings.some(x=>x.includes('large.js')))
 const second=await getManifest({globDirectory:dir,globPatterns:['**/*.html']})
 assert.equal(second.manifestEntries[0].revision,result.manifestEntries.find(x=>x.url==='index.html').revision)
})
test('patched glob stops directory traversal when cancelled during the first read',async t=>{
 const dir=fixture(t),controller=new AbortController()
 for(let i=0;i<12;i++)fs.mkdirSync(join(dir,'synthetic-'+i))
 let reads=0
 const instrumented={...fs,readdir(path,options,callback){
  reads++
  controller.abort(Error('SYNTHETIC_CANCEL'))
  fs.readdir(path,options,callback)
 }}
 await assert.rejects(glob('**/*',{cwd:dir,fs:instrumented,signal:controller.signal}),/SYNTHETIC_CANCEL/)
 await new Promise(setImmediate)
 assert.equal(reads,1,'Cancellation must not start recursive reads after the rejected walk')
})
test('patched minimatch bounds repeated synthetic globstar-parent patterns in an isolated process',()=>{
 const modulePath=globRequire.resolve('minimatch')
 const child=spawnSync(process.execPath,['--input-type=commonjs','-e',
  'const {Minimatch}=require(process.argv[1]);for(const n of [4,8,16]){'+
  'const m=new Minimatch(Array(n).fill("**/..").join("/")+"/synthetic",{optimizationLevel:2});'+
  'if(m.globParts.length>2)process.exit(2)}',modulePath],{encoding:'utf8',timeout:3000,maxBuffer:4096})
 assert.equal(child.error,undefined)
 assert.equal(child.status,0,child.stderr)
})
