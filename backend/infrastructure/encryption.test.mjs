import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,statSync,chmodSync,readdirSync,existsSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createEncryption,loadStorageKey,readKeyFile,writeProtected} from './encryption.mjs';
import {SQLiteStore} from './sqlite-store.mjs';
import {createBackup,restoreBackup,readBackup,migrateDatabase} from './backups.mjs';
import {acquireDataLock} from './data-lock.mjs';
import {DatabaseSync} from 'node:sqlite';
import {spawnSync} from 'node:child_process';

const key=randomBytes(32);
const privateText='private-household-DO-NOT-STORE-IN-PLAINTEXT';
const state={devices:[{id:'lamp',name:privateText,roomId:'living',room:privateText,providerId:'mock',providerDeviceId:'lamp',capabilities:['power']}],deviceStates:{lamp:{deviceId:'lamp',source:'mock',online:true,values:{power:false}}},scenes:[{id:'home',name:privateText,description:'',version:1,actions:[{deviceId:'lamp',command:{capability:'power',value:true}}]}],automations:[],sceneRuns:[],automationRuns:[],accounts:[{id:'account',number:privateText,name:'account',category:'电费'}],expenses:[],events:[],rules:[],greetings:{self:privateText},speaker:privateText,lightOn:false,unknown:{value:privateText}};
const auth={household:{id:'h',name:privateText},users:[{id:'u',username:privateText,passwordHash:privateText,salt:privateText,role:'admin'}],invitations:[{hash:'invitation-hash',role:'guest'}]};
const providers=[{id:'ha:lamp',name:privateText,state:{online:true,values:{power:true}}}];
function fixture(t){const root=mkdtempSync(join(tmpdir(),'home-encryption-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return root;}
function storeAt(dir){return new SQLiteStore(dir,{initialState:state,encryptionKey:key});}
function inspectFiles(directory){for(const name of readdirSync(directory)){const path=join(directory,name);if(statSync(path).isFile()){assert.equal(readFileSync(path).includes(Buffer.from(privateText)),false,name);assert.equal(statSync(path).mode&0o077,0,name);}}}

test('authenticated encryption is randomized, contextual and rejects wrong keys and tampering',()=>{
  const encryption=createEncryption(key),plain=Buffer.from(privateText);
  const first=encryption.seal(plain,'row:1');assert.notEqual(first,encryption.seal(plain,'row:1'));
  assert.deepEqual(encryption.open(first,'row:1'),plain);
  assert.throws(()=>encryption.open(first,'row:2'),/解密失败/);
  assert.throws(()=>createEncryption(randomBytes(32)).open(first,'row:1'),/解密失败/);
  const changed=JSON.parse(first);changed.tag=Buffer.alloc(16).toString('base64');
  assert.throws(()=>encryption.open(JSON.stringify(changed),'row:1'),/解密失败/);
  assert.throws(()=>encryption.open('{}','row:1'),/解密失败/);
});

test('keys stay outside data, require private regular files, never overwrite and are mandatory in production',t=>{
  const root=fixture(t),dir=join(root,'data');mkdirSync(dir);
  assert.throws(()=>loadStorageKey(dir,{NODE_ENV:'production'}),/必须配置/);
  const local=loadStorageKey(dir,{});assert.equal(local.length,32);assert.equal(existsSync(dir+'.key'),true);assert.deepEqual(loadStorageKey(dir,{}),local);
  assert.throws(()=>writeProtected(dir+'.key','replacement'),{code:'EEXIST'});
  assert.throws(()=>readKeyFile(join(dir,'inside.key'),dir),/之外/);
  writeFileSync(join(root,'public.key'),key.toString('hex'),{mode:0o644});assert.throws(()=>readKeyFile(join(root,'public.key'),dir),/600/);
  symlinkSync(dir+'.key',join(root,'link.key'));assert.throws(()=>readKeyFile(join(root,'link.key'),dir),/600/);
  writeProtected(join(dir,'inside.key'),key.toString('hex'));symlinkSync(dir,join(root,'alias'));
  assert.throws(()=>readKeyFile(join(root,'alias','inside.key'),dir));
  writeFileSync(join(dir,'home.sqlite'),'fixture');rmSync(dir+'.key');assert.throws(()=>loadStorageKey(dir,{}));assert.equal(existsSync(dir+'.key'),false);
});

test('SQLite encrypts all payloads and commands, including WAL, auth, cache and preserved fields',t=>{
  const root=fixture(t),dir=join(root,'data');mkdirSync(dir,{mode:0o755});let store=storeAt(dir);
  store.saveAuth(auth,{create:true});store.saveProviderDevices(providers);
  assert.equal(statSync(dir).mode&0o777,0o700);inspectFiles(dir);
  assert.deepEqual(store.loadState(),state);assert.deepEqual(store.loadAuth(),auth);store.close();
  const before=readFileSync(join(dir,'home.sqlite'));
  assert.throws(()=>new SQLiteStore(dir,{encryptionKey:randomBytes(32)}),/解密失败/);
  assert.deepEqual(readFileSync(join(dir,'home.sqlite')),before);
  store=storeAt(dir);assert.deepEqual(store.loadState(),state);assert.deepEqual(store.loadAuth(),auth);
  const payload=store.db.prepare("SELECT payload FROM auth_users WHERE key='u'").get().payload;
  store.db.prepare("UPDATE auth_households SET payload=? WHERE key='h'").run(payload);
  assert.throws(()=>store.loadAuth(),/解密失败/);store.close();
});

test('encrypted backups restore complete snapshots into a new directory and reject corrupt input or overwrite',t=>{
  const root=fixture(t),dir=join(root,'data');let store=storeAt(dir);store.saveAuth(auth);store.saveProviderDevices(providers);store.close();
  const archive=join(root,'household.homeos.enc');createBackup(dir,archive,key);
  assert.equal(statSync(archive).mode&0o777,0o600);assert.equal(readFileSync(archive).includes(Buffer.from(privateText)),false);
  const value=readBackup(archive,key);assert.deepEqual(value.state,state);assert.deepEqual(value.auth,auth);assert.deepEqual(value.providers,providers);
  const target=join(root,'restored');restoreBackup(archive,target,key);store=storeAt(target);assert.deepEqual(store.loadState(),state);assert.deepEqual(store.loadAuth(),auth);assert.deepEqual(store.loadProviderDevices(),providers.map(d=>({...d,state:{...d.state,online:false}})));store.close();
  assert.throws(()=>restoreBackup(archive,target,key),{code:'EEXIST'});
  const missing=join(root,'must-not-exist');assert.throws(()=>restoreBackup(archive,missing,randomBytes(32)),/解密失败/);assert.equal(existsSync(missing),false);
  const changed=JSON.parse(readFileSync(archive));changed.data='AAAA';writeFileSync(join(root,'corrupt.enc'),JSON.stringify(changed));assert.throws(()=>restoreBackup(join(root,'corrupt.enc'),missing,key),/解密失败/);assert.equal(existsSync(missing),false);
});

function legacyDatabase(dir){
  mkdirSync(dir,{mode:0o700});const db=new DatabaseSync(join(dir,'home.sqlite'));
  const fields={devices:'devices',scenes:'scenes',automations:'automation_rules',sceneRuns:'scene_runs',automationRuns:'automation_runs',accounts:'utility_accounts',expenses:'expenses',events:'events',rules:'legacy_rules'};
  const tables=[...Object.values(fields),'device_states','settings','auth_households','auth_users','auth_invitations','provider_devices','metadata'];
  for(const table of tables)db.exec(`CREATE TABLE ${table}(key TEXT PRIMARY KEY,position INTEGER,payload TEXT)`);
  const insert=(table,key,value,position=0)=>db.prepare(`INSERT INTO ${table} VALUES(?,?,?)`).run(key,position,JSON.stringify(value));
  for(const [field,table] of Object.entries(fields))state[field].forEach((item,i)=>{const {capabilities,actions,...base}=item;insert(table,item.id,base,i);});
  for(const [k,v] of Object.entries(state))if(!(k in fields)&&k!=='deviceStates')insert('settings',k,v);
  for(const [k,v] of Object.entries(state.deviceStates))insert('device_states',k,v);
  db.exec('CREATE TABLE device_capabilities(device_id TEXT,position INTEGER,capability TEXT);CREATE TABLE scene_actions(scene_id TEXT,position INTEGER,device_id TEXT,command TEXT);');
  for(const d of state.devices)d.capabilities.forEach((c,i)=>db.prepare('INSERT INTO device_capabilities VALUES(?,?,?)').run(d.id,i,c));
  for(const s of state.scenes)s.actions.forEach((a,i)=>db.prepare('INSERT INTO scene_actions VALUES(?,?,?,?)').run(s.id,i,a.deviceId,JSON.stringify(a.command)));
  insert('auth_households','h',{...auth.household,_extra:{}});auth.users.forEach(u=>insert('auth_users',u.id,u));auth.invitations.forEach(i=>insert('auth_invitations',i.hash,i));providers.forEach(d=>insert('provider_devices',d.id,d));
  db.exec('PRAGMA user_version=1');db.close();
  writeFileSync(join(dir,'auth.json'),JSON.stringify(auth));writeFileSync(join(dir,'state.json.pre-sqlite-old.bak'),JSON.stringify(state));
}

test('offline migration preserves data, archives originals as ciphertext and leaves no plaintext artifacts',t=>{
  const root=fixture(t),dir=join(root,'data');legacyDatabase(dir);
  const before=readFileSync(join(dir,'home.sqlite'));assert.throws(()=>storeAt(dir),/未加密/);assert.deepEqual(readFileSync(join(dir,'home.sqlite')),before);
  const backup=join(dir,'migration.homeos.enc');
  chmodSync(root,0o500);
  try{migrateDatabase(dir,backup,key);}finally{chmodSync(root,0o700);}
  inspectFiles(dir);
  assert.equal(existsSync(join(dir,'auth.json')),false);assert.equal(existsSync(join(dir,'state.json.pre-sqlite-old.bak')),false);
  const archived=readBackup(backup,key);assert.deepEqual(Buffer.from(archived.sourceFiles['home.sqlite'],'base64'),before);
  const store=storeAt(dir);assert.deepEqual(store.loadState(),state);assert.deepEqual(store.loadAuth(),auth);store.close();
});

test('maintenance refuses a running application and backup conflicts leave source unchanged',t=>{
  const root=fixture(t),dir=join(root,'data');legacyDatabase(dir);const before=readFileSync(join(dir,'home.sqlite'));
  const release=acquireDataLock(dir);assert.throws(()=>acquireDataLock(dir),/正在使用/);assert.throws(()=>migrateDatabase(dir,join(root,'x.enc'),key),/正在使用/);release();
  const backup=join(root,'existing.enc');writeFileSync(backup,'existing');assert.throws(()=>migrateDatabase(dir,backup,key),{code:'EEXIST'});assert.deepEqual(readFileSync(join(dir,'home.sqlite')),before);assert.equal(readFileSync(backup,'utf8'),'existing');
  writeFileSync(join(dir,'home.sqlite-wal'),'active');assert.throws(()=>migrateDatabase(dir,join(root,'x.enc'),key),/活动文件/);assert.deepEqual(readFileSync(join(dir,'home.sqlite')),before);
});

test('CLI key generation, encrypted backup and restore never print secrets or overwrite a key',t=>{
  const root=fixture(t),keyPath=join(root,'data.key');
  const cli=(...args)=>spawnSync(process.execPath,['backend/maintenance.mjs',...args],{cwd:new URL('../../',import.meta.url),encoding:'utf8'});
  const generated=cli('keygen','--key-file',keyPath);assert.equal(generated.status,0);
  const material=readFileSync(keyPath,'utf8').trim();assert.equal((generated.stdout+generated.stderr).includes(material),false);
  assert.equal(cli('keygen','--key-file',keyPath).status,1);assert.equal(readFileSync(keyPath,'utf8').trim(),material);
  const directory=join(root,'data'),key=readKeyFile(keyPath,directory),store=new SQLiteStore(directory,{initialState:state,encryptionKey:key});store.close();
  const file=join(root,'cli.homeos.enc');assert.equal(cli('backup','--key-file',keyPath,'--data-dir',directory,'--file',file).status,0);
  const target=join(root,'restored');assert.equal(cli('restore','--key-file',keyPath,'--data-dir',target,'--file',file).status,0);
  assert.equal(cli('restore','--key-file',keyPath,'--data-dir',target,'--file',file).status,1);
});
