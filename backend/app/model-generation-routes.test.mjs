import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { SQLiteStore } from '../infrastructure/sqlite-store.mjs';
import { createBackup, restoreBackup } from '../infrastructure/backups.mjs';
import { GenerationRepository } from '../domain/model-generation/repository.mjs';
import { GenerationService } from '../domain/model-generation/service.mjs';
import { buildGeneratedGlb } from '../domain/model-generation/geometry.mjs';
import { ModelLibraryService, validateModelBytes } from '../domain/models/service.mjs';
import { validateImage, validatePlan } from '../domain/model-generation/schema.mjs';
import { createGenerationRouter } from './model-generation-routes.mjs';
import { createAuth, authorizeHousehold, validateOrigin } from '../auth.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=','base64');
const image=()=>({mime:'image/png',dataBase64:png.toString('base64')});
const plan=()=>({schemaVersion:1,width:8,depth:6,height:2.7,footprint:[[0,0],[8,0],[8,6],[0,6]],rooms:[{id:'living',name:'客厅',bounds:[0,0,4,6],deviceRoomIds:[]},{id:'bedroom',name:'卧室',bounds:[4,0,8,6],deviceRoomIds:[]}],walls:[{id:'wall',from:[4,0],to:[4,6],thickness:.12,openings:[{kind:'door',offset:2,width:.9,bottom:0,height:2.1}]}],furniture:[{id:'sofa',roomId:'living',kind:'sofa',x:2,z:2,width:2,depth:1,height:.8,rotation:0,color:'#ccbb99',material:'fabric',style:'rounded'},{id:'bed',roomId:'bedroom',kind:'bed',x:6,z:3,width:1.8,depth:2,height:.6,rotation:0,color:'#ddcbaa',material:'fabric',style:'straight'}],finishes:{floorColor:'#aaaaaa',wallColor:'#eeeeee',floorMaterial:'tile'},notes:['家具尺寸参考全景估算']});
const initial={devices:[],deviceStates:{},scenes:[],automations:[],sceneRuns:[],automationRuns:[],accounts:[],expenses:[],events:[],rules:[]};
function fixture(t,options={}){
  const root=mkdtempSync(join(tmpdir(),'home-generation-')),directory=join(root,'data'),encryptionKey=randomBytes(32);mkdirSync(directory);
  let store=new SQLiteStore(directory,{initialState:initial,encryptionKey}),closed=false;
  const repository=new GenerationRepository(store),activeOwners=new Set(['alice','bob','admin']);
  const calls=[];let respond=async()=>({status:'completed',output_text:JSON.stringify({plan:plan(),dimensionEvidence:{kind:'drawing',label:'8000mm'}}),usage:{input_tokens:10,output_tokens:20}}),builds=0;
  const ai={getForOwner(owner,id){if(id!==owner+'-connection')throw Object.assign(Error('AI 连接不存在'),{status:404,safeAiError:true});return {model:'fake'};},async requestResponses(owner,id,payload,{signal}){this.getForOwner(owner,id);calls.push({owner,payload});return respond({owner,id,payload,signal});}};
  let publishedVersion;
  const publishPlan=async(owner,job,input,bytes)=>{if(input.catalogRevision!==0)throw Object.assign(Error('模型已修改'),{status:409,safeGenerationError:true});publishedVersion={id:'published-v1',plan:job.plan,sourceId:job.sourceId};store.saveModelLibrary({revision:1,defaultModelId:'published',models:[{id:'published',versions:[publishedVersion]}]},0);return {library:store.loadModelLibrary(),modelId:'published'};};
  const service=new GenerationService({repository,ai,importSource:async()=>({title:'全景作品',scenes:[{id:'scene1',name:'客厅',mime:'image/png',image:png}]}),buildGlb:async()=>{builds++;return Buffer.from('preview-glb');},publishPlan,getModelVersion:()=>publishedVersion,isActiveOwner:id=>activeOwners.has(id),devices:()=>[{roomId:'living'}],...options});
  t.after(()=>{service.close();if(!closed)store.close();rmSync(root,{recursive:true,force:true});});
  return {root,directory,encryptionKey,store,repository,service,activeOwners,calls,setRespond:value=>{respond=value;},builds:()=>builds,closeStore(){store.close();closed=true;}};
}
async function finish(service,owner,id){for(let i=0;i<100;i++){const job=service.job(owner,id);if(!['queued','reading'].includes(job.status))return job;await new Promise(resolve=>setImmediate(resolve));}throw Error('job did not settle');}

test('generation validates dimensions, polygons, rooms, furniture, openings and real image headers',()=>{
  assert.deepEqual(validatePlan(plan()),plan());assert.deepEqual(validateImage(png,'image/png'),png);
  for(const change of [p=>p.width=NaN,p=>p.footprint=[[0,0],[8,6],[8,0],[0,6]],p=>p.rooms.push({...p.rooms[0]}),p=>p.furniture[0].roomId='missing',p=>p.furniture[0].x=4,p=>p.walls[0].openings[0].width=8,p=>p.rooms[0].panoramaSceneId='unowned',p=>p.furniture[0].uri='https://evil.example']){const invalid=plan();change(invalid);assert.throws(()=>validatePlan(invalid));}
  const giant=Buffer.from(png);giant.writeUInt32BE(100000,16);assert.throws(()=>validateImage(giant,'image/png'),{status:400});assert.throws(()=>validateImage(png,'image/jpeg'),{status:400});
});

test('background generation persists drafts, isolates owner assets, caches previews, and shares only published sources',async t=>{
  const f=fixture(t),source=await f.service.addSource('alice',{images:[{...image(),name:'客厅'}]});assert.equal(source.scenes.length,1);
  assert.throws(()=>f.service.source('bob',source.id),{status:404});assert.throws(()=>f.service.asset('admin',source.scenes[0].imageAssetId),{status:404});
  const created=f.service.createJob('alice',{connectionId:'alice-connection',sourceId:source.id,floorplan:image(),knownWidth:8});
  assert.equal(typeof created.floorplanAssetId,'string');assert.deepEqual(f.service.asset('alice',created.floorplanAssetId).bytes,png);assert.throws(()=>f.service.asset('bob',created.floorplanAssetId),{status:404});
  assert.equal(created.status,'queued');assert.throws(()=>f.service.createJob('alice',{connectionId:'alice-connection',floorplan:image()}),{status:429});
  const ready=await finish(f.service,'alice',created.id);assert.equal(ready.status,'ready');assert.equal(ready.usage.inputTokens,10);assert.equal(f.calls.length,1);assert.throws(()=>f.service.job('bob',created.id),{status:404});
  assert.ok(!readFileSync(join(f.directory,'home.sqlite')).includes(Buffer.from('家具尺寸')));assert.equal(f.repository.list('job','alice')[0].floorplanAssetId!==undefined,true);
  const a=await f.service.preview('alice',created.id),b=await f.service.preview('alice',created.id);assert.deepEqual(a,b);assert.equal(f.builds(),1);
  const edited=structuredClone(ready.plan);edited.rooms[0].deviceRoomIds=['living'];edited.furniture[0].color='#112233';
  const updated=f.service.updatePlan('alice',created.id,{revision:ready.revision,plan:edited});assert.equal(f.calls.length,1);assert.throws(()=>f.service.updatePlan('alice',created.id,{revision:ready.revision,plan:edited}),{status:409});
  await assert.rejects(f.service.publish('alice',created.id,{revision:updated.revision,catalogRevision:0,name:'方案'},{authorized:()=>false}),{status:403});
  const published=await f.service.publish('alice',created.id,{revision:updated.revision,catalogRevision:0,name:'方案'},{authorized:()=>true});assert.equal(published.modelId,'published');
  assert.deepEqual(f.service.asset('bob',source.scenes[0].imageAssetId).bytes,png);assert.equal(f.service.source('bob',source.id).id,source.id);
  const clone=f.service.fromModel('bob',{modelId:'published',versionId:'published-v1'});assert.equal(clone.connectionId,'');assert.equal(clone.floorplanAssetId,undefined);assert.throws(()=>f.service.asset('bob',created.floorplanAssetId),{status:404});assert.deepEqual(clone.plan,edited);assert.equal(f.calls.length,1);assert.throws(()=>f.service.job('alice',clone.id),{status:404});
  f.service.close();f.closeStore();const backup=join(f.root,'backup.enc');createBackup(f.directory,backup,f.encryptionKey);const restored=join(f.root,'restored');restoreBackup(backup,restored,f.encryptionKey);const next=new SQLiteStore(restored,{encryptionKey:f.encryptionKey});try{const repo=new GenerationRepository(next);assert.equal(repo.get('job','alice',created.id).plan.furniture[0].color,'#112233');assert.deepEqual(repo.asset('bob',source.scenes[0].imageAssetId).bytes,png);}finally{next.close();}
});

test('partial revision preserves other rooms and failures retain original plan and usage',async t=>{
  const f=fixture(t),created=f.service.createJob('alice',{connectionId:'alice-connection',floorplan:image()});let ready=await finish(f.service,'alice',created.id);
  const altered=structuredClone(ready.plan);altered.furniture[0].color='#123456';f.setRespond(async()=>({output_text:JSON.stringify({plan:altered}),usage:{input_tokens:3,output_tokens:4}}));
  f.service.revise('alice',created.id,{revision:ready.revision,connectionId:'alice-connection',roomIds:['living'],instruction:'换沙发颜色'});ready=await finish(f.service,'alice',created.id);assert.equal(ready.status,'ready');assert.equal(ready.plan.furniture[0].color,'#123456');assert.equal(ready.usage.inputTokens,13);
  const bad=structuredClone(ready.plan);bad.furniture[1].color='#abcdef';f.setRespond(async()=>({output_text:JSON.stringify({plan:bad}),usage:{input_tokens:5,output_tokens:6}}));
  f.service.revise('alice',created.id,{revision:ready.revision,connectionId:'alice-connection',roomIds:['living'],instruction:'仅改客厅'});const failed=await finish(f.service,'alice',created.id);assert.equal(failed.status,'failed');assert.deepEqual(failed.plan,ready.plan);assert.equal(failed.usage.inputTokens,18);assert.equal(f.calls.length,3);
});

test('validated AI plan publishes real generated GLB and source metadata atomically as new model and version',async t=>{
  const f=fixture(t,{buildGlb:buildGeneratedGlb}),models=new ModelLibraryService(f.store,{devices:()=>[{roomId:'living'}]});
  f.service.publishPlan=(ownerId,job,input,bytes)=>models.publishGenerated(job,input,bytes,job.sourceId?f.repository.source(ownerId,job.sourceId):undefined);
  const source=await f.service.addSource('alice',{images:[image()]});
  const expected=plan();expected.rooms[0].panoramaSceneId=source.scenes[0].id;
  f.setRespond(async()=>({output_text:JSON.stringify({plan:expected,dimensionEvidence:{kind:'drawing',label:'8m'}})}));
  const started=f.service.createJob('alice',{connectionId:'alice-connection',floorplan:image(),sourceId:source.id}),ready=await finish(f.service,'alice',started.id);
  const bytes=await f.service.preview('alice',ready.id);validateModelBytes(bytes);
  const published=await f.service.publish('alice',ready.id,{revision:ready.revision,catalogRevision:0,name:'生成装修方案'},{authorized:()=>true});
  const version=published.library.models.find(model=>model.id===published.modelId).versions[0];
  assert.deepEqual(version.plan,expected);assert.equal(version.sourceId,source.id);assert.deepEqual(models.asset(version.assetId),bytes);
  assert.deepEqual(f.service.asset('bob',source.scenes[0].imageAssetId).bytes,png);
  await assert.rejects(f.service.publish('alice',ready.id,{revision:ready.revision,catalogRevision:0,name:'错误并发版本',modelId:published.modelId},{authorized:()=>true}),{status:409});
  assert.equal(models.list().models.find(model=>model.id===published.modelId).versions.length,1);
});

test('cancellation and owner revocation prevent late results; restart marks unfinished tasks interrupted without charging',async t=>{
  const f=fixture(t);let settle;f.setRespond(()=>new Promise(resolve=>{settle=resolve;}));
  const job=f.service.createJob('alice',{connectionId:'alice-connection',floorplan:image()});await new Promise(resolve=>setImmediate(resolve));
  const cancelled=f.service.cancel('alice',job.id);assert.equal(cancelled.status,'cancelled');settle({output_text:JSON.stringify({plan:plan(),dimensionEvidence:{kind:'drawing',label:'8m'}})});await new Promise(resolve=>setImmediate(resolve));assert.equal(f.service.job('alice',job.id).status,'cancelled');
  const next=f.service.createJob('bob',{connectionId:'bob-connection',floorplan:image()});await new Promise(resolve=>setImmediate(resolve));f.activeOwners.delete('bob');f.service.revokeInactive();assert.equal(f.repository.get('job','bob',next.id).status,'cancelled');settle({output_text:JSON.stringify({plan:plan()})});await new Promise(resolve=>setImmediate(resolve));
  const draft=f.service.createJob('alice',{connectionId:'alice-connection',floorplan:image()});f.service.close();const calls=f.calls.length;f.repository.recover();assert.equal(f.repository.get('job','alice',draft.id).status,'interrupted');assert.equal(f.calls.length,calls);
});

async function httpFixture(t){
  const f=fixture(t),auth=createAuth({file:join(f.root,'auth.json')}),app=express();app.use('/api',validateOrigin);app.use('/api/auth',express.json({limit:'32kb'}),auth.router);app.use('/api',auth.requireAuth,authorizeHousehold);
  const routes=createGenerationRouter({service:f.service,sessionFor:auth.sessionFor,subscribeAuth:auth.subscribeSessions});app.use('/api/model-generation',routes.router);app.use((error,_req,res,_next)=>res.status(error.status||400).json({message:'输入错误'}));
  const server=await new Promise((resolve,reject)=>{const value=app.listen(0,'127.0.0.1',error=>error?reject(error):resolve(value));});t.after(()=>{routes.close();server.closeAllConnections();server.close();});
  const base=`http://127.0.0.1:${server.address().port}`;async function request(path,{method='GET',body,cookie,raw}={}){const res=await fetch(base+'/api'+path,{method,headers:{...(body!==undefined||raw!==undefined?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},body:raw??(body===undefined?undefined:JSON.stringify(body))});return {status:res.status,body:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};}
  const admin=await request('/auth/setup',{method:'POST',body:{username:'generation_admin',password:'fixture-password',displayName:'管理员',homeName:'家庭'}});f.activeOwners.add(admin.body.user.id);
  async function invite(role){const inv=await request('/auth/invitations',{method:'POST',cookie:admin.cookie,body:{role,expiresInHours:24,...(role==='guest'?{accessHours:1}:{})}});const joined=await request('/auth/join',{method:'POST',body:{username:role+'_generation',password:'fixture-password',displayName:role,code:inv.body.code}});f.activeOwners.add(joined.body.user.id);return joined;}
  return {...f,request,admin,invite};
}
test('generation routes reject unauthenticated and guest uploads before parsing and enforce draft ownership',async t=>{
  const f=await httpFixture(t),member=await f.invite('member'),guest=await f.invite('guest'),prefix='/model-generation';
  assert.equal((await f.request(prefix+'/sources',{method:'POST',raw:'{broken'})).status,401);assert.equal((await f.request(prefix+'/sources',{method:'POST',raw:'{broken',cookie:guest.cookie})).status,403);
  const added=await f.request(prefix+'/sources',{method:'POST',body:{images:[image()]},cookie:member.cookie});assert.equal(added.status,201);assert.equal((await f.request(prefix+'/sources/'+added.body.id,{cookie:f.admin.cookie})).status,404);
  const made=await f.request(prefix+'/jobs',{method:'POST',body:{connectionId:member.body.user.id+'-connection',floorplan:image()},cookie:member.cookie});assert.equal(made.status,202);const ready=await finish(f.service,member.body.user.id,made.body.id);assert.equal(ready.status,'ready');
  const denied=await f.request(prefix+'/jobs/'+ready.id+'/publish',{method:'POST',body:{revision:ready.revision,catalogRevision:0,name:'方案'},cookie:member.cookie});assert.equal(denied.status,403);assert.equal((await f.request(prefix+'/jobs/'+ready.id,{cookie:f.admin.cookie})).status,404);
});
