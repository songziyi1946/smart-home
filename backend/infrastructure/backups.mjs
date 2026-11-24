import { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SQLiteStore } from './sqlite-store.mjs';
import { createEncryption, writeProtected, syncDirectory } from './encryption.mjs';
import { acquireDataLock } from './data-lock.mjs';

const format = 'home-os-backup-v1';
const context = 'home-os:backup:v1';
const collectionTables = { devices:'devices', scenes:'scenes', automations:'automation_rules', sceneRuns:'scene_runs', automationRuns:'automation_runs', accounts:'utility_accounts', expenses:'expenses', events:'events', rules:'legacy_rules' };
function plainSnapshot(filename) {
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    if (db.prepare('PRAGMA user_version').get().user_version !== 1) throw Error('迁移仅接受 schema v1 的未加密数据库');
    const rows = table => db.prepare(`SELECT key,payload FROM ${table} ORDER BY position,key`).all();
    const parse = row => JSON.parse(row.payload);
    const state = Object.fromEntries(rows('settings').map(r => [r.key, parse(r)]));
    for (const [field, table] of Object.entries(collectionTables)) state[field] = rows(table).map(parse);
    state.deviceStates = Object.fromEntries(rows('device_states').map(r => [r.key, parse(r)]));
    for (const device of state.devices) device.capabilities = db.prepare('SELECT capability FROM device_capabilities WHERE device_id=? ORDER BY position').all(device.id).map(r => r.capability);
    for (const scene of state.scenes) scene.actions = db.prepare('SELECT device_id,command FROM scene_actions WHERE scene_id=? ORDER BY position').all(scene.id).map(r => ({deviceId:r.device_id,command:JSON.parse(r.command)}));
    const row = rows('auth_households')[0];
    let auth = null;
    if (row) { const {_extra,...household} = parse(row); auth = {..._extra,household,users:rows('auth_users').map(parse),invitations:rows('auth_invitations').map(parse)}; }
    return { state, auth, providers: rows('provider_devices').map(parse) };
  } finally { db.close(); }
}
function snapshot(store) {
  return store.transaction(() => {
    const models = store.exportModelData();
    const generation = store.exportGenerationData();
    return {state:store.loadState(),auth:store.loadAuth(),providers:store.rows('provider_devices').map(r=>store.parse('provider_devices',r)), ...(models.library ? {models} : {}), ...(generation.records.length||generation.assets.length ? {generation} : {})};
  });
}
function archive(encryptionKey, data, path) {
  const encryption = createEncryption(encryptionKey);
  const plain = Buffer.from(JSON.stringify({format,...data}));
  writeProtected(path, encryption.seal(plain, context));
  if (!encryption.open(readFileSync(path, 'utf8'), context).equals(plain)) throw Error('加密备份校验失败');
}
export function readBackup(path, encryptionKey) {
  const value = JSON.parse(createEncryption(encryptionKey).open(readFileSync(path, 'utf8'), context));
  if (value.format !== format || !value.state || !Array.isArray(value.providers) || !('auth' in value)) throw Error('备份格式不受支持');
  return value;
}
function restoreContents(directory, value, encryptionKey) {
  const store = new SQLiteStore(directory, { initialState:value.state, encryptionKey });
  try {
    if (value.auth) store.saveAuth(value.auth, {create:true});
    store.saveProviderDevices(value.providers);
    if (value.models) store.restoreModelData(value.models);
    if (value.generation) store.restoreGenerationData(value.generation);
    const expected = {state:value.state,auth:value.auth,providers:value.providers,...(value.models ? {models:value.models} : {}),...(value.generation ? {generation:value.generation} : {})};
    if (!isDeepStrictEqual(snapshot(store),expected)) throw Error('恢复数据校验失败');
  } finally { store.close(); }
}
export function createBackup(directory, output, encryptionKey) {
  if(!existsSync(join(directory,'home.sqlite')))throw Error('备份源不存在');
  const release = acquireDataLock(directory);
  let store;
  try {
    store = new SQLiteStore(directory,{encryptionKey});
    archive(encryptionKey, snapshot(store), output);
  } finally { store?.close(); release(); }
}
export function restoreBackup(input, directory, encryptionKey) {
  const value = readBackup(input, encryptionKey); // Authenticate before creating anything.
  mkdirSync(directory,{mode:0o700}); // Deliberately refuses an existing destination.
  const release = acquireDataLock(directory);
  let complete=false;
  try { restoreContents(directory,value,encryptionKey);complete=true; }
  finally { release();if(!complete)rmSync(directory,{recursive:true,force:true}); }
}
export function migrateDatabase(directory, backupPath, encryptionKey) {
  directory=resolve(directory);
  const release=acquireDataLock(directory);
  let stage;
  try {
    for(const suffix of ['-wal','-shm','-journal']) if(existsSync(join(directory,'home.sqlite'+suffix))) throw Error('检测到 SQLite 活动文件，请先停止旧服务并完成 checkpoint');
    const source=join(directory,'home.sqlite');
    const value=plainSnapshot(source);
    const sourceFiles={};
    for(const name of readdirSync(directory)) if(name==='home.sqlite'||['state.json','auth.json','state.json.tmp','auth.json.tmp'].includes(name)||/^(state|auth)\.json\.pre-sqlite-.*\.bak$/.test(name)) sourceFiles[name]=readFileSync(join(directory,name)).toString('base64');
    archive(encryptionKey,{...value,sourceFiles},backupPath);
    // Stay on the /data bind mount: its parent may be read-only or another filesystem.
    stage=mkdtempSync(join(directory,'.home-encrypted-'));chmodSync(stage,0o700);
    restoreContents(stage,value,encryptionKey);
    // Refuse changed input and checkpointed old services which started during preparation.
    for(const [name,bytes] of Object.entries(sourceFiles)) if(!readFileSync(join(directory,name)).equals(Buffer.from(bytes,'base64'))) throw Error('迁移源已改变，未替换数据库');
    for(const suffix of ['-wal','-shm','-journal']) if(existsSync(source+suffix)) throw Error('迁移期间数据库被打开，未替换');
    // Plaintext migration artifacts have authenticated copies in the encrypted archive.
    // Remove these before replacement: a crash after rename cannot strand old plaintext backups.
    for(const name of Object.keys(sourceFiles)) if(name!=='home.sqlite') unlinkSync(join(directory,name));
    syncDirectory(directory);
    renameSync(join(stage,'home.sqlite'),source);
    syncDirectory(directory);
    chmodSync(directory,0o700);
    return { backup:backupPath };
  } finally { if(stage)rmSync(stage,{recursive:true,force:true});release(); }
}
