import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { HomeAssistantProvider } from './index.mjs';

async function until(check) { for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,20));}throw Error('Timed out'); }
async function fixture(t, options = {}) {
  let entity={entity_id:'light.test',state:'off',attributes:{supported_color_modes:['brightness'],brightness:128},last_updated:new Date().toISOString()};
  let failure=0, serviceCalls=0, discoveryStarted=false, connections=0;
  const server=createServer(async(req,res)=>{
    res.setHeader('Content-Type','application/json');
    if(req.headers.authorization!=='Bearer fixture-secret'){res.writeHead(401);res.end('{}');return;}
    if(failure){res.writeHead(failure);res.end('{"message":"fixture-secret"}');return;}
    if(req.url==='/api/config')return res.end(JSON.stringify({unit_system:{temperature:'°C'}}));
    if(req.url==='/api/states'){const snapshot=JSON.stringify(options.empty ? [] : [entity]);discoveryStarted=true;setTimeout(()=>res.end(snapshot), options.discoveryDelay ?? 0);return;}
    if(req.url==='/api/states/light.test')return res.end(JSON.stringify(entity));
    if(req.url==='/api/services/light/turn_on'){
      serviceCalls++;let input='';for await(const chunk of req)input+=chunk;
      assert.equal(JSON.parse(input).entity_id,'light.test');
      entity={...entity,state:'on',last_updated:new Date().toISOString()};
      event(entity);return res.end(JSON.stringify([entity]));
    }
    res.writeHead(404);res.end('{}');
  });
  const wss=new WebSocketServer({server});
  const event=value=>{for(const socket of wss.clients)socket.send(JSON.stringify({id:1,type:'event',event:{event_type:'state_changed',data:{entity_id:'light.test',new_state:value}}}));};
  wss.on('connection',socket=>{
    connections++;
    socket.send(JSON.stringify({type:'auth_required'}));
    socket.on('message',raw=>{
      const msg=JSON.parse(raw);
      if(msg.type==='auth')socket.send(JSON.stringify({type:msg.access_token==='fixture-secret'?'auth_ok':'auth_invalid'}));
      else {assert.equal(msg.event_type,'state_changed');socket.send(JSON.stringify({id:msg.id,type:'result',success:true,result:null}));}
    });
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const provider=new HomeAssistantProvider({url:`http://127.0.0.1:${server.address().port}`,token:options.token ?? 'fixture-secret',reconnectMs:20,timeoutMs:1000,cachedDevices:options.cachedDevices,onStatus:options.onStatus});
  t.after(()=>{provider.close();for(const socket of wss.clients)socket.terminate();wss.close();server.closeAllConnections();server.close();});
  return {provider,event,discoveryStarted:()=>discoveryStarted,connections:()=>connections,setState(value){entity={...entity,state:value,last_updated:new Date().toISOString()};event(entity);},setFailure(value){failure=value;},disconnect(){for(const socket of wss.clients)socket.terminate();},calls:()=>serviceCalls};
}
test('REST discovery/read/command and WS external events, deletion, reconnect resync',async t=>{
  const f=await fixture(t), events=[];
  const unsubscribe=f.provider.subscribe(event=>events.push(event));
  await until(()=>f.provider.connected);
  assert.equal(f.provider.snapshot()[0].state.values.power,false);
  const result=await f.provider.executeCommand('light.test',{capability:'power',value:true});
  assert.equal(result.values.power,true);assert.equal(f.calls(),1);
  f.setState('off');await until(()=>f.provider.snapshot()[0].state.values.power===false);
  f.event(null);await until(()=>f.provider.snapshot().length===0);
  assert.ok(events.some(e=>e.removedDeviceId==='ha:light.test'));
  f.disconnect();await until(()=>!f.provider.connected);await until(()=>f.provider.connected);
  assert.equal(f.provider.snapshot().length,1);
  assert.equal(JSON.stringify(f.provider.snapshot()).includes('fixture-secret'),false);
  unsubscribe();assert.equal(f.provider.stopped,true);
});
test('authentication and service failures are sanitized; unsupported commands do not reach HA',async t=>{
  const f=await fixture(t);
  await assert.rejects(f.provider.executeCommand('light.test',{capability:'cleaning',value:true}),{status:400});
  assert.equal(f.calls(),0);
  f.setFailure(401);
  await assert.rejects(f.provider.discoverOrListDevices(),e=>e.status===502&&!e.message.includes('fixture-secret'));
  assert.throws(()=>new HomeAssistantProvider({url:'https://user:secret@example.com',token:'x'}));
});
test('initial empty HA discovery notifies cache owners to remove stale restored devices', async t => {
  let persisted;
  const cached = { id: 'ha:light.old', name: '旧设备', roomId: 'living', room: '客厅', providerId: 'home-assistant', providerDeviceId: 'light.old', capabilities: ['power'], state: { deviceId: 'ha:light.old', source: 'home-assistant', online: false, values: { power: false } } };
  const f = await fixture(t, { empty: true, cachedDevices: [cached], onStatus: () => { persisted = f.provider.snapshot(); } });
  assert.equal(f.provider.snapshot().length, 1);
  f.provider.subscribe(() => {}); await until(() => f.provider.connected && persisted !== undefined);
  assert.deepEqual(persisted, []);
});

test('events received during REST snapshot are replayed after subscription acknowledgement',async t=>{
  const f=await fixture(t,{discoveryDelay:100});
  f.provider.subscribe(()=>{});
  await until(()=>f.discoveryStarted());
  f.setState('on');
  await until(()=>f.provider.connected);
  assert.equal(f.provider.snapshot()[0].state.values.power,true);
});
test('WS rejects invalid authentication and stops retries when closed',async t=>{
  const f=await fixture(t,{token:'invalid'});
  f.provider.subscribe(()=>{});
  await until(()=>f.connections()>0);
  assert.equal(f.provider.connected,false);
  assert.deepEqual(f.provider.snapshot(),[]);
  f.provider.close();
  const count=f.connections();await new Promise(resolve=>setTimeout(resolve,70));
  assert.equal(f.connections(),count);
});

test('offline entity preserves simulator provenance and last online timestamp',async t=>{
 const f=await fixture(t);const time='2026-11-16T01:00:00Z';
 f.provider.ingest('light.test',{entity_id:'light.test',state:'on',last_updated:time,attributes:{source:'simulator',last_seen:time}});
 f.provider.ingest('light.test',{entity_id:'light.test',state:'unavailable',last_updated:'2026-11-16T02:00:00Z',attributes:{}});
 const state=f.provider.snapshot()[0].state;
 assert.equal(state.source,'simulator');assert.equal(state.lastSeenAt,'2026-11-16T01:00:00.000Z');assert.equal(state.online,false);
});
