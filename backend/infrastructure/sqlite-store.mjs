import {DatabaseSync} from 'node:sqlite';
import {existsSync,mkdirSync,readFileSync,copyFileSync,chmodSync,openSync,closeSync,constants} from 'node:fs';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

const collections={devices:'devices',scenes:'scenes',automations:'automation_rules',sceneRuns:'scene_runs',automationRuns:'automation_runs',accounts:'utility_accounts',expenses:'expenses',events:'events',rules:'legacy_rules'};
const tables=[...Object.values(collections),'device_states','settings','auth_households','auth_users','auth_invitations','provider_devices'];
const parse=row=>JSON.parse(row.payload);
const encode=value=>{const result=JSON.stringify(value);if(result===undefined)throw Error('不可序列化的业务数据');return result;};
export class SQLiteStore {
  constructor(directory,{initialState,normalize=value=>value}={}){
    mkdirSync(directory,{recursive:true,mode:0o700});this.directory=directory;this.filename=join(directory,'home.sqlite');
    closeSync(openSync(this.filename,'a',0o600));chmodSync(this.filename,0o600);
    this.db=new DatabaseSync(this.filename);
    try{
      this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
      const version=this.db.prepare('PRAGMA user_version').get().user_version;if(version>1)throw Error('数据库版本高于当前程序，拒绝降级写入');
      this.transaction(()=>{
        this.db.exec('CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;');
        for(const table of tables)this.db.exec(`CREATE TABLE IF NOT EXISTS ${table} (key TEXT PRIMARY KEY, position INTEGER NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload))) STRICT;`);
        this.db.exec(`CREATE TABLE IF NOT EXISTS device_capabilities(device_id TEXT NOT NULL REFERENCES devices(key) ON DELETE CASCADE, position INTEGER NOT NULL, capability TEXT NOT NULL, PRIMARY KEY(device_id,position));
          CREATE TABLE IF NOT EXISTS scene_actions(scene_id TEXT NOT NULL REFERENCES scenes(key) ON DELETE CASCADE, position INTEGER NOT NULL, device_id TEXT NOT NULL, command TEXT NOT NULL CHECK(json_valid(command)), PRIMARY KEY(scene_id,position));
          CREATE INDEX IF NOT EXISTS scene_runs_status ON scene_runs(json_extract(payload,'$.status'));
          CREATE INDEX IF NOT EXISTS automation_runs_rule ON automation_runs(json_extract(payload,'$.ruleId'));
          PRAGMA user_version=1;`);
        if(!this.meta('initialized')){
          const state=this.legacy('state.json');const auth=this.legacy('auth.json');
          const imported=normalize(state?.value??structuredClone(initialState));
          this.writeState(imported);
          if(auth){const data=auth.value.users?auth.value:{household:{id:randomUUID(),name:'我的家'},users:[auth.value],invitations:[]};this.writeAuth(data);}
          this.setMeta('business_revision','0');this.setMeta('auth_revision','0');
          this.setMeta('initialized',new Date().toISOString());
          this.setMeta('migration',encode({state:state?.backup??null,auth:auth?.backup??null}));
        }
      });
      this.revision=Number(this.meta('business_revision'));this.authRevision=Number(this.meta('auth_revision'));
    }catch(error){this.db.close();throw error;}
  }
  transaction(fn){this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  meta(key){return this.db.prepare('SELECT value FROM metadata WHERE key=?').get(key)?.value;}
  setMeta(key,value){this.db.prepare('INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value);}
  legacy(name){const path=join(this.directory,name);if(!existsSync(path))return;const bytes=readFileSync(path);let value;try{value=JSON.parse(bytes.toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw Error();}catch{throw Error(`旧 ${name} 格式错误，未初始化数据库`);}
    const hash=createHash('sha256').update(bytes).digest('hex');const backup=name+'.pre-sqlite-'+hash.slice(0,12)+'.bak';const target=join(this.directory,backup);
    try{copyFileSync(path,target,constants.COPYFILE_EXCL);}catch(error){if(error.code!=='EEXIST')throw error;if(!readFileSync(target).equals(bytes))throw Error('迁移备份冲突，拒绝覆盖');}chmodSync(target,0o600);return {value,backup};
  }
  rows(table){return this.db.prepare(`SELECT key,payload FROM ${table} ORDER BY position,key`).all();}
  sync(table,entries){const seen=new Set();const upsert=this.db.prepare(`INSERT INTO ${table}(key,position,payload) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET position=excluded.position,payload=excluded.payload WHERE position<>excluded.position OR payload<>excluded.payload`);
    entries.forEach(([key,value],position)=>{if(typeof key!=='string'||!key||seen.has(key))throw Error(`数据主键重复或缺失：${table}`);seen.add(key);upsert.run(key,position,encode(value));});
    const remove=this.db.prepare(`DELETE FROM ${table} WHERE key=?`);for(const row of this.rows(table))if(!seen.has(row.key))remove.run(row.key);
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
    for(const scene of state.scenes){const old=this.db.prepare('SELECT device_id,command FROM scene_actions WHERE scene_id=? ORDER BY position').all(scene.id).map(r=>({deviceId:r.device_id,command:JSON.parse(r.command)}));if(encode(old)!==encode(scene.actions)){this.db.prepare('DELETE FROM scene_actions WHERE scene_id=?').run(scene.id);scene.actions.forEach((a,i)=>action.run(scene.id,i,a.deviceId,encode(a.command)));}}
  }
  loadState(){const state=Object.fromEntries(this.rows('settings').map(r=>[r.key,parse(r)]));for(const [field,table] of Object.entries(collections))state[field]=this.rows(table).map(parse);state.deviceStates=Object.fromEntries(this.rows('device_states').map(r=>[r.key,parse(r)]));
    for(const d of state.devices)d.capabilities=this.db.prepare('SELECT capability FROM device_capabilities WHERE device_id=? ORDER BY position').all(d.id).map(r=>r.capability);
    for(const s of state.scenes)s.actions=this.db.prepare('SELECT device_id,command FROM scene_actions WHERE scene_id=? ORDER BY position').all(s.id).map(r=>({deviceId:r.device_id,command:JSON.parse(r.command)}));return state;
  }
  checkRevision(key,expected){if(Number(this.meta(key))!==expected)throw Object.assign(Error('数据库已被另一进程修改，请重启后重试'),{status:409});}
  saveState(state){this.transaction(()=>{this.checkRevision('business_revision',this.revision);this.writeState(state);this.setMeta('business_revision',String(this.revision+1));});this.revision++;}
  writeAuth(data){const {household,users,invitations,...extra}=data;this.sync('auth_households',[[household.id,{...household,_extra:extra}]]);this.sync('auth_users',users.map(u=>[u.id,u]));this.sync('auth_invitations',invitations.map(i=>[i.hash,i]));}
  loadAuth(){const row=this.rows('auth_households')[0];if(!row)return null;const {_extra,...household}=parse(row);return {..._extra,household,users:this.rows('auth_users').map(parse),invitations:this.rows('auth_invitations').map(parse)};}
  saveAuth(data,{create=false}={}){this.transaction(()=>{if(create&&this.rows('auth_households').length)throw Object.assign(Error('家庭已创建'),{code:'EEXIST'});this.checkRevision('auth_revision',this.authRevision);this.writeAuth(data);this.setMeta('auth_revision',String(this.authRevision+1));});this.authRevision++;}
  loadProviderDevices(){return this.rows('provider_devices').map(parse).map(d=>({...d,state:{...d.state,online:false}}));}
  saveProviderDevices(devices){this.transaction(()=>this.sync('provider_devices',devices.map(d=>[d.id,d])));}
  close(){this.db.close();}
}
