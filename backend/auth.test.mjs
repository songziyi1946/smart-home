import {clientAddressPolicy} from './app/client-address.mjs';
import { deploymentSecurity } from './app/deployment-security.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { scryptSync } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAuth, validateOrigin, authorizeHousehold, filterHouseholdState } from './auth.mjs';

async function fixture(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'smart-home-auth-'));
  const file = join(directory, 'auth.json');
  const app = express();
  if (options.trustProxy) app.set('trust proxy', options.trustProxy);
  let auth = createAuth({ file, ...options });
  app.use(express.json());
  app.use('/api', validateOrigin);
  app.use('/api/auth', (req, res, next) => auth.router(req, res, next));
  app.use('/api', (req, res, next) => auth.requireAuth(req, res, next));
  app.use('/api', authorizeHousehold);
  app.all(['/api/state', '/api/devices/:id', '/api/scenes/:id', '/api/greetings', '/api/accounts'], (_req, res) => res.json({ ok: true }));
  app.all('/api/protected', (_req, res) => res.json({ ok: true }));
  app.use((error, _req, res, _next) => res.status(400).json({ message: error.message }));
  const server = await new Promise((resolve, reject) => { const value = app.listen(0, '127.0.0.1', error => error ? reject(error) : resolve(value)); });
  t.after(() => { server.closeAllConnections(); server.close(); rmSync(directory, { recursive: true, force: true }); });
  const url = 'http://127.0.0.1:' + server.address().port;
  return { file, restart() { auth = createAuth({ file, ...options }); }, async request(path, { method = 'GET', body, cookie, origin, forwardedProto, bootstrapToken, clientIP, forwardedFor } = {}) {
    const response = await fetch(url + '/api' + path, { method, headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}),
      ...(forwardedProto ? { 'X-Forwarded-Proto': forwardedProto } : {}),
      ...(bootstrapToken ? { 'X-Bootstrap-Token': bootstrapToken } : {}),
      ...(clientIP ? {'X-Smart-Home-Client-IP':clientIP} : {}),
      ...(forwardedFor ? {'X-Forwarded-For':forwardedFor} : {}),
    }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie'), cache: response.headers.get('cache-control') };
  } };
}
const account = { username: 'test_admin', password: 'test-password-82!', displayName: '测试管理员', homeName: '测试家庭' };

test('household rename is admin-only, strictly validated and persisted without changing identity', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/auth/household', { method: 'PATCH', body: { name: '新家' } })).status, 401);
  const owner = await f.request('/auth/setup', { method: 'POST', body: account });
  const cookie = owner.cookie.split(';')[0];
  for (const role of ['member', 'guest']) {
    const invite = await f.request('/auth/invitations', { method: 'POST', cookie, body: { role } });
    const person = await f.request('/auth/join', { method: 'POST', body: { ...account, username: 'rename_' + role, code: invite.body.code } });
    assert.equal((await f.request('/auth/household', { method: 'PATCH', cookie: person.cookie.split(';')[0], body: { name: '越权修改' } })).status, 403);
  }
  for (const body of [{ name: '  ' }, { name: 'x'.repeat(41) }, { name: '合法名称', id: 'another-home' }]) {
    assert.equal((await f.request('/auth/household', { method: 'PATCH', cookie, body })).status, 400);
  }
  const renamed = await f.request('/auth/household', { method: 'PATCH', cookie, body: { name: '  爱情小窝  ' } });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.household.name, '爱情小窝');
  assert.equal(renamed.body.household.id, owner.body.household.id);
  assert.equal(renamed.body.user.id, owner.body.user.id);
  assert.equal(renamed.cache, 'no-store');
  f.restart();
  const login = await f.request('/auth/login', { method: 'POST', body: account });
  assert.equal(login.body.household.name, '爱情小窝');
});

test('a failed household rename leaves the authenticated session and stored name unchanged', async t => {
  let stored = null, failWrites = false;
  const repository = {
    load: () => structuredClone(stored),
    create: value => { stored = structuredClone(value); },
    save: value => { if (failWrites) throw Error('fixture write failure'); stored = structuredClone(value); },
  };
  const f = await fixture(t, { repository });
  const owner = await f.request('/auth/setup', { method: 'POST', body: account });
  const cookie = owner.cookie.split(';')[0];
  failWrites = true;
  assert.equal((await f.request('/auth/household', { method: 'PATCH', cookie, body: { name: '未保存的新名称' } })).status, 400);
  assert.equal((await f.request('/auth/session', { cookie })).body.household.name, account.homeName);
  assert.equal(stored.household.name, account.homeName);
});

test('trusted HTTPS proxy issues Secure cookies and preserves origin protection', async t => {
  const f = await fixture(t, { trustProxy: 'loopback' });
  const created = await f.request('/auth/setup', { method: 'POST', body: account, forwardedProto: 'https' });
  assert.equal(created.status, 200);
  assert.match(created.cookie, /; Secure/);
  assert.match(created.cookie, /HttpOnly/);
  const cookie = created.cookie.split(';')[0];
  assert.equal((await f.request('/auth/logout', { method: 'POST', body: {}, cookie, origin: 'https://untrusted.example', forwardedProto: 'https' })).status, 403);
  const logout = await f.request('/auth/logout', { method: 'POST', body: {}, cookie, forwardedProto: 'https' });
  assert.equal(logout.status, 200);
  assert.match(logout.cookie, /; Secure/);
  const local = await fixture(t);
  const direct = await local.request('/auth/setup', { method: 'POST', body: account, forwardedProto: 'https' });
  assert.doesNotMatch(direct.cookie, /; Secure/);
});

test('eight-character passwords support setup, login and invitation joining with length boundaries enforced', async t => {
  const f = await fixture(t);
  const eight = { ...account, password: 'test-8pw' };
  for (const password of ['1234567', 'x'.repeat(33)]) {
    assert.equal((await f.request('/auth/setup', { method: 'POST', body: { ...eight, password } })).status, 400);
  }
  const owner = await f.request('/auth/setup', { method: 'POST', body: eight });
  assert.equal(owner.status, 200);
  for (const password of ['1234567', 'x'.repeat(129)]) {
    assert.equal((await f.request('/auth/login', { method: 'POST', body: { ...eight, password } })).status, 400);
  }
  f.restart();
  const login = await f.request('/auth/login', { method: 'POST', body: eight });
  assert.equal(login.status, 200);
  const invitation = await f.request('/auth/invitations', {
    method: 'POST', cookie: login.cookie.split(';')[0], body: { role: 'member' },
  });
  assert.equal(invitation.status, 201);
  const member = { ...eight, username: 'short_password_member', code: invitation.body.code };
  assert.equal((await f.request('/auth/join', { method: 'POST', body: { ...member, password: '1234567' } })).status, 400);
  assert.equal((await f.request('/auth/join', { method: 'POST', body: { ...member, password: 'x'.repeat(33) } })).status, 400);
  assert.equal((await f.request('/auth/join', { method: 'POST', body: member })).status, 200);
  assert.equal((await f.request('/auth/login', { method: 'POST', body: member })).status, 200);
});

test('32-character setup passwords work and historical longer passwords still authenticate', async t => {
  const f = await fixture(t);
  const maximum = { ...account, password: 'x'.repeat(32) };
  assert.equal((await f.request('/auth/setup', { method: 'POST', body: maximum })).status, 200);
  assert.equal((await f.request('/auth/login', { method: 'POST', body: maximum })).status, 200);
  const historical = { ...account, password: 'x'.repeat(64) };
  const stored = JSON.parse(readFileSync(f.file, 'utf8'));
  stored.users[0].passwordHash = scryptSync(historical.password, stored.users[0].salt, 64).toString('hex');
  writeFileSync(f.file, JSON.stringify(stored), { mode: 0o600 });
  f.restart();
  assert.equal((await f.request('/auth/login', { method: 'POST', body: historical })).status, 200);
});

test('setup, credentials, authenticated access, logout and persisted user', async t => {
  const f = await fixture(t);
  const before = await f.request('/auth/session');
  assert.equal(before.status, 401);
  assert.equal(before.body.setupRequired, true);
  for (const method of ['GET', 'POST', 'PATCH', 'PUT']) {
    assert.equal((await f.request('/protected', { method, ...(method === 'GET' ? {} : { body: {} }) })).status, 401);
  }
  const created = await f.request('/auth/setup', { method: 'POST', body: account });
  assert.equal(created.status, 200);
  assert.equal(created.body.user.displayName, account.displayName);
  assert.equal(created.body.user.role, 'admin');
  assert.equal(created.body.user.passwordHash, undefined);
  assert.equal(created.cache, 'no-store');
  assert.match(created.cookie, /HttpOnly/);
  assert.match(created.cookie, /SameSite=Strict/);
  const cookie = created.cookie.split(';')[0];
  assert.equal((await f.request('/protected', { cookie })).status, 200);
  assert.equal((await f.request('/auth/session', { cookie })).body.user.username, account.username);
  assert.equal((await f.request('/auth/setup', { method: 'POST', body: account })).status, 409);
  assert.equal((await f.request('/auth/login', { method: 'POST', body: { ...account, password: 'wrong-password-82' } })).status, 401);
  assert.equal((await f.request('/auth/login', { method: 'POST', body: { ...account, username: 'someone_else' } })).status, 401);
  assert.equal((await f.request('/auth/logout', { method: 'POST', body: {}, cookie })).status, 200);
  assert.equal((await f.request('/protected', { cookie })).status, 401);
  const login = await f.request('/auth/login', { method: 'POST', body: account });
  assert.equal(login.status, 200);
  assert.notEqual(login.cookie.split(';')[0], cookie);
  assert.equal((await f.request('/protected', { cookie: 'smart_home_session=forged' })).status, 401);
  const stored = JSON.parse(readFileSync(f.file, 'utf8'));
  assert.equal(stored.password, undefined);
  assert.equal(readFileSync(f.file, 'utf8').includes(account.password), false);
  assert.equal(stored.users[0].passwordHash.length, 128);
  f.restart();
  assert.equal((await f.request('/protected', { cookie: login.cookie.split(';')[0] })).status, 401);
  assert.equal((await f.request('/auth/session')).body.setupRequired, false);
  assert.equal((await f.request('/auth/login', { method: 'POST', body: account })).status, 200);
});

test('session expires server-side', async t => {
  let time = Date.now();
  const f = await fixture(t, { now: () => time, sessionTTL: 1000 });
  const created = await f.request('/auth/setup', { method: 'POST', body: account });
  const cookie = created.cookie.split(';')[0];
  assert.equal((await f.request('/protected', { cookie })).status, 200);
  time += 1001;
  assert.equal((await f.request('/protected', { cookie })).status, 401);
  assert.equal((await f.request('/auth/session', { cookie })).status, 401);
});

test('rejects weak password, cross-origin requests and limits login attempts', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/auth/setup', { method: 'POST', body: { ...account, password: 'short' } })).status, 400);
  assert.equal((await f.request('/auth/setup', { method: 'POST', body: account, origin: 'https://untrusted.example' })).status, 403);
  const created = await f.request('/auth/setup', { method: 'POST', body: account });
  assert.equal(created.status, 200);
  for (let i = 0; i < 10; i++) {
    assert.equal((await f.request('/auth/login', { method: 'POST', body: { ...account, password: 'wrong-password-82' } })).status, 401);
  }
  assert.equal((await f.request('/auth/login', { method: 'POST', body: account })).status, 429);
});

test('concurrent setup creates only one administrator', async t => {
  const f = await fixture(t);
  const results = await Promise.all([1, 2].map(() => f.request('/auth/setup', { method: 'POST', body: account })));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
});


test('family invitations, member permissions, visitor expiry and member removal', async t => {
  let time = Date.now();
  const f = await fixture(t, { now: () => time });
  const owner = await f.request('/auth/setup', { method: 'POST', body: account });
  const ownerCookie = owner.cookie.split(';')[0];
  assert.equal(owner.body.household.name, account.homeName);
  async function inviteAndJoin(role, username) {
    const invite = await f.request('/auth/invitations', { method: 'POST', cookie: ownerCookie, body: { role, guestHours: 1 } });
    assert.equal(invite.status, 201);
    const body = { ...account, username, code: invite.body.code };
    const joined = await f.request('/auth/join', { method: 'POST', body });
    assert.equal(joined.status, 200);
    assert.equal(joined.body.user.role, role);
    assert.equal(joined.body.household.id, owner.body.household.id);
    assert.equal((await f.request('/auth/join', { method: 'POST', body: { ...body, username: username + '_2' } })).status, 400);
    return { user: joined.body.user, cookie: joined.cookie.split(';')[0] };
  }
  const member = await inviteAndJoin('member', 'family_member');
  const guest = await inviteAndJoin('guest', 'family_guest');
  for (const person of [member, guest]) {
    assert.equal((await f.request('/devices/ceiling', { method: 'PATCH', cookie: person.cookie, body: {} })).status, 200);
    assert.equal((await f.request('/scenes/home', { method: 'POST', cookie: person.cookie, body: {} })).status, 200);
    assert.equal((await f.request('/auth/members', { cookie: person.cookie })).status, 403);
    assert.equal((await f.request('/auth/invitations', { method: 'POST', cookie: person.cookie, body: { role: 'admin' } })).status, 403);
    assert.equal((await f.request('/greetings', { method: 'PUT', cookie: person.cookie, body: {} })).status, 403);
    assert.equal((await f.request('/GREETINGS', { method: 'PUT', cookie: person.cookie, body: {} })).status, 403);
  }
  assert.equal((await f.request('/accounts', { method: 'POST', cookie: member.cookie, body: {} })).status, 200);
  assert.equal((await f.request('/accounts', { method: 'POST', cookie: guest.cookie, body: {} })).status, 403);
  assert.equal((await f.request('/auth/members/' + owner.body.user.id, { method: 'DELETE', cookie: ownerCookie, body: {} })).status, 400);
  assert.equal((await f.request('/auth/members/' + member.user.id, { method: 'DELETE', cookie: ownerCookie, body: {} })).status, 200);
  assert.equal((await f.request('/state', { cookie: member.cookie })).status, 401);
  assert.equal((await f.request('/auth/login', { method: 'POST', body: { ...account, username: 'family_member' } })).status, 401);
  time += 60 * 60 * 1000 + 1;
  assert.equal((await f.request('/state', { cookie: guest.cookie })).status, 401);
  assert.equal((await f.request('/auth/login', { method: 'POST', body: { ...account, username: 'family_guest' } })).status, 401);
});

test('expired invitation cannot create an account', async t => {
  let time = Date.now();
  const f = await fixture(t, { now: () => time });
  const owner = await f.request('/auth/setup', { method: 'POST', body: account });
  const invitation = await f.request('/auth/invitations', { method: 'POST', cookie: owner.cookie.split(';')[0], body: { role: 'member' } });
  time += 15 * 60 * 1000 + 1;
  assert.equal((await f.request('/auth/join', { method: 'POST', body: { ...account, username: 'new_member', code: invitation.body.code } })).status, 400);
});


test('visitor snapshots contain only device data and no family or billing details', () => {
  const privateState = { devices: [{ id: 'light' }], accounts: [{ number: 'private' }], expenses: [1], rules: [1], events: [1], greetings: { self: 'private' }, speaker: 'private', lightOn: true, futurePrivateField: 'private' };
  const result = filterHouseholdState(privateState, { role: 'guest' });
  assert.deepEqual(result.devices, privateState.devices);
  assert.equal(JSON.stringify(result).includes('private'), false);
  assert.equal(result.futurePrivateField, undefined);
  assert.equal(filterHouseholdState(privateState, { role: 'member' }), privateState);
});

test('guest scene visibility includes definitions but only their own execution records',()=>{
 const state={devices:[],scenes:[{id:'public',name:'阅读',actions:[]}],sceneRuns:[{actorId:'owner',name:'private-run'},{actorId:'visitor',name:'my-run'}]};
 const filtered=filterHouseholdState(state,{id:'visitor',role:'guest'});
 assert.equal(filtered.scenes.length,1);assert.equal(filtered.sceneRuns.length,1);assert.equal(filtered.sceneRuns[0].name,'my-run');assert.equal(filtered.sceneRuns[0].actorId,undefined);assert.equal(JSON.stringify(filtered).includes('private-run'),false);
});


test('deployment bootstrap is closed by default, one-time, and preserves existing accounts', async t => {
  const token = 'fixture-only-bootstrap-token-32-characters';
  const closed = await fixture(t, deploymentSecurity({ NODE_ENV: 'production' }));
  assert.equal((await closed.request('/auth/setup', { method: 'POST', body: account })).status, 403);
  const policy = deploymentSecurity({ SMART_HOME_DEPLOYMENT_MODE: 'https', SMART_HOME_BOOTSTRAP_TOKEN: token });
  const f = await fixture(t, policy);
  assert.equal((await f.request('/auth/setup', { method: 'POST', body: account })).status, 403);
  assert.equal((await f.request('/auth/setup', { method: 'POST', body: account, bootstrapToken: 'wrong' })).status, 403);
  const created = await f.request('/auth/setup', { method: 'POST', body: account, bootstrapToken: token });
  assert.equal(created.status, 200);
  assert.match(created.cookie, /; Secure/);
  assert.equal((await f.request('/auth/setup', { method: 'POST', body: account, bootstrapToken: token })).status, 409);
  // The token authorizes only initial creation; it never authenticates business requests.
  assert.equal((await f.request('/protected', { bootstrapToken: token })).status, 401);
  f.restart();
  const login = await f.request('/auth/login', { method: 'POST', body: account });
  assert.equal(login.status, 200);
  assert.match(login.cookie, /; Secure/);
  const logout = await f.request('/auth/logout', { method: 'POST', body: {}, cookie: login.cookie.split(';')[0] });
  assert.match(logout.cookie, /; Secure/);
  const local = await fixture(t, deploymentSecurity({}));
  const localSetup = await local.request('/auth/setup', { method: 'POST', body: account });
  assert.equal(localSetup.status, 200);
  assert.doesNotMatch(localSetup.cookie, /; Secure/);
});

test('local setup requires local peer and local Host, independent of forwarded values', () => {
  const policy = deploymentSecurity({});
  const req = (peer, hostname) => ({ socket: { remoteAddress: peer }, hostname, get: () => undefined });
  assert.equal(policy.allowSetup(req('127.0.0.1', 'localhost')), true);
  assert.equal(policy.allowSetup(req('127.0.0.1', 'public.example')), false);
  assert.equal(policy.allowSetup(req('192.0.2.1', 'localhost')), false);
  assert.equal(deploymentSecurity({ NODE_ENV: 'production' }).allowSetup(req('127.0.0.1', 'localhost')), false);
  assert.throws(() => deploymentSecurity({ SMART_HOME_DEPLOYMENT_MODE: 'typo' }));
  assert.throws(() => deploymentSecurity({ SMART_HOME_BOOTSTRAP_TOKEN: 'short' }));
});


test('trusted Caddy sources have separate login quotas and spoofed X-Forwarded-For cannot reset them', async t => {
  let time = Date.now();
  const f = await fixture(t, {now:()=>time,clientAddress:clientAddressPolicy({SMART_HOME_TRUSTED_PROXY_IP:'127.0.0.1'})});
  assert.equal((await f.request('/auth/setup',{method:'POST',body:account,clientIP:'198.51.100.10'})).status,200);
  for(let i=0;i<10;i++)assert.equal((await f.request('/auth/login',{method:'POST',body:{...account,password:'wrong-password'},clientIP:'198.51.100.10',forwardedFor:`203.0.113.${i}`})).status,401);
  assert.equal((await f.request('/auth/login',{method:'POST',body:account,clientIP:'198.51.100.10'})).status,429);
  assert.equal((await f.request('/auth/login',{method:'POST',body:account,clientIP:'198.51.100.11'})).status,200);
  // Another client's success cannot clear the attacking source's quota.
  assert.equal((await f.request('/auth/login',{method:'POST',body:account,clientIP:'198.51.100.10'})).status,429);
  assert.equal((await f.request('/auth/login',{method:'POST',body:account})).status,400);
  assert.equal((await f.request('/auth/login',{method:'POST',body:account,clientIP:'198.51.100.1, 203.0.113.1'})).status,400);
  time+=15*60*1000+1;
  assert.equal((await f.request('/auth/login',{method:'POST',body:account,clientIP:'198.51.100.10'})).status,200);
});

test('untrusted peers cannot rotate login quotas with a spoofed client address', async t => {
  const f=await fixture(t,{clientAddress:clientAddressPolicy({SMART_HOME_TRUSTED_PROXY_IP:'192.0.2.3'})});
  assert.equal((await f.request('/auth/setup',{method:'POST',body:account})).status,200);
  for(let i=0;i<10;i++)assert.equal((await f.request('/auth/login',{method:'POST',body:{...account,password:'wrong-password'},clientIP:`198.51.100.${i}`,forwardedFor:`198.51.100.${i}`})).status,401);
  assert.equal((await f.request('/auth/login',{method:'POST',body:account,clientIP:'203.0.113.10'})).status,429);
});
