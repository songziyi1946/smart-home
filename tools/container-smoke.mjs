import assert from 'node:assert/strict';
import { execFile as exec } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';

const execFile = promisify(exec);
const image = process.argv[2] || 'smart-home:security-check';
const expectedNode = 'v' + readFileSync(new URL('../.nvmrc', import.meta.url), 'utf8').trim();
const name = 'smart-home-smoke-' + randomUUID();
const docker = (...args) => execFile('docker', args, { timeout: 30000, maxBuffer: 1024 * 1024 });
// All credentials are disposable fixtures, with no network or host data mounted.
const bootstrap = 'container-smoke-fixture-bootstrap-only';
const start = `
import {writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
writeFileSync('/run/keys/data.key',randomBytes(32).toString('hex'),{mode:0o600,flag:'wx'});
await import('./backend/server.mjs');
`;
const probe = `
import assert from 'node:assert/strict';
import {existsSync,readFileSync,readdirSync,statSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
assert.notEqual(process.getuid(),0);
assert.equal(process.version,${JSON.stringify(expectedNode)});
assert.ok(process.report.getReport().header.glibcVersionRuntime,'expected the tested glibc runtime');
for(const path of ['/usr/local/bin/npm','/usr/local/bin/npx','/usr/local/bin/yarn','/usr/local/bin/corepack','/usr/local/lib/node_modules/npm','/usr/bin/npm','/usr/bin/npx','/usr/bin/yarn','/usr/bin/corepack','/usr/lib/node_modules/npm','/sbin/apk','/usr/bin/apk'])assert.equal(existsSync(path),false,path);
const base='http://127.0.0.1:3101';
const page=await fetch(base);assert.equal(page.status,200);assert.match(await page.text(),/<div id="root">/);
assert.equal((await fetch(base+'/api/state')).status,401);
const session=await fetch(base+'/api/auth/session');assert.equal(session.status,401);assert.equal((await session.json()).setupRequired,true);
const account={username:'container_smoke_admin',displayName:'Container fixture',homeName:'Container fixture',password:'disposable-smoke-password'};
const setup=(headers={})=>fetch(base+'/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(account)});
assert.equal((await setup()).status,403);
const created=await setup({'X-Bootstrap-Token':process.env.SMART_HOME_BOOTSTRAP_TOKEN});assert.equal(created.status,200);
const cookie=created.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);assert.match(cookie,/SameSite=Strict/);
const snapshot=await fetch(base+'/api/state',{headers:{Cookie:cookie.split(';')[0]}});assert.equal(snapshot.status,200);
assert.ok(Array.isArray((await snapshot.json()).devices));
assert.equal((await setup({'Origin':'https://untrusted.invalid'})).status,403);
const db=new DatabaseSync('/data/home.sqlite',{readOnly:true});
assert.equal(db.prepare('PRAGMA user_version').get().user_version,2);
assert.equal(db.prepare('SELECT payload FROM auth_users').get().payload.includes(account.username),false);db.close();
assert.equal(statSync('/data').mode&0o777,0o700);
for(const path of readdirSync('/data'))if(path.startsWith('home.sqlite'))assert.equal(readFileSync('/data/'+path).includes(Buffer.from(account.username)),false);
console.log('PASS: nonroot runtime, static page, SQLite encryption, setup authorization and Secure session; package managers absent');
`;
try {
  await docker('run','--detach','--name',name,'--network','none','--read-only',
    '--tmpfs','/data:rw,noexec,nosuid,uid=1000,gid=1000,mode=0700',
    '--tmpfs','/run/keys:rw,noexec,nosuid,uid=1000,gid=1000,mode=0700',
    '--env','SMART_HOME_DATA_KEY_FILE=/run/keys/data.key',
    '--env','SMART_HOME_BOOTSTRAP_TOKEN='+bootstrap,image,'node','--input-type=module','-e',start);
  let ready=false;
  for(let attempt=0;attempt<20;attempt++){
    try{await docker('exec',name,'node','-e',"fetch('http://127.0.0.1:3101/api/auth/session').then(r=>process.exit(r.status===401?0:1)).catch(()=>process.exit(1))");ready=true;break;}
    catch{await new Promise(resolve=>setTimeout(resolve,250));}
  }
  assert.equal(ready,true,'container did not become ready');
  const result=await docker('exec',name,'node','--input-type=module','-e',probe);
  process.stdout.write(result.stdout);
} finally { await docker('rm','--force',name).catch(()=>{}); }
