import test from 'node:test';import assert from 'node:assert/strict';import express from 'express';import {once} from 'node:events';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createAuth,authorizeHousehold,validateOrigin} from '../auth.mjs';import {createStateStream} from './state-stream.mjs';
async function fixture(t,sessionTTL=60000){
 const dir=mkdtempSync(join(tmpdir(),'sse-auth-')),app=express(),auth=createAuth({file:join(dir,'auth.json'),sessionTTL});
 let state={devices:[{id:'lamp',state:{online:true,values:{power:false}}}],accounts:[{masked:'private'}],rules:[{name:'private'}],events:[{message:'private'}],expenses:[],greetings:{self:'private'},speaker:'private',lightOn:true};
 const stream=createStateStream({snapshot:()=>state,sessionFor:auth.sessionFor,subscribeAuth:auth.subscribeSessions,heartbeatMs:50});
 app.use(express.json());app.use('/api',validateOrigin);app.use('/api/auth',auth.router);app.use('/api',auth.requireAuth,authorizeHousehold);app.get('/api/events',stream.route);
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');const url='http://127.0.0.1:'+server.address().port;
 t.after(()=>{stream.close();server.closeAllConnections();server.close();rmSync(dir,{recursive:true,force:true});});
 const request=async(path,body,cookie,method='POST')=>{const r=await fetch(url+'/api'+path,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
 const admin=await request('/auth/setup',{username:'sse_admin',password:'sse-test-password',displayName:'Admin',homeName:'Home'});
 async function open(cookie,lastId){const controller=new AbortController();t.after(()=>controller.abort());const r=await fetch(url+'/api/events',{headers:{...(cookie?{Cookie:cookie}:{}),...(lastId?{'Last-Event-ID':lastId}:{})},signal:controller.signal});let buffer='';const reader=r.body.getReader();return {status:r.status,close:()=>controller.abort(),async next(type='snapshot'){
 const timer=setTimeout(()=>controller.abort(),3000);
 try{for(;;){let index;while((index=buffer.indexOf('\n\n'))!==-1){const frame=buffer.slice(0,index);buffer=buffer.slice(index+2);if(frame.includes('event: '+type)){const data=frame.split('\n').find(l=>l.startsWith('data: '));return {id:frame.split('\n').find(l=>l.startsWith('id: '))?.slice(4),data:JSON.parse(data.slice(6))};}}const {done,value}=await reader.read();if(done)throw Error('stream ended');buffer+=new TextDecoder().decode(value);}}finally{clearTimeout(timer);}
 }};}
 return {request,admin,open,publish(power){state={...state,devices:[{id:'lamp',state:{online:true,values:{power}}}]};stream.publish();}};
}
test('SSE authenticates, filters every guest snapshot, reconnects with authoritative state and validates revocation',async t=>{
 const f=await fixture(t);assert.equal((await f.open()).status,401);
 const admin=await f.open(f.admin.cookie);const first=await admin.next();assert.equal(first.data.accounts[0].masked,'private');
 const invite=await f.request('/auth/invitations',{role:'guest',guestHours:1},f.admin.cookie);
 const guest=await f.request('/auth/join',{username:'sse_guest',password:'sse-guest-password',displayName:'Guest',code:invite.data.code});
 const guestStream=await f.open(guest.cookie);assert.equal(JSON.stringify((await guestStream.next()).data).includes('private'),false);
 f.publish(true);assert.equal((await admin.next()).data.devices[0].state.values.power,true);assert.equal(JSON.stringify((await guestStream.next()).data).includes('private'),false);
 admin.close();f.publish(false);const reconnected=await f.open(f.admin.cookie,first.id);assert.equal((await reconnected.next()).data.devices[0].state.values.power,false);
 await f.request('/auth/members/'+guest.data.user.id,{},f.admin.cookie,'DELETE');await guestStream.next('auth-expired');assert.equal((await f.open(guest.cookie)).status,401);
 await f.request('/auth/logout',{},f.admin.cookie);await reconnected.next('auth-expired');
});
test('session expiry terminates a quiet stream without waiting for a device event',async t=>{
 const f=await fixture(t,300);const stream=await f.open(f.admin.cookie);await stream.next();await stream.next('auth-expired');
});
