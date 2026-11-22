import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {once} from 'node:events';import {mkdtemp,rm,writeFile,readFile,readdir} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {Simulator} from '../src/core.ts';import {connectSimulator} from '../src/mqtt.ts';import {controlServer} from '../src/control.ts';
// Test harness only. Simulator production modules never import the application or HA provider.
// @ts-ignore existing lab-only authentication helper
import {labToken} from '../lab-auth.mjs';
const token=await labToken('http://127.0.0.1:18123',process.argv.includes('--bootstrap'));
const sim=new Simulator(),adapter=connectSimulator(sim,{log:()=>{}}),control=controlServer(sim,()=>adapter.client.connected);
control.listen(0,'127.0.0.1');await once(control,'listening');const controlURL='http://127.0.0.1:'+(control.address() as any).port;
const timer=setInterval(()=>sim.advance(200),200),dir=await mkdtemp(join(tmpdir(),'virtual-home-e2e-'));
const legacy={devices:[{id:'legacy-night-light',name:'旧灯',room:'客厅',kind:'light',on:false,level:37}],rules:[],events:[],accounts:[],expenses:[],greetings:{},speaker:'',lightOn:false};
await writeFile(join(dir,'state.json'),JSON.stringify(legacy));
let streamAbort:AbortController|undefined;
const startBackend=()=>spawn(process.execPath,['server.mjs','--skip-login'],{cwd:new URL('../../../backend/',import.meta.url),env:{...process.env,HA_URL:'http://127.0.0.1:18123',HA_TOKEN:token,HA_ENTITY_PREFIX:'sim_',NODE_ENV:'test',SMART_HOME_AUTOMATION_TEST_TIME:'2026-11-16T23:30:00+08:00',SMART_HOME_DATA_DIR:dir,SMART_HOME_API_PORT:'0'},stdio:['ignore','pipe','pipe']});
let backend=startBackend();
async function ready(){return new Promise<string>((resolve,reject)=>{const t=setTimeout(()=>reject(Error('startup timeout')),15000);backend.stdout!.on('data',chunk=>{const m=String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(t);resolve(m[0]);}});backend.stderr!.on('data',()=>{});backend.once('exit',()=>{clearTimeout(t);reject(Error('backend exited'));});});}
async function wait(check:()=>Promise<boolean>,name:string){for(let i=0;i<240;i++){if(await check())return;await new Promise(r=>setTimeout(r,250));}throw Error('Timed out: '+name);}
try{
 let api=await ready();
 let latest:any[]=[];let latestState:any={};let lastId='';let streamFailure:unknown;
 async function connectState(){
  streamAbort?.abort();const controller=new AbortController();streamAbort=controller;
  const response=await fetch(api+'/api/events',{headers:lastId?{'Last-Event-ID':lastId}:{},signal:controller.signal});assert.equal(response.status,200);
  const reader=response.body!.getReader();let buffer='';const decoder=new TextDecoder();
  void (async()=>{try{while(!controller.signal.aborted){const {value,done}=await reader.read();if(done)return;buffer+=decoder.decode(value,{stream:true});let end;while((end=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);if(frame.includes('event: snapshot')){assert.ok(!frame.includes(token));lastId=frame.split('\n').find(l=>l.startsWith('id: '))?.slice(4)??'';const data=JSON.parse(frame.split('\n').find(l=>l.startsWith('data: '))!.slice(6));if(!controller.signal.aborted){latest=data.devices;latestState=data;}}}}}catch(error){if(!controller.signal.aborted)streamFailure=error;}})();
 }
 await connectState();
 const devices=async()=>{if(streamFailure)throw streamFailure;return latest;};
 const find=async(id:string)=>(await devices()).find((d:any)=>d.providerDeviceId===id);
 const post=async(path:string,body:unknown)=>{const r=await fetch(controlURL+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,200);return r.json();};
 const command=async(id:string,capability:string,value:unknown)=>{const r=await fetch(api+'/api/devices/'+encodeURIComponent('ha:'+id),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({capability,value})});assert.equal(r.status,200,await r.text());};
 const lamp='light.sim_living_room_light',motion='binary_sensor.sim_living_room_motion',co2='sensor.sim_living_room_environment_co2';
 await wait(async()=>!!(await find(lamp))?.state.online,'light discovery');
 await command(lamp,'power',true);await wait(async()=>(await find(lamp))?.state.values.power===true,'A light feedback');console.log('PASS A: Home OS -> HA -> MQTT -> delayed light -> state feedback');
 await command(lamp,'colorTemperature',4000);await wait(async()=>(await find(lamp))?.state.values.colorTemperature===4000,'Kelvin color temperature MQTT feedback');console.log('PASS: light color temperature 4000 K feedback');
 streamAbort?.abort();await post('/devices/sim_living_room_environment/state',{co2:1175});await new Promise(r=>setTimeout(r,500));await connectState();await wait(async()=>(await find(co2))?.state.values.co2===1175,'SSE reconnect full snapshot');console.log('PASS: SSE reconnect recovers missed telemetry without state polling');
 await wait(async()=>!!(await find(co2))?.state.online,'grouped environment discovery');
 await post('/devices/sim_living_room_motion/state',{occupancy:true});await wait(async()=>(await find(motion))?.state.values.occupancy===true,'B motion');assert.equal((await find(motion)).state.source,'simulator');console.log('PASS B: Control API -> MQTT -> HA WS -> Home OS occupancy');
 await post('/devices/sim_living_room_light/state',{online:false});await wait(async()=>(await find(lamp))?.state.online===false,'C offline');assert.ok((await find(lamp)).state.lastSeenAt);assert.equal(sim.command('sim_living_room_light',{power:false}),false);await post('/devices/sim_living_room_light/state',{online:true});await wait(async()=>(await find(lamp))?.state.online===true,'C recovery');console.log('PASS C: per-device offline/lastSeenAt/recovery');
 await post('/scenarios/bad-air-quality/run',{});const samples=new Set<number>();await wait(async()=>{const value=(await find(co2))?.state.values.co2;samples.add(value);return value===1400;},'D air quality');assert.ok(samples.size>=3);console.log('PASS D: continuous CO2 telemetry',samples.size,'samples');
 await command('cover.sim_living_room_curtain','positionPercent',100);await wait(async()=>Number((await find('cover.sim_living_room_curtain'))?.state.values.positionPercent)>20,'curtain movement');await wait(async()=>(await find('cover.sim_living_room_curtain'))?.state.values.positionPercent===100,'curtain end');
 await command('climate.sim_bedroom_ac','hvacMode','cool');await wait(async()=>Number((await find('climate.sim_bedroom_ac'))?.state.values.temperature)<27,'climate gradual cooling');
 await command('vacuum.sim_robot_vacuum','cleaning',true);await wait(async()=>(await find('vacuum.sim_robot_vacuum'))?.state.values.cleaning===true,'vacuum');
 await adapter.client.publishAsync('homeassistant/status','online');await post('/reset',{});await wait(async()=>(await find(lamp))?.state.values.power===false,'reset');console.log('PASS: cover/climate/vacuum, HA birth rediscovery, reset');

 const sceneRequest=async(path:string,method:string,body:unknown)=>{const r=await fetch(api+'/api'+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,method==='POST'&&['/scenes','/automations'].includes(path)?201:200);return r.json();};
 const definition={name:'模拟阅读',description:'灯光与窗帘',actions:[{deviceId:'ha:'+lamp,command:{capability:'power',value:true}},{deviceId:'ha:'+lamp,command:{capability:'brightness',value:35}},{deviceId:'ha:cover.sim_living_room_curtain',command:{capability:'positionPercent',value:50}}]};
 const created=await sceneRequest('/scenes','POST',definition);const scene=created.scenes.find((s:any)=>s.name==='模拟阅读');
 const success=await sceneRequest('/scenes/'+scene.id,'POST',{});assert.equal(success.run.status,'completed');
 await wait(async()=>(await find(lamp))?.state.values.brightness===35,'scene light feedback');await wait(async()=>(await find('cover.sim_living_room_curtain'))?.state.values.positionPercent===50,'scene cover feedback');
 await sceneRequest('/scenes/'+scene.id,'PUT',{...definition,name:'模拟阅读修改',version:1});
 await post('/devices/sim_living_room_light/state',{online:false});await wait(async()=>(await find(lamp))?.state.online===false,'scene failure offline');
 const failure=await sceneRequest('/scenes/'+scene.id,'POST',{});assert.equal(failure.run.status,'failed');assert.deepEqual(failure.run.actions.map((a:any)=>a.status),['failed','skipped','skipped']);assert.equal(failure.run.reason,'设备已离线');
 await post('/devices/sim_living_room_light/state',{online:true});await sceneRequest('/scenes/'+scene.id,'DELETE',{});
 console.log('PASS: scene create/edit/execute/delete, physical feedback via SSE, offline reason and skipped actions');

 const nightScene={name:'夜间低亮度',description:'自动化验收',actions:[{deviceId:'ha:'+lamp,command:{capability:'brightness',value:15}},{deviceId:'ha:'+lamp,command:{capability:'power',value:true}}]};
 const nightCreated=await sceneRequest('/scenes','POST',nightScene);const nightId=nightCreated.scenes.find((s:any)=>s.name==='夜间低亮度').id;
 await command(lamp,'power',false);await wait(async()=>(await find(lamp))?.state.values.power===false,'light off baseline before preview');await post('/devices/sim_living_room_motion/state',{occupancy:false});await wait(async()=>(await find(motion))?.state.values.occupancy===false,'motion baseline');
 const rule={schemaVersion:1,name:'夜间人体→低亮度',enabled:true,trigger:{type:'device_state_changed',deviceId:'ha:'+motion,capability:'occupancy',from:false,to:true},condition:{type:'time_window',start:'22:00',end:'06:30',timeZone:'Asia/Shanghai'},action:{type:'run_scene',sceneId:nightId},executionPolicy:{mode:'single',cooldownSeconds:1}};
 const createdRule=await sceneRequest('/automations','POST',rule);const ruleId=createdRule.automations.find((r:any)=>r.name===rule.name).id;
 const preview=await sceneRequest('/automations/preview','POST',{rule,event:{from:false,to:true},at:'2026-11-16T12:00:00+08:00'});assert.equal(preview.wouldRun,false);
 const nightPreview=await sceneRequest('/automations/preview','POST',{rule,event:{from:false,to:true},at:'2026-11-16T23:30:00+08:00'});assert.equal(nightPreview.wouldRun,true);assert.equal((await find(lamp)).state.values.power,false,'preview changed hardware');
 await post('/scenarios/night-motion/run',{});
 await wait(async()=>(await find(lamp))?.state.values.power===true&&(await find(lamp))?.state.values.brightness===15,'night motion -> scene -> low light');
 await wait(async()=>latestState.automationRuns?.some((r:any)=>r.ruleId===ruleId&&r.status==='completed'),'automation completed log');
 await sceneRequest('/automations/'+ruleId,'PATCH',{enabled:false});await command(lamp,'power',false);await post('/devices/sim_living_room_motion/state',{occupancy:false});await wait(async()=>(await find(motion))?.state.values.occupancy===false,'reset motion');await post('/devices/sim_living_room_motion/state',{occupancy:true});await new Promise(r=>setTimeout(r,1000));assert.equal((await find(lamp)).state.values.power,false,'disabled rule executed');
 await post('/devices/sim_living_room_motion/state',{occupancy:false});await wait(async()=>(await find(motion))?.state.values.occupancy===false,'failure baseline');await post('/devices/sim_living_room_light/state',{online:false});await wait(async()=>(await find(lamp))?.state.online===false,'automation failure offline');await sceneRequest('/automations/'+ruleId,'PATCH',{enabled:true});await post('/devices/sim_living_room_motion/state',{occupancy:true});
 await wait(async()=>latestState.automationRuns?.some((r:any)=>r.ruleId===ruleId&&r.status==='failed'&&r.reason==='设备已离线'),'automation failure log');
 await sceneRequest('/automations/'+ruleId,'PATCH',{enabled:false});await post('/devices/sim_living_room_light/state',{online:true});
 console.log('PASS: fixed test clock 23:30; real MQTT occupancy -> rule -> scene -> low brightness -> SSE, daytime preview, disabled rule, failure logs');

 const mock=await fetch(api+'/api/devices/legacy-night-light',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({capability:'brightness',value:43})});assert.equal(mock.status,200);
 const checkpoint=await sceneRequest('/automations/'+ruleId,'PATCH',{enabled:false});
 streamAbort?.abort();const exited=once(backend,'exit');backend.kill();await exited;
 backend=startBackend();api=await ready();latest=[];latestState={};await connectState();
 await wait(async()=>!!latestState.automations?.some((r:any)=>r.id===ruleId),'SQLite rule restoration');
 assert.ok(latestState.scenes.some((s:any)=>s.id===nightId));assert.equal(latestState.devices.find((d:any)=>d.id==='legacy-night-light').state.values.brightness,43);
 for(const run of checkpoint.sceneRuns)assert.ok(latestState.sceneRuns.some((r:any)=>r.id===run.id));
 for(const run of checkpoint.automationRuns)assert.ok(latestState.automationRuns.some((r:any)=>r.id===run.id));
 await assert.rejects(readFile(join(dir,'state.json'),'utf8'),{code:'ENOENT'});
 assert.equal((await readdir(dir)).filter(name=>name.startsWith('state.json.pre-sqlite-')).length,1);
 await wait(async()=>!!(await find(lamp))?.state.online,'HA revalidation after SQLite restart');
 await command(lamp,'power',false);await wait(async()=>(await find(lamp))?.state.values.power===false,'restart light baseline');await post('/devices/sim_living_room_motion/state',{occupancy:false});await wait(async()=>(await find(motion))?.state.values.occupancy===false,'restart motion baseline');
 await sceneRequest('/automations/'+ruleId,'PATCH',{enabled:true});await post('/devices/sim_living_room_motion/state',{occupancy:true});
 await wait(async()=>latestState.automationRuns?.some((r:any)=>r.ruleId===ruleId&&r.status==='completed'&&!checkpoint.automationRuns.some((old:any)=>old.id===r.id)),'restored rule execution');
 await wait(async()=>(await find(lamp))?.state.values.power===true&&(await find(lamp))?.state.values.brightness===15,'restored physical feedback');
 console.log('PASS: JSON migration once, SQLite restart retains devices/scenes/rules/logs, SSE reconnect and restored automation physical execution');
 if(process.argv.includes('--restart-ha')){const restart=spawn('docker',['compose','-f','tools/device-simulator/compose.yml','restart','homeassistant'],{cwd:new URL('../../../',import.meta.url),stdio:'ignore'});await once(restart,'exit');assert.equal(restart.exitCode,0);await wait(async()=>!!(await find(lamp))?.state.online,'HA restart recovery');await command(lamp,'power',true);await wait(async()=>(await find(lamp))?.state.values.power===true,'command after restart');console.log('PASS: actual HA container restart and command recovery');}
}finally{streamAbort?.abort();clearInterval(timer);control.closeAllConnections();control.close();await adapter.close();if(backend.exitCode===null){const done=once(backend,'exit');backend.kill();await done;}await rm(dir,{recursive:true,force:true});await rm(dir+'.key',{force:true});}
