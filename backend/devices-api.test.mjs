import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { legacySeedDevices } from './providers/mock/seed.mjs';

async function launch(directory) {
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('.', import.meta.url),
    env: { ...process.env, SMART_HOME_DATA_DIR: directory, SMART_HOME_API_PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('API startup timeout')); }, 10000);
    child.stdout.on('data', chunk => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
    child.stderr.on('data', chunk => { output += chunk; });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('API exited: ' + output)); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
  });
  return { url, async stop() { if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; } } };
}

test('real HTTP device routes preserve auth, validation, snapshots and persistence across restart', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'smart-home-devices-'));
  let server;
  t.after(async () => { await server?.stop(); rmSync(directory, { recursive: true, force: true }); rmSync(directory+'.key',{force:true}); });
  const statePath = join(directory, 'state.json');
  writeFileSync(statePath, JSON.stringify({ devices: legacySeedDevices, accounts: [], expenses: [], rules: [], events: [], greetings: {}, speaker: '', lightOn: false }));
  server = await launch(directory);
  let cookie;
  async function request(path, method = 'GET', body, session = cookie) {
    const response = await fetch(server.url + '/api' + path, { method, headers: {
      'Content-Type': 'application/json', ...(session ? { Cookie: session } : {}),
    }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  assert.equal((await request('/state')).status, 401);
  assert.equal((await request('/devices/ceiling', 'PATCH', { capability: 'power', value: false })).status, 401);
  const credentials = { username: 'device_admin', password: 'device-test-password', displayName: '测试', homeName: '家庭' };
  cookie = (await request('/auth/setup', 'POST', credentials)).cookie;
  const initial = await request('/state');
  const headers = (await fetch(server.url + '/api/state')).headers;
  assert.equal(headers.get('x-frame-options'), 'DENY');
  assert.equal(headers.get('x-content-type-options'), 'nosniff');
  assert.equal(headers.get('referrer-policy'), 'no-referrer');
  assert.match(headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(headers.get('x-powered-by'), null);
  assert.equal(initial.body.devices.length, 9);
  assert.equal(initial.body.deviceStates, undefined);
  assert.deepEqual(initial.body.devices[0].state.values, { power: true, brightness: 80 });
  for (const [id, command, key, value] of [
    ['ceiling', { capability: 'power', value: false }, 'power', false],
    ['ceiling', { action: 'level', value: 42 }, 'brightness', 42],
    ['ac', { capability: 'power', value: true }, 'power', true],
    ['curtain', { capability: 'position', value: 'stop' }, 'position', 'stop'],
    ['robot', { capability: 'cleaning', value: true }, 'cleaning', true],
  ]) {
    const result = await request('/devices/' + id, 'PATCH', command);
    assert.equal(result.status, 200);
    assert.equal(result.body.devices.find(d => d.id === id).state.values[key], value);
  }
  const storedBusiness=()=>{const db=new DatabaseSync(join(directory,'home.sqlite'),{readOnly:true});try{return db.prepare("SELECT value FROM metadata WHERE key='business_revision'").get().value;}finally{db.close();}};
  const saved = storedBusiness();
  for (const [id, command, status] of [
    ['ac', { capability: 'brightness', value: 50 }, 400],
    ['ceiling', { capability: 'brightness', value: 101 }, 400],
    ['missing', { capability: 'power', value: false }, 404],
  ]) assert.equal((await request('/devices/' + id, 'PATCH', command)).status, status);
  assert.equal(storedBusiness(), saved);
  const invitation = await request('/auth/invitations', 'POST', { role: 'guest', guestHours: 1 });
  const guest = await request('/auth/join', 'POST', { ...credentials, username: 'device_guest', code: invitation.body.code }, '');
  const guestResult = await request('/devices/ac', 'PATCH', { capability: 'power', value: false }, guest.cookie);
  assert.equal(guestResult.status, 200);
  assert.deepEqual(guestResult.body.accounts, []);
  assert.equal(guestResult.body.deviceStates, undefined);
  assert.equal((await request('/accounts', 'POST', {}, guest.cookie)).status, 403);
  const sceneBody={name:'阅读',description:'测试自定义场景',actions:[{deviceId:'ceiling',command:{capability:'brightness',value:35}}]};
  assert.equal((await request('/scenes','POST',sceneBody,guest.cookie)).status,403);
  const memberInvite=await request('/auth/invitations','POST',{role:'member',guestHours:1});
  const member=await request('/auth/join','POST',{...credentials,username:'scene_member',code:memberInvite.body.code},'');
  assert.equal((await request('/scenes','POST',sceneBody,member.cookie)).status,403);
  for (const path of ['/scenes/', '/SCENES/']) {
    for (const person of [member, guest]) {
      assert.equal((await request(path,'POST',sceneBody,person.cookie)).status,403);
    }
  }
  const createdScene=await request('/scenes/','POST',sceneBody);
  assert.equal(createdScene.status,201);
  const custom=createdScene.body.scenes.find(s=>s.name==='阅读');
  assert.equal((await request('/scenes/'+custom.id,'PUT',{...sceneBody,version:1},guest.cookie)).status,403);
  assert.equal((await request('/scenes/'+custom.id,'DELETE',{},guest.cookie)).status,403);
  assert.equal((await request('/scenes','POST',{...sceneBody,actions:[{deviceId:'ac',command:{capability:'brightness',value:50}}]})).status,400);
  assert.equal((await request('/scenes/'+custom.id,'POST',{},member.cookie)).body.run.status,'completed');
  const ruleBody={schemaVersion:1,name:'测试自动化',enabled:false,trigger:{type:'device_state_changed',deviceId:'ceiling',capability:'power',from:false,to:true},condition:{type:'time_window',start:'22:00',end:'06:30',timeZone:'Asia/Shanghai'},action:{type:'run_scene',sceneId:custom.id},executionPolicy:{mode:'single',cooldownSeconds:30}};
  assert.equal((await request('/automations','POST',ruleBody,member.cookie)).status,403);
  assert.equal((await request('/automations/preview','POST',{rule:ruleBody,event:{from:false,to:true}},guest.cookie)).status,403);
  const auto=await request('/automations','POST',ruleBody);assert.equal(auto.status,201);const ruleId=auto.body.automations[0].id;
  const beforePreview=storedBusiness();const preview=await request('/automations/preview','POST',{rule:{...ruleBody,enabled:true},event:{from:false,to:true},at:'2026-11-16T23:30:00+08:00'});assert.equal(preview.body.wouldRun,true);assert.equal(storedBusiness(),beforePreview);
  assert.equal((await request('/automations/'+ruleId,'PATCH',{enabled:true},member.cookie)).status,403);
  assert.equal((await request('/automations/'+ruleId,'PUT',{...ruleBody,version:1},guest.cookie)).status,403);
  assert.equal((await request('/automations/'+ruleId,'DELETE',{},member.cookie)).status,403);
  assert.deepEqual((await request('/state','GET',undefined,guest.cookie)).body.automations,[]);
  assert.equal((await request('/automations/'+ruleId,'DELETE',{})).status,200);
  const executed=await request('/scenes/'+custom.id,'POST',{},guest.cookie);
  assert.equal(executed.body.run.status,'completed');
  const updated=await request('/scenes/'+custom.id,'PUT',{...sceneBody,name:'阅读新版',version:1});assert.equal(updated.status,200);
  assert.equal((await request('/scenes/'+custom.id,'PUT',{...sceneBody,version:1})).status,409);
  const db=new DatabaseSync(join(directory,'home.sqlite'),{readOnly:true});assert.equal(db.prepare('SELECT payload FROM scenes WHERE key=?').get(custom.id).payload.includes('阅读新版'),false);db.close();
  const retainedRule=await request('/automations','POST',ruleBody);assert.equal(retainedRule.status,201);
  await server.stop();
  server = await launch(directory);
  cookie = (await request('/auth/login', 'POST', credentials)).cookie;
  assert.equal((await request('/state')).body.devices.find(d => d.id === 'ceiling').state.values.brightness, 35);
  assert.ok((await request('/state')).body.scenes.some(s=>s.id===custom.id && s.name==='阅读新版'));
  assert.equal((await request('/state')).body.automations.length,1);
  assert.ok((await request('/state')).body.sceneRuns.some(r=>r.sceneId===custom.id));
  assert.equal(existsSync(statePath),false,'legacy plaintext removed after encrypted import');
  assert.ok(readdirSync(directory).some(name=>name.endsWith('.bak.enc')));
  assert.equal((await request('/scenes/'+custom.id,'DELETE',{})).status,200);
  assert.equal((await request('/scenes/'+custom.id,'POST',{})).status,404);
  for (const scene of ['home', 'away', 'sleep']) assert.equal((await request('/scenes/' + scene, 'POST')).status, 200);
});
