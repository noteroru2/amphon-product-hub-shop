import test from 'node:test'
import assert from 'node:assert/strict'
import {assertOfflineIsolation,checkOfflineIsolation,OFFLINE_PROJECT as name} from '../scripts/evidence-offline-isolation.mjs'
function fixture() {
 return {platform:'linux',url:'http://127.0.0.1:55321',links:[{ifname:'lo',flags:['UP']}],routes:[],
  network:{Name:name,Internal:true,Driver:'bridge',Containers:{a:{},b:{},c:{},d:{}}},
  containers:['a','b','c','d'].map(Id=>({Id,Name:'/supabase_'+Id+'_'+name,
    State:{Running:true},HostConfig:{Privileged:false,NetworkMode:name,
      PortBindings:{'8000/tcp':[{HostIp:'127.0.0.1',HostPort:'55321'}]}},
    NetworkSettings:{Networks:{[name]:{}}},Mounts:[]}))}
}
test('offline owner gate accepts only synthetic proof of an isolated Linux VM and internal stack',()=>{
 assert.equal(assertOfflineIsolation(fixture()).isolated,true)
})
test('offline owner gate refuses production, DNS, outbound routes, adapters and unsafe containers',()=>{
 const changes=[s=>{s.platform='win32'},s=>{s.url='https://production.supabase.co'},
  s=>{s.url='http://localhost:55321'},s=>{s.url+='/?target=production'},
  s=>{s.routes=[{dst:'default',gateway:'10.0.0.1'}]},s=>{s.routes=[{dst:'::/0'}]},
  s=>{s.links.push({ifname:'eth0',flags:['UP']})},s=>{s.network.Internal=false},
  s=>{s.containers[0].NetworkSettings.Networks.external={}},
  s=>{s.containers[0].HostConfig.PortBindings['8000/tcp'][0].HostIp='0.0.0.0'},
  s=>{s.containers[0].Mounts=[{Type:'bind',Source:'/var/run/docker.sock'}]},
  s=>{s.containers[0].HostConfig.Privileged=true},s=>{s.network.Containers.unexpected={}},
  s=>{s.containers[0].Name='/supabase_db_wrong-project'},s=>{s.links=[]}]
 for(const change of changes){const s=fixture();change(s);assert.throws(()=>assertOfflineIsolation(s))}
 assert.throws(()=>checkOfflineIsolation('https://production.supabase.co'))
})
