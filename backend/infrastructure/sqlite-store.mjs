import {createEncryption,writeProtected,syncDirectory} from './encryption.mjs';
import {DatabaseSync} from 'node:sqlite';
import {existsSync,mkdirSync,readFileSync,chmodSync,openSync,closeSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

const collections={devices:'devices',scenes:'scenes',automations:'automation_rules',sceneRuns:'scene_runs',automationRuns:'automation_runs',accounts:'utility_accounts',expenses:'expenses',events:'events',rules:'legacy_rules'};
const tables=[...Object.values(collections),'device_states','settings','auth_households','auth_users','auth_invitations','provider_devices'];
const encode=value=>{const result=JSON.stringify(value);if(result===undefined)throw Error('不可序列化的业务数据');return result;};
export class SQLiteStore {
  constructor(directory,{initialState,normalize=value=>value,encryptionKey}={}){
    this.encryption=createEncryption(encryptionKey);
    mkdirSync(directory,{recursive:true,mode:0o700});chmodSync(directory,0o700);this.directory=directory;this.filename=join(directory,'home.sqlite');
    closeSync(openSync(this.filename,'a',0o600));chmodSync(this.filename,0o600);
    this.db=new DatabaseSync(this.filename);
    try{
      const version=this.db.prepare('PRAGMA user_version').get().user_version;if(version>2)throw Error('数据库版本高于当前程序，拒绝降级写入');
      if(version===1)throw Error('旧数据库未加密，请停服后运行 maintenance.mjs migrate');
      if(version===2 && this.encryption.open(this.meta('key_check'),'key-check').toString()!=='home-os-storage-v2')throw Error('数据密钥不匹配');
      this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON; PRAGMA temp_store=MEMORY;');
      this.transaction(()=>{
        this.db.exec('CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;');
        for(const table of tables)this.db.exec(`CREATE TABLE IF NOT EXISTS ${table} (key TEXT PRIMARY KEY, position INTEGER NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload))) STRICT;`);
        this.db.exec(`CREATE TABLE IF NOT EXISTS space_model_catalog (key TEXT PRIMARY KEY, payload TEXT NOT NULL CHECK(json_valid(payload))) STRICT;
          CREATE TABLE IF NOT EXISTS space_model_assets (id TEXT PRIMARY KEY, model_id TEXT NOT NULL, size INTEGER NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload))) STRICT;`);
        this.db.exec(`CREATE TABLE IF NOT EXISTS model_generation_records (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, kind TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload))) STRICT;
          CREATE TABLE IF NOT EXISTS model_generation_assets (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, source_id TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload))) STRICT;`);
        this.db.exec(`CREATE TABLE IF NOT EXISTS device_capabilities(device_id TEXT NOT NULL REFERENCES devices(key) ON DELETE CASCADE, position INTEGER NOT NULL, capability TEXT NOT NULL, PRIMARY KEY(device_id,position));
          CREATE TABLE IF NOT EXISTS scene_actions(scene_id TEXT NOT NULL REFERENCES scenes(key) ON DELETE CASCADE, position INTEGER NOT NULL, device_id TEXT NOT NULL, command TEXT NOT NULL CHECK(json_valid(command)), PRIMARY KEY(scene_id,position));
          PRAGMA user_version=2;`);
        if(!this.meta('key_check'))this.setMeta('key_check',this.encryption.seal(Buffer.from('home-os-storage-v2'),'key-check'));
        if(!this.meta('initialized')){
          const state=this.legacy('state.json');const auth=this.legacy('auth.json');
          const imported=normalize(state?.value??structuredClone(initialState));
          this.writeState(imported);
          if(auth){const data=auth.value.users?auth.value:{household:{id:randomUUID(),name:'我的家'},users:[auth.value],invitations:[]};this.writeAuth(data);}
          this.setMeta('business_revision','0');this.setMeta('auth_revision','0');
          this.setMeta('initialized',new Date().toISOString());
          this.setMeta('migration',this.encryption.seal(Buffer.from(encode({state:state?(({value,...entry})=>entry)(state):null,auth:auth?(({value,...entry})=>entry)(auth):null})),'migration-manifest'));
        }
      });
      this.cleanLegacy();
      this.revision=Number(this.meta('business_revision'));this.authRevision=Number(this.meta('auth_revision'));
    }catch(error){this.db.close();throw error;}
  }
  transaction(fn){this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  loadModelLibrary() {
    const row = this.db.prepare("SELECT payload FROM space_model_catalog WHERE key='library'").get();
    return row ? JSON.parse(this.encryption.open(row.payload, 'space-model:library')) : null;
  }
  exportGenerationData() { return {records:this.db.prepare('SELECT * FROM model_generation_records ORDER BY id').all().map(row=>({...row})),assets:this.db.prepare('SELECT * FROM model_generation_assets ORDER BY id').all().map(row=>({...row}))}; }
  restoreGenerationData(data) {
    this.transaction(()=>{
      if(this.db.prepare('SELECT count(*) AS n FROM model_generation_records').get().n||this.db.prepare('SELECT count(*) AS n FROM model_generation_assets').get().n)throw Error('生成数据恢复目标必须为空');
      for(const row of data.records)this.db.prepare('INSERT INTO model_generation_records(id,owner_id,kind,revision,payload) VALUES(?,?,?,?,?)').run(row.id,row.owner_id,row.kind,row.revision,row.payload);
      for(const row of data.assets)this.db.prepare('INSERT INTO model_generation_assets(id,owner_id,source_id,mime,size,payload) VALUES(?,?,?,?,?,?)').run(row.id,row.owner_id,row.source_id,row.mime,row.size,row.payload);
    });
  }
  modelAssetInfo(id) { return this.db.prepare('SELECT model_id AS modelId,size FROM space_model_assets WHERE id=?').get(id); }
  loadModelAsset(id) {
    const row = this.db.prepare('SELECT model_id,payload FROM space_model_assets WHERE id=?').get(id);
    return row ? this.encryption.open(row.payload, `space-model:asset:${id}:${row.model_id}`) : null;
  }
  saveModelLibrary(library, expectedRevision, asset) {
    this.transaction(() => {
      if ((this.loadModelLibrary()?.revision ?? 0) !== expectedRevision) throw Object.assign(Error('模型已被修改，请刷新后重试'), { status: 409 });
      if (asset) {
        const used = this.db.prepare('SELECT coalesce(sum(size),0) AS bytes FROM space_model_assets').get().bytes;
        // Keep encrypted JSON backup envelopes within Node's maximum string size.
        if (used + asset.bytes.length > 100 * 1024 * 1024) throw Object.assign(Error('模型资源已达到 100 MB 上限'), { status: 413 });
        this.db.prepare('INSERT INTO space_model_assets(id,model_id,size,payload) VALUES(?,?,?,?)').run(asset.id, asset.modelId, asset.bytes.length, this.encryption.seal(asset.bytes, `space-model:asset:${asset.id}:${asset.modelId}`));
      }
      this.db.prepare("INSERT INTO space_model_catalog(key,payload) VALUES('library',?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload").run(this.encryption.seal(Buffer.from(encode(library)), 'space-model:library'));
    });
  }
  exportModelData() {
    return { library: this.loadModelLibrary(), assets: this.db.prepare('SELECT id,model_id FROM space_model_assets ORDER BY id').all().map(row => ({ id: row.id, modelId: row.model_id, bytesBase64: this.loadModelAsset(row.id).toString('base64') })) };
  }
  restoreModelData(data) {
    this.transaction(() => {
      if (this.loadModelLibrary() || this.db.prepare('SELECT count(*) AS n FROM space_model_assets').get().n) throw Error('模型恢复目标必须为空');
      if (data.library) this.db.prepare("INSERT INTO space_model_catalog(key,payload) VALUES('library',?)").run(this.encryption.seal(Buffer.from(encode(data.library)), 'space-model:library'));
      for (const asset of data.assets) {
        const bytes = Buffer.from(asset.bytesBase64, 'base64');
        this.db.prepare('INSERT INTO space_model_assets(id,model_id,size,payload) VALUES(?,?,?,?)').run(asset.id,asset.modelId,bytes.length,this.encryption.seal(bytes, `space-model:asset:${asset.id}:${asset.modelId}`));
      }
    });
  }
  meta(key){return this.db.prepare('SELECT value FROM metadata WHERE key=?').get(key)?.value;}
  setMeta(key,value){this.db.prepare('INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value);}
  legacy(name){
    const path=join(this.directory,name);if(!existsSync(path))return;
    const bytes=readFileSync(path);let value;
    try{value=JSON.parse(bytes.toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw Error();}catch{throw Error(`旧 ${name} 格式错误，未初始化数据库`);}
    const digest=createHash('sha256').update(bytes).digest('hex');
    const backup=name+'.pre-sqlite-'+digest.slice(0,12)+'.bak.enc',target=join(this.directory,backup);
    try{writeProtected(target,this.encryption.seal(bytes,'legacy:'+name));}catch(error){if(error.code!=='EEXIST')throw error;}
    if(!this.encryption.open(readFileSync(target,'utf8'),'legacy:'+name).equals(bytes))throw Error('迁移备份冲突，拒绝覆盖');
    chmodSync(target,0o600);return {value,backup,digest,name};
  }
  cleanLegacy(){
    const migration=JSON.parse(this.encryption.open(this.meta('migration'),'migration-manifest'));
    for(const item of Object.values(migration)){
      if(!item?.name || !['state.json','auth.json'].includes(item.name))continue;
      const path=join(this.directory,item.name);if(!existsSync(path))continue;
      const backup=this.encryption.open(readFileSync(join(this.directory,item.backup),'utf8'),'legacy:'+item.name);
      const bytes=readFileSync(path);
      if(createHash('sha256').update(backup).digest('hex')!==item.digest || !bytes.equals(backup))throw Error('旧文件在迁移后被修改，请先安全归档');
      unlinkSync(path);syncDirectory(this.directory);
    }
  }
  parse(table,row){return JSON.parse(this.encryption.open(row.payload,`${table}:${row.key}`));}
  rows(table){return this.db.prepare(`SELECT key,position,payload FROM ${table} ORDER BY position,key`).all();}
  sync(table,entries){
    const seen=new Set(),existing=new Map(this.rows(table).map(row=>[row.key,row]));
    const upsert=this.db.prepare(`INSERT INTO ${table}(key,position,payload) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET position=excluded.position,payload=excluded.payload`);
    entries.forEach(([key,value],position)=>{
      if(typeof key!=='string'||!key||seen.has(key))throw Error(`数据主键重复或缺失：${table}`);seen.add(key);
      const previous=existing.get(key),plain=encode(value);
      if(previous && previous.position===position && encode(this.parse(table,previous))===plain)return;
      upsert.run(key,position,this.encryption.seal(Buffer.from(plain),`${table}:${key}`));
    });
    const remove=this.db.prepare(`DELETE FROM ${table} WHERE key=?`);for(const key of existing.keys())if(!seen.has(key))remove.run(key);
  }
  writeState(state){
    for(const [field,table] of Object.entries(collections)){
      if(!Array.isArray(state[field]))throw Error(`业务集合格式错误：${field}`);
      this.sync(table,state[field].map(item=>{let value=item;if(field==='devices'){const {capabilities,...rest}=item;value=rest;}if(field==='scenes'){const {actions,...rest}=item;value=rest;}return [item.id,value];}));
    }
    this.sync('device_states',Object.entries(state.deviceStates));
    const extras=Object.entries(state).filter(([key])=>!(key in collections)&&key!=='deviceStates');this.sync('settings',extras);
    const caps=this.db.prepare('INSERT INTO device_capabilities VALUES(?,?,?)');
    for(const device of state.devices){const existing=this.db.prepare('SELECT capability FROM device_capabilities WHERE device_id=? ORDER BY position').all(device.id).map(r=>r.capability);if(encode(existing)!==encode(device.capabilities)){this.db.prepare('DELETE FROM device_capabilities WHERE device_id=?').run(device.id);device.capabilities.forEach((c,i)=>caps.run(device.id,i,c));}}
    const action=this.db.prepare('INSERT INTO scene_actions VALUES(?,?,?,?)');
    for(const scene of state.scenes){const old=this.db.prepare('SELECT device_id,command FROM scene_actions WHERE scene_id=? ORDER BY position').all(scene.id).map((r,i)=>({deviceId:r.device_id,command:JSON.parse(this.encryption.open(r.command,`scene_actions:${scene.id}:${i}`))}));if(encode(old)!==encode(scene.actions)){this.db.prepare('DELETE FROM scene_actions WHERE scene_id=?').run(scene.id);scene.actions.forEach((a,i)=>action.run(scene.id,i,a.deviceId,this.encryption.seal(Buffer.from(encode(a.command)),`scene_actions:${scene.id}:${i}`)));}}
  }
  loadState(){const state=Object.fromEntries(this.rows('settings').map(r=>[r.key,this.parse('settings',r)]));for(const [field,table] of Object.entries(collections))state[field]=this.rows(table).map(r=>this.parse(table,r));state.deviceStates=Object.fromEntries(this.rows('device_states').map(r=>[r.key,this.parse('device_states',r)]));
    for(const d of state.devices)d.capabilities=this.db.prepare('SELECT capability FROM device_capabilities WHERE device_id=? ORDER BY position').all(d.id).map(r=>r.capability);
    for(const s of state.scenes)s.actions=this.db.prepare('SELECT device_id,command FROM scene_actions WHERE scene_id=? ORDER BY position').all(s.id).map((r,i)=>({deviceId:r.device_id,command:JSON.parse(this.encryption.open(r.command,`scene_actions:${s.id}:${i}`))}));return state;
  }
  checkRevision(key,expected){if(Number(this.meta(key))!==expected)throw Object.assign(Error('数据库已被另一进程修改，请重启后重试'),{status:409});}
  saveState(state){this.transaction(()=>{this.checkRevision('business_revision',this.revision);this.writeState(state);this.setMeta('business_revision',String(this.revision+1));});this.revision++;}
  writeAuth(data){const {household,users,invitations,...extra}=data;this.sync('auth_households',[[household.id,{...household,_extra:extra}]]);this.sync('auth_users',users.map(u=>[u.id,u]));this.sync('auth_invitations',invitations.map(i=>[i.hash,i]));}
  loadAuth(){const row=this.rows('auth_households')[0];if(!row)return null;const {_extra,...household}=this.parse('auth_households',row);return {..._extra,household,users:this.rows('auth_users').map(r=>this.parse('auth_users',r)),invitations:this.rows('auth_invitations').map(r=>this.parse('auth_invitations',r))};}
  saveAuth(data,{create=false}={}){this.transaction(()=>{if(create&&this.rows('auth_households').length)throw Object.assign(Error('家庭已创建'),{code:'EEXIST'});this.checkRevision('auth_revision',this.authRevision);this.writeAuth(data);this.setMeta('auth_revision',String(this.authRevision+1));});this.authRevision++;}
  loadProviderDevices(){return this.rows('provider_devices').map(r=>this.parse('provider_devices',r)).map(d=>({...d,state:{...d.state,online:false}}));}
  saveProviderDevices(devices){this.transaction(()=>this.sync('provider_devices',devices.map(d=>[d.id,d])));}
  close(){this.db.close();}
}
