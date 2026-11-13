import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAuth, validateOrigin, authorizeHousehold, filterHouseholdState } from './auth.mjs';

async function fixture(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'smart-home-auth-'));
  const file = join(directory, 'auth.json');
  const app = express();
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
  return { file, restart() { auth = createAuth({ file, ...options }); }, async request(path, { method = 'GET', body, cookie, origin } = {}) {
    const response = await fetch(url + '/api' + path, { method, headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}),
    }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie'), cache: response.headers.get('cache-control') };
  } };
}
const account = { username: 'test_admin', password: 'test-password-82!', displayName: '测试管理员', homeName: '测试家庭' };

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
