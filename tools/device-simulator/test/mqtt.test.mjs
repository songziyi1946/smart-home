import test from 'node:test';import assert from 'node:assert/strict';import {Aedes} from 'aedes';import mqtt from 'mqtt';import {createServer} from 'node:net';import {once} from 'node:events';import {Simulator} from '../src/core.ts';import {connectSimulator,base} from '../src/mqtt.ts';
test('MQTT discovery, state publishing, offline command rejection and availability',async t=>{
 const broker=await Aedes.createBroker(),server=createServer(broker.handle);server.listen(0,'127.0.0.1');await once(server,'listening');
 const url='mqtt://127.0.0.1:'+server.address().port,client=await mqtt.connectAsync(url),sim=new Simulator(),messages=new Map();let adapter;
 t.after(async()=>{await adapter?.close();await client.endAsync();await new Promise(r=>broker.close(r));await new Promise(r=>server.close(r));});
 client.on('message',(topic,bytes)=>messages.set(topic,bytes.toString()));await client.subscribeAsync(['homeassistant/#','smart-home-simulator/#']);adapter=connectSimulator(sim,{url,log:()=>{}});
 async function wait(check){for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,20));}throw Error('MQTT timeout');}
 await wait(()=>messages.get('smart-home-simulator/availability')==='online');assert.ok(messages.has('homeassistant/device/sim_living_room_environment/config'));
 const id='sim_living_room_light',topic=base(id);sim.patch(id,{online:false});await wait(()=>messages.get(topic+'/availability')==='offline');await client.publishAsync(topic+'/set','{"state":"ON"}');await new Promise(r=>setTimeout(r,50));sim.advance(500);assert.equal(sim.get(id).state.power,false);
 sim.patch(id,{online:true});await client.publishAsync(topic+'/set','{"state":"ON"}');await wait(()=>sim.jobs.length>0);sim.advance(200);await wait(()=>JSON.parse(messages.get(topic+'/state')).state==='ON');
 sim.patch('sim_living_room_environment',{co2:1200});await wait(()=>JSON.parse(messages.get(base('sim_living_room_environment')+'/state')).co2===1200);
 await client.publishAsync('homeassistant/status','online');await adapter.close();adapter=undefined;await wait(()=>messages.get('smart-home-simulator/availability')==='offline');
});
