import {randomBytes} from 'node:crypto';
const encryptionKey=randomBytes(32);
import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync,writeFileSync,readFileSync,readdirSync,statSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {DatabaseSync} from 'node:sqlite';
import {SQLiteStore} from './sqlite-store.mjs';import {initializeDevices} from '../domain/devices/service.mjs';import {initializeScenes} from '../domain/scenes/service.mjs';import {initializeAutomations} from '../domain/automations/engine.mjs';
const initial={devices:[{id:'lamp',name:'旧灯',room:'客厅',kind:'light',on:true,level:37}],rules:[],events:[],accounts:[],expenses:[],greetings:{self:'原欢迎语'},speaker:'音箱',lightOn:false};
const normalize=s=>initializeAutomations(initializeScenes(initializeDevices(s)));
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'home-sqlite-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;}
test('atomic legacy import preserves entities, capability/action order, logs, auth and unknown fields exactly once',t=>{
 const dir=fixture(t);const input=normalize({...initial,extra:{keep:true}});input.automations=[{id:'rule',enabled:false,trigger:{deviceId:'lamp'},action:{sceneId:'home'}}];input.sceneRuns=[{id:'run',status:'completed',actions:[]}];input.automationRuns=[{id:'auto',status:'failed',reason:'旧失败'}];
 const auth={household:{id:'home',name:'家庭'},users:[{id:'user',username:'owner',passwordHash:'kept-hash',salt:'kept-salt',role:'admin'}],invitations:[{hash:'invite-hash',role:'guest'}]};
 writeFileSync(join(dir,'state.json'),JSON.stringify(input));writeFileSync(join(dir,'auth.json'),JSON.stringify(auth));
 let store=new SQLiteStore(dir,{initialState:initial,normalize,encryptionKey});assert.deepEqual(store.loadState(),input);assert.deepEqual(store.loadAuth(),auth);assert.equal(store.db.prepare('SELECT count(*) AS n FROM scene_actions').get().n,input.scenes.reduce((n,s)=>n+s.actions.length,0));assert.equal(statSync(join(dir,'home.sqlite')).mode&0o777,0o600);
 const backup=readdirSync(dir).filter(f=>f.includes('.pre-sqlite-'));assert.equal(backup.length,2);assert.ok(backup.every(f=>(statSync(join(dir,f)).mode&0o777)===0o600));
 const next=store.loadState();next.deviceStates.lamp.values.brightness=15;next.scenes=[];store.saveState(next);store.close();
 writeFileSync(join(dir,'state.json'),JSON.stringify(input));store=new SQLiteStore(dir,{initialState:initial,normalize,encryptionKey});assert.equal(store.loadState().deviceStates.lamp.values.brightness,15);assert.deepEqual(store.loadState().scenes,[]);assert.equal(store.loadState().automationRuns[0].reason,'旧失败');assert.deepEqual(store.loadAuth(),auth);assert.equal(readdirSync(dir).filter(f=>f.includes('.pre-sqlite-')).length,2);store.close();
});
test('invalid migration never commits initialized state and can be retried without data loss',t=>{
 const dir=fixture(t);writeFileSync(join(dir,'state.json'),'{bad');assert.throws(()=>new SQLiteStore(dir,{initialState:initial,normalize,encryptionKey}),/格式错误/);assert.equal(readFileSync(join(dir,'state.json'),'utf8'),'{bad');
 writeFileSync(join(dir,'state.json'),JSON.stringify(initial));const store=new SQLiteStore(dir,{initialState:initial,normalize,encryptionKey});assert.equal(store.loadState().devices[0].id,'lamp');store.close();
});
test('constraint failure rolls back whole business transaction and stale writers are rejected',t=>{
 const dir=fixture(t);const first=new SQLiteStore(dir,{initialState:initial,normalize,encryptionKey}),second=new SQLiteStore(dir,{initialState:initial,normalize,encryptionKey});
 const before=first.loadState(),bad=structuredClone(before);bad.greetings.self='must rollback';bad.devices[0].name='must rollback';bad.scenes.push(bad.scenes[0]);assert.throws(()=>first.saveState(bad));assert.deepEqual(first.loadState(),before);
 const next=structuredClone(before);next.greetings.self='committed';first.saveState(next);assert.throws(()=>second.saveState(before),{status:409});assert.equal(second.loadState().greetings.self,'committed');first.close();second.close();
});
test('provider cache resumes offline, interrupted runs are persisted as failed, and auth create is exclusive',t=>{
 const dir=fixture(t);let store=new SQLiteStore(dir,{initialState:initial,normalize,encryptionKey});const state=store.loadState();state.sceneRuns=[{id:'run',status:'running',actions:[{status:'executing'},{status:'pending'}]}];state.automationRuns=[{id:'a',status:'running'}];store.saveState(state);store.saveProviderDevices([{id:'ha:lamp',providerId:'home-assistant',state:{online:true,lastSeenAt:'2026-11-16T00:00:00Z',values:{power:true}}}]);
 const auth={household:{id:'h',name:'家庭'},users:[],invitations:[]};store.saveAuth(auth,{create:true});assert.throws(()=>store.saveAuth(auth,{create:true}),{code:'EEXIST'});store.close();
 store=new SQLiteStore(dir,{initialState:initial,normalize,encryptionKey});const recovered=normalize(store.loadState());store.saveState(recovered);assert.equal(store.loadState().sceneRuns[0].status,'failed');assert.equal(store.loadState().sceneRuns[0].actions[0].status,'failed');assert.equal(store.loadState().automationRuns[0].status,'failed');assert.equal(store.loadProviderDevices()[0].state.online,false);assert.equal(store.loadProviderDevices()[0].state.lastSeenAt,'2026-11-16T00:00:00Z');store.close();
});
test('newer schema refuses to open rather than importing JSON over it',t=>{const dir=fixture(t);const db=new DatabaseSync(join(dir,'home.sqlite'));db.exec('PRAGMA user_version=99');db.close();assert.throws(()=>new SQLiteStore(dir,{initialState:initial,normalize,encryptionKey}),/拒绝降级/);});
