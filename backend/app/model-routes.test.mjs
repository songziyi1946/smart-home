import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { SQLiteStore } from '../infrastructure/sqlite-store.mjs';
import { createBackup, restoreBackup } from '../infrastructure/backups.mjs';
import { ModelLibraryService, validateModelBytes } from '../domain/models/service.mjs';
import { createModelRouter } from './model-routes.mjs';
import { createAuth, authorizeHousehold, validateOrigin } from '../auth.mjs';

const initial = { devices: [], deviceStates: {}, scenes: [], automations: [], sceneRuns: [], automationRuns: [], accounts: [], expenses: [], events: [], rules: [] };
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'home-model-library-')), directory = join(root, 'data'), encryptionKey = randomBytes(32);
  let store = new SQLiteStore(directory, {initialState: initial, encryptionKey});
  let closed = false;
  t.after(() => { if (!closed) store.close(); rmSync(root, {recursive:true,force:true}); });
  const service = () => new ModelLibraryService(store, { devices: () => [{roomId:'real-living'}] });
  return {root, directory, encryptionKey, get store() {return store;}, service, restart() {store.close(); store = new SQLiteStore(directory, {encryptionKey});}, close() {store.close();closed=true;}};
}
function glb(uri) {
  const binary = Buffer.alloc(36);
  const json = {asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0}}]}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,0,1]}],bufferViews:[{buffer:0,byteLength:36}],buffers:[{byteLength:36,...(uri?{uri}:{})}]};
  const text = Buffer.from(JSON.stringify(json));
  const jsonBytes = Buffer.alloc(Math.ceil(text.length/4)*4,0x20); text.copy(jsonBytes);
  const output = Buffer.alloc(12+8+jsonBytes.length+8+binary.length);
  output.writeUInt32LE(0x46546c67,0); output.writeUInt32LE(2,4); output.writeUInt32LE(output.length,8);
  output.writeUInt32LE(jsonBytes.length,12); output.writeUInt32LE(0x4e4f534a,16); jsonBytes.copy(output,20);
  const offset=20+jsonBytes.length; output.writeUInt32LE(binary.length,offset); output.writeUInt32LE(0x004e4942,offset+4); binary.copy(output,offset+8); return output;
}
function input(revision=0) {return {revision,name:'装修方案 A',version:{source:'upload',width:10,depth:8,height:2.7,rooms:[{id:'living',name:'起居室',bounds:[0,0,4,4],deviceRoomIds:['real-living']}]},assetBase64:glb().toString('base64')};}

test('model versions are encrypted, persisted, independent of business state, and restored atomically', t => {
  const f=fixture(t), before=f.store.loadState();
  let library=f.service().save(input()), model=library.models.at(-1), first=model.versions[0];
  assert.equal(library.revision,1); assert.equal(library.defaultModelId,'builtin');
  assert.deepEqual(f.service().asset(first.assetId),glb());
  const disk = f.store.db.prepare('SELECT payload FROM space_model_catalog').get().payload;
  assert.ok(!disk.includes('装修方案')); assert.ok(!disk.includes('real-living'));
  assert.ok(!f.store.db.prepare('SELECT payload FROM space_model_assets').get().payload.includes('glTF'));
  f.restart(); assert.deepEqual(f.service().list(),library); assert.deepEqual(f.store.loadState(),before);
  const revisionInput=input(1); delete revisionInput.assetBase64; revisionInput.version.assetId=first.assetId; revisionInput.name='装修方案 A 第二版';
  library=f.service().save(revisionInput,model.id); model=library.models.at(-1);
  assert.equal(model.versions.length,2); assert.notEqual(model.currentVersionId,first.id);
  library=f.service().restore(model.id,{revision:2,versionId:first.id}); assert.equal(library.models.at(-1).currentVersionId,first.id);
  library=f.service().setDefault({revision:3,modelId:model.id}); assert.equal(library.defaultModelId,model.id);
  assert.throws(()=>f.service().save(input(1),model.id),{status:409}); assert.deepEqual(f.service().list(),library);
  const invalid=input(4); invalid.version.rooms[0].bounds=[0,0,40,4];
  assert.throws(()=>f.service().save(invalid,model.id),{status:400}); assert.deepEqual(f.service().list(),library);
  const broken=structuredClone(library); broken.revision++;
  assert.throws(()=>f.store.saveModelLibrary(broken,4,{id:first.assetId,modelId:model.id,bytes:glb()}));
  assert.deepEqual(f.service().list(),library);
  const backup=join(f.root,'backup.enc'); f.close(); createBackup(f.directory,backup,f.encryptionKey);
  assert.ok(!readFileSync(backup,'utf8').includes('装修方案'));
  const restored=join(f.root,'restored'); restoreBackup(backup,restored,f.encryptionKey);
  const other=new SQLiteStore(restored,{encryptionKey:f.encryptionKey});
  try {assert.deepEqual(other.loadModelLibrary(),library); assert.deepEqual(other.loadModelAsset(first.assetId),glb());} finally {other.close();}
});

test('invalid geometry, external resources, unknown bindings and cross-model asset reuse are rejected', t => {
  const f=fixture(t), service=f.service();
  assert.throws(()=>validateModelBytes(glb('https://example.com/model.bin')),{status:400});
  const corrupt=glb(); corrupt.writeUInt32LE(3,4); assert.throws(()=>validateModelBytes(corrupt),{status:400});
  assert.throws(()=>validateModelBytes(Buffer.from('not a model')),{status:400});
  for (const change of [v=>v.rooms[0].deviceRoomIds=['not-a-room'],v=>v.rooms.push({...v.rooms[0]}),v=>v.rooms[0].panoramaSceneId='not-a-panorama',v=>v.width=Infinity]) {
    const body=input(); change(body.version); assert.throws(()=>service.save(body)); assert.equal(service.list().revision,0);
  }
  let library=service.save(input()); const saved=library.models.at(-1).versions[0];
  const copied=input(1); delete copied.assetBase64; copied.version.assetId=saved.assetId;
  assert.throws(()=>service.save(copied),{status:400}); assert.equal(service.list().revision,1);
  const builtin=structuredClone(library.models[0].versions[0]); delete builtin.id; delete builtin.createdAt;
  library=service.save({revision:1,name:'内置复制',version:builtin}); assert.equal(library.models.at(-1).versions[0].source,'builtin');
  builtin.width+=1; assert.throws(()=>service.save({revision:2,name:'错误比例',version:builtin}),{status:400});
});

async function httpFixture(t) {
  const f=fixture(t), app=express();
  const auth=createAuth({repository:{load:()=>f.store.loadAuth(),save:data=>f.store.saveAuth(data),create:data=>f.store.saveAuth(data,{create:true})}});
  app.use('/api',validateOrigin); app.use('/api/auth',express.json({limit:'32kb'}),auth.router); app.use('/api',auth.requireAuth,authorizeHousehold);
  app.use('/api/models',createModelRouter({service:f.service()}));
  app.use((error,_req,res,_next)=>res.status(error instanceof z.ZodError?400:error.status||500).json({message:error.message}));
  const server=await new Promise((resolve,reject)=>{const value=app.listen(0,'127.0.0.1',error=>error?reject(error):resolve(value));});
  t.after(()=>{server.closeAllConnections();server.close();});
  const base=`http://127.0.0.1:${server.address().port}`;
  async function request(path,{method='GET',body,cookie,origin,raw}={}) {
    const response=await fetch(base+'/api'+path,{method,headers:{...(body!==undefined||raw!==undefined?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...(origin?{Origin:origin}:{})},body:raw??(body===undefined?undefined:JSON.stringify(body))});
    const data=response.headers.get('content-type')?.includes('json')?await response.json():Buffer.from(await response.arrayBuffer());
    return {status:response.status,body:data,cookie:response.headers.get('set-cookie')?.split(';')[0],cache:response.headers.get('cache-control')};
  }
  const admin=await request('/auth/setup',{method:'POST',body:{username:'model_admin',password:'fixture-model-password',displayName:'管理员',homeName:'模型家庭'}});
  assert.equal(admin.status,200);
  async function invite(role){const value=await request('/auth/invitations',{method:'POST',cookie:admin.cookie,body:{role,expiresInHours:24,...(role==='guest'?{accessHours:1}:{})}});const joined=await request('/auth/join',{method:'POST',body:{username:role+'_models',password:'fixture-member-password',displayName:role,code:value.body.code}});assert.equal(joined.status,200);return joined.cookie;}
  return {request,admin:admin.cookie,invite};
}

test('model APIs authorize before parsing uploads, members read, guests cannot access models or assets', async t => {
  const f=await httpFixture(t), member=await f.invite('member'), guest=await f.invite('guest');
  assert.equal((await f.request('/models')).status,401);
  assert.equal((await f.request('/models',{cookie:member})).status,200);
  assert.equal((await f.request('/models',{cookie:guest})).status,403);
  assert.equal((await f.request('/models',{method:'POST',raw:'{broken',cookie:member})).status,403);
  assert.equal((await f.request('/models',{method:'POST',raw:'{broken'})).status,401);
  assert.equal((await f.request('/models',{method:'POST',body:input(),cookie:f.admin,origin:'https://other.example'})).status,403);
  const created=await f.request('/models',{method:'POST',body:input(),cookie:f.admin}); assert.equal(created.status,201);
  const model=created.body.models.at(-1), asset=model.versions[0].assetId;
  const downloaded=await f.request('/models/assets/'+asset,{cookie:member}); assert.equal(downloaded.status,200); assert.equal(downloaded.cache,'no-store'); assert.deepEqual(downloaded.body,glb());
  assert.equal((await f.request('/models/assets/'+asset,{cookie:guest})).status,403);
  for(const [path,method,body] of [[`/models/${model.id}/versions`,'POST',input(1)],[`/models/${model.id}/restore`,'POST',{revision:1,versionId:model.currentVersionId}],['/models/default','PUT',{revision:1,modelId:model.id}]]) assert.equal((await f.request(path,{method,body,cookie:member})).status,403);
  assert.equal((await f.request('/models',{method:'POST',body:input(0),cookie:f.admin})).status,409);
});
