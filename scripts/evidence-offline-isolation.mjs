#!/usr/bin/env node
// Read-only gate. Never accepts a backup path, opens media or restores data.
import {execFileSync} from 'node:child_process'
import {pathToFileURL} from 'node:url'
const fail=()=>{throw Error('EVIDENCE_OFFLINE_ISOLATION_REQUIRED')}
const requireTrue=value=>{if(!value)fail()}
export const OFFLINE_PROJECT='amphon-evidence-owner-offline'
export function assertOfflineIsolation({platform,url,links,routes,network,containers}) {
 requireTrue(platform==='linux')
 // Literal loopback only: no DNS, credentials, query, fragments or remote URLs.
 requireTrue(url==='http://127.0.0.1:55321')
 requireTrue(Array.isArray(links)&&links.length>0&&Array.isArray(routes))
 requireTrue(!routes.some(r=>r.dst==='default'||r.dst==='0.0.0.0/0'||r.dst==='::/0'||r.gateway))
 // An offline VM may have loopback, Docker bridges and veth devices only UP.
 requireTrue(links.every(l=>!l.flags?.includes('UP')||l.ifname==='lo'||
   ['bridge','veth'].includes(l.linkinfo?.info_kind)))
 requireTrue(network?.Name===OFFLINE_PROJECT&&network.Internal===true&&network.Driver==='bridge')
 requireTrue(Array.isArray(containers)&&containers.length>=4)
 const ids=new Set(containers.map(c=>c.Id))
 requireTrue(Object.keys(network.Containers||{}).length===ids.size)
 requireTrue(Object.keys(network.Containers||{}).every(id=>ids.has(id)))
 for(const c of containers) {
   requireTrue(c.Name?.startsWith('/supabase_')&&c.Name.endsWith('_'+OFFLINE_PROJECT))
   requireTrue(c.State?.Running===true&&c.HostConfig?.Privileged===false)
   requireTrue(c.HostConfig?.NetworkMode!=='host')
   requireTrue(Object.keys(c.NetworkSettings?.Networks||{}).length===1&&
     c.NetworkSettings.Networks[OFFLINE_PROJECT])
   requireTrue(!(c.Mounts||[]).some(m=>m.Type==='bind'))
   const ports=Object.values(c.HostConfig?.PortBindings||{}).flat()
   requireTrue(ports.every(p=>p.HostIp==='127.0.0.1'))
 }
 return {isolated:true,project:OFFLINE_PROJECT,containers:containers.length}
}
export function checkOfflineIsolation(url) {
 // Refuse unsupported hosts before invoking any system tool.
 requireTrue(process.platform==='linux'&&url==='http://127.0.0.1:55321')
 const run=(command,args)=>JSON.parse(execFileSync(command,args,{
   encoding:'utf8',timeout:10000,stdio:['ignore','pipe','pipe'],
   env:{PATH:process.env.PATH,HOME:process.env.HOME,LANG:'C'}
 }))
 // Ignore any saved remote Docker context as well as inherited DOCKER_HOST.
 const docker=args=>run('docker',['--host','unix:///var/run/docker.sock',...args])
 const network=docker(['network','inspect',OFFLINE_PROJECT])[0]
 const ids=Object.keys(network.Containers||{})
 requireTrue(ids.length>=4)
 return assertOfflineIsolation({platform:process.platform,url,
   links:run('ip',['-j','-d','link','show']),
   routes:[...run('ip',['-j','-4','route','show','table','all']),
     ...run('ip',['-j','-6','route','show','table','all'])],
   network,containers:docker(['inspect',...ids])})
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 try {
   requireTrue(process.argv.length===3)
   console.log(JSON.stringify(checkOfflineIsolation(process.argv[2])))
 }catch {console.error('EVIDENCE_OFFLINE_ISOLATION_REQUIRED');process.exitCode=1}
}
