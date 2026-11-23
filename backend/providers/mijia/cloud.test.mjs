import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CloudError, MijiaCloud, encodeCloudRequest, rc4Drop1024 } from './cloud.mjs';

// Test-only credentials, never a real Xiaomi account/session.
const SECRET = Buffer.alloc(16, 7).toString('base64');
const CREDS = { userId: '700', serviceToken: 'fixture-service', ssecurity: SECRET, passToken: 'fixture-pass', cUserId: 'fixture-cuser', deviceId: 'fixture-device' };
const ACCOUNT = 'https://account.xiaomi.com';
const AUTH = { _sign: 'fixture-sign', qs: '?sid=xiaomiio&_json=true', callback: 'https://sts.api.io.mi.com/sts' };
const SUCCESS = { userId: '700', cUserId: 'fixture-cuser', ssecurity: SECRET, passToken: 'fixture-pass', location: 'https://sts.api.io.mi.com/sts?sign=fixture' };
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
function response(data, cookies = [], status = 200) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response('&&&START&&&' + JSON.stringify(data), { status, headers });
}
const finalResponse = (token = 'fixture-service') => new Response('ok', { headers: { 'Set-Cookie': `serviceToken=${token}; Domain=.io.mi.com; Path=/; HttpOnly; Secure` } });
function sequence(steps) {
  const calls = [];
  const fetchImpl = async (input, options) => {
    const call = { url: new URL(input), options }; calls.push(call);
    const step = steps.shift(); assert.ok(step, `unexpected call to ${call.url.pathname}`);
    if (step.path) assert.equal(call.url.pathname, step.path);
    return typeof step.reply === 'function' ? step.reply(call) : step.reply;
  };
  return { calls, fetchImpl, complete: () => assert.equal(steps.length, 0) };
}
function decodeCloud(call, secret = SECRET) {
  const params = new URLSearchParams(call.options.body), nonce = params.get('_nonce');
  const key = createHash('sha256').update(Buffer.from(secret, 'base64')).update(Buffer.from(nonce, 'base64')).digest();
  return { data: JSON.parse(rc4Drop1024(key, Buffer.from(params.get('data'), 'base64')).toString()), key, params };
}
function encrypted(result, key) { return new Response(rc4Drop1024(key, Buffer.from(JSON.stringify({ code: 0, result }))).toString('base64')); }

test('RC4 drop1024 matches RFC 6229 and MiCloud framing is stable', () => {
  // RFC 6229, key 0x0102030405, stream offset 1024.
  assert.equal(rc4Drop1024(Buffer.from('0102030405', 'hex'), Buffer.alloc(16)).toString('hex'), '30abbcc7c20b01609f23ee2d5f6bb7df');
  const encoded = encodeCloudRequest('/miotspec/prop/get', { params: [{ did: '123', siid: 2, piid: 1 }] }, SECRET, Buffer.from('010203040506070800000001', 'hex').toString('base64'));
  assert.equal(encoded.body.get('data'), 'K/F8gfbgQ9emdhmhCr2ffg1kxmliqzCTLWHIz0tkFpJJqjX8bIvkk222wrQ=');
  assert.equal(encoded.body.get('rc4_hash__'), 'YepL2OnnQuDWAhSZUZCSS0wKhRYRoGj8Ql7smw==');
  assert.equal(encoded.body.get('signature'), '15phrxIQQAphlGlk0MlFaXknT/U=');
});

test('password login completes without an App and only exports server credentials', async () => {
  const wire = sequence([
    { path: '/pass/serviceLogin', reply: call => { assert.equal(call.url.searchParams.get('sid'), 'xiaomiio'); assert.match(call.options.headers.Cookie, /deviceId=/); return response(AUTH, ['accountOnly=private; Path=/; Secure']); } },
    { path: '/pass/serviceLoginAuth2', reply: call => {
      const body = new URLSearchParams(call.options.body);
      assert.equal(body.get('user'), 'test-user'); assert.equal(body.get('hash'), createHash('md5').update('test-only-password').digest('hex').toUpperCase());
      assert.equal(body.get('_sign'), 'fixture-sign'); assert.match(call.options.headers.Cookie, /accountOnly=private/); assert.match(call.options.headers.Cookie, /deviceId=/);
      assert.ok(!String(call.options.body).includes('test-only-password')); return response(SUCCESS);
    } },
    { path: '/sts', reply: call => { assert.equal(call.url.origin, 'https://sts.api.io.mi.com'); assert.ok(!call.options.headers.Cookie?.includes('accountOnly')); return finalResponse(); } },
  ]);
  const cloud = new MijiaCloud({ fetchImpl: wire.fetchImpl });
  assert.equal(await cloud.login({ username: 'test-user', password: 'test-only-password' }), null);
  assert.equal(cloud.authenticated, true); assert.equal(cloud.publicChallenge(), null);
  assert.deepEqual(Object.keys(cloud.exportCredentials()).sort(), ['cUserId', 'deviceId', 'passToken', 'region', 'serviceToken', 'sid', 'ssecurity', 'userId'].sort());
  assert.ok(!JSON.stringify(cloud).includes('fixture-pass'));
  const saved = cloud.exportCredentials(); cloud.clearLogin(); assert.deepEqual(cloud.exportCredentials(), saved);
  cloud.close(); assert.equal(cloud.authenticated, false); wire.complete();
});

test('CAPTCHA continuation preserves sign, password hash and ick without exposing them', async () => {
  const wire = sequence([
    { path: '/pass/serviceLogin', reply: response(AUTH) },
    { path: '/pass/serviceLoginAuth2', reply: response({ code: 87001, captchaUrl: '/pass/getCode?icodeType=login' }) },
    { path: '/pass/getCode', reply: new Response(PNG, { headers: { 'Set-Cookie': 'ick=fixture-ick; Path=/pass; Secure', 'Content-Type': 'image/png' } }) },
    { path: '/pass/serviceLoginAuth2', reply: call => {
      const body = new URLSearchParams(call.options.body);
      assert.equal(body.get('captCode'), 'abcd'); assert.equal(body.get('_sign'), 'fixture-sign'); assert.match(call.options.headers.Cookie, /ick=fixture-ick/);
      return response(SUCCESS);
    } },
    { path: '/sts', reply: finalResponse() },
  ]);
  const cloud = new MijiaCloud({ fetchImpl: wire.fetchImpl });
  const challenge = await cloud.login({ username: 'test-user', password: 'test-only-password' });
  assert.deepEqual(challenge, { type: 'captcha', image: 'data:image/png;base64,' + PNG.toString('base64') });
  assert.ok(!JSON.stringify(challenge).includes('fixture-ick')); challenge.image = 'changed'; assert.notEqual(cloud.publicChallenge().image, 'changed');
  assert.equal(await cloud.login({ captcha: 'abcd' }), null);
  await assert.rejects(cloud.login({ captcha: 'abcd' }), error => error.code === 'invalid_challenge'); wire.complete();
});

test('phone verification is explicitly sent in the same identity session and reacquires ssecurity', async () => {
  const wire = sequence([
    { path: '/pass/serviceLogin', reply: response(AUTH) },
    { path: '/pass/serviceLoginAuth2', reply: response({ notificationUrl: '/fe/service/identity/authStart?sid=xiaomiio&context=fixture' }) },
    { path: '/identity/list', reply: call => { assert.equal(call.url.searchParams.get('context'), 'fixture'); return response({ options: [4, 8], flag: 4 }, ['identity_session=fixture-identity; Path=/identity; Secure']); } },
    { path: '/identity/auth/verifyPhone', reply: call => { assert.equal(call.url.searchParams.get('_flag'), '4'); assert.match(call.options.headers.Cookie, /identity_session=fixture-identity/); return response({ code: 0 }); } },
    { path: '/identity/auth/sendPhoneTicket', reply: call => { assert.match(call.options.headers.Cookie, /identity_session=fixture-identity/); assert.equal(new URLSearchParams(call.options.body).get('_flag'), '4'); return response({ code: 0 }); } },
    { path: '/identity/auth/verifyPhone', reply: call => { const body = new URLSearchParams(call.options.body); assert.equal(body.get('ticket'), '123456'); assert.equal(body.get('trust'), 'false'); assert.match(call.options.headers.Cookie, /identity_session=fixture-identity/); return response({ code: 0, location: ACCOUNT + '/identity/result/check' }); } },
    { path: '/identity/result/check', reply: new Response(null, { status: 302, headers: { Location: SUCCESS.location } }) },
    { path: '/sts', reply: call => { assert.ok(!call.options.headers.Cookie?.includes('fixture-identity')); return finalResponse(); } },
    { path: '/pass/serviceLogin', reply: response({ code: 0, userId: '700', ssecurity: SECRET, passToken: 'fixture-pass' }) },
  ]);
  const cloud = new MijiaCloud({ fetchImpl: wire.fetchImpl });
  assert.deepEqual(await cloud.login({ username: 'test-user', password: 'test-only-password' }), { type: 'verification', methods: [{ id: 'phone', label: '手机短信' }, { id: 'email', label: '邮箱验证码' }], sent: false });
  assert.equal(wire.calls.length, 3, 'login does not automatically send an SMS');
  assert.equal((await cloud.sendVerification({ method: 'phone' })).sent, true);
  assert.equal(await cloud.verify({ code: '123456' }), null); assert.equal(cloud.authenticated, true); wire.complete();
});

test('email send CAPTCHA uses identity_session and ick, and wrong codes remain a verification challenge', async () => {
  const wire = sequence([
    { path: '/pass/serviceLogin', reply: response(AUTH) },
    { path: '/pass/serviceLoginAuth2', reply: response({ notificationUrl: '/fe/service/identity/authStart' }) },
    { path: '/identity/list', reply: response({ options: [8], flag: 8 }, ['identity_session=email-identity; Path=/identity; Secure']) },
    { path: '/identity/auth/verifyEmail', reply: response({ code: 0 }) },
    { path: '/identity/auth/sendEmailTicket', reply: response({ code: 87001, captchaUrl: '/pass/getCode' }) },
    { path: '/pass/getCode', reply: new Response(PNG, { headers: { 'Set-Cookie': 'ick=email-ick; Path=/pass; Secure' } }) },
    { path: '/identity/auth/verifyEmail', reply: response({ code: 0 }) },
    { path: '/identity/auth/sendEmailTicket', reply: call => { assert.match(call.options.headers.Cookie, /identity_session=email-identity/); assert.match(call.options.headers.Cookie, /ick=email-ick/); assert.equal(new URLSearchParams(call.options.body).get('icode'), 'efgh'); return response({ code: 0 }); } },
    { path: '/identity/auth/verifyEmail', reply: response({ code: 70016, message: 'upstream includes fixture-secret' }) },
  ]);
  const cloud = new MijiaCloud({ fetchImpl: wire.fetchImpl });
  await cloud.login({ username: 'test-user', password: 'test-only-password' });
  const challenge = await cloud.sendVerification({ method: 'email' }); assert.equal(challenge.sent, false); assert.match(challenge.captchaImage, /^data:image\/png;base64,/);
  await assert.rejects(cloud.verify({ code: '123456' }), error => error.code === 'invalid_challenge');
  await cloud.sendVerification({ method: 'email', captcha: 'efgh' });
  await assert.rejects(cloud.verify({ code: '123456' }), error => error.code === 'verification_failed' && !error.message.includes('fixture-secret'));
  assert.equal(cloud.publicChallenge().type, 'verification'); wire.complete();
});

test('unsafe login URLs and redirect destinations are rejected before credentials can leave allowed hosts', async () => {
  for (const result of [
    { captchaUrl: 'http://account.xiaomi.com/pass/getCode' },
    { captchaUrl: 'https://account.xiaomi.com.evil.example/pass/getCode' },
    { captchaUrl: 'https://user:pass@account.xiaomi.com/pass/getCode' },
    { notificationUrl: 'https://account.xiaomi.com/unknown' },
    { notificationUrl: 'https://127.0.0.1/identity/authStart' },
    { ...SUCCESS, location: 'https://169.254.169.254/latest/meta-data' },
  ]) {
    const wire = sequence([{ reply: response(AUTH) }, { reply: response(result) }]);
    const cloud = new MijiaCloud({ fetchImpl: wire.fetchImpl });
    await assert.rejects(cloud.login({ username: 'test-user', password: 'test-only-password' }), error => error instanceof CloudError && error.code === 'invalid_response' && !error.message.includes('169.254'));
    assert.equal(wire.calls.length, 2); wire.complete();
  }
  const wire = sequence([{ reply: response(AUTH) }, { reply: response(SUCCESS) }, { reply: new Response(null, { status: 302, headers: { Location: 'https://evil.example/?secret=fixture' } }) }]);
  const cloud = new MijiaCloud({ fetchImpl: wire.fetchImpl });
  await assert.rejects(cloud.login({ username: 'test-user', password: 'test-only-password' }), error => error.code === 'invalid_response');
  assert.equal(wire.calls.length, 3); wire.complete();
});

test('upstream failures, timeouts, invalid images and oversized bodies expose only safe CloudErrors', async () => {
  const bad = new MijiaCloud({ fetchImpl: async () => { throw Error('password=fixture-private-token'); } });
  await assert.rejects(bad.login({ username: 'test-user', password: 'test-only-password' }), error => error.code === 'upstream_failure' && !JSON.stringify(error).includes('fixture-private'));
  const timeout = new MijiaCloud({ timeoutMs: 5, fetchImpl: () => new Promise(() => {}) });
  await assert.rejects(timeout.login({ username: 'test-user', password: 'test-only-password' }), error => error.code === 'upstream_failure');
  const oversized = new MijiaCloud({ fetchImpl: async () => new Response('x', { headers: { 'Content-Length': String(3 * 1024 * 1024) } }) });
  await assert.rejects(oversized.login({ username: 'test-user', password: 'test-only-password' }), error => error.code === 'invalid_response');
  const wire = sequence([{ reply: response(AUTH) }, { reply: response({ captchaUrl: '/pass/getCode' }) }, { reply: new Response('<script>bad</script>', { headers: { 'Content-Type': 'image/jpeg', 'Set-Cookie': 'ick=fixture; Path=/' } }) }]);
  const image = new MijiaCloud({ fetchImpl: wire.fetchImpl });
  await assert.rejects(image.login({ username: 'test-user', password: 'test-only-password' }), error => error.code === 'invalid_response');
  const invalid = new MijiaCloud({ fetchImpl: async () => response({ code: 70016, message: 'fixture-private-token' }) });
  await assert.rejects(invalid.login({ username: 'test-user', password: 'test-only-password' }), error => error.code === 'invalid_credentials' && !error.message.includes('fixture-private'));
});

test('cloud discovery and property reads strip tokens/raw fields and never invent write feedback', async () => {
  const wire = sequence([
    { path: '/app/v2/homeroom/gethome_merged', reply: call => {
      assert.equal(call.url.origin, 'https://api.io.mi.com'); assert.match(call.options.headers.Cookie, /serviceToken=fixture-service/);
      const { data, key } = decodeCloud(call); assert.equal(data.fetch_share, true);
      return encrypted({ homelist: [{ id: '100', name: '测试家庭', uid: 700, roomlist: [{ id: '200', name: '客厅', dids: ['10'] }] }] }, key);
    } },
    { path: '/app/home/home_device_list', reply: call => { const { data } = decodeCloud(call); assert.equal(data.home_id, 100); assert.equal(data.home_owner, 700); return response({ code: 0, result: { device_info: [{ did: '10', name: '台灯', model: 'fixture.light.v1', isOnline: true, token: 'never-public', localip: '192.168.1.10', spec_type: 'urn:miot-spec-v2:device:light:0000A001:fixture:1' }], has_more: false } }); } },
    { path: '/app/miotspec/prop/get', reply: call => encrypted([{ did: '10', siid: 2, piid: 1, code: 0, value: false, token: 'never-public' }], decodeCloud(call).key) },
    { path: '/app/miotspec/prop/set', reply: call => { assert.equal(decodeCloud(call).data.params[0].value, true); return response({ code: 0, result: [{ did: '10', siid: 2, piid: 1, code: 0 }] }); } },
  ]);
  const cloud = new MijiaCloud({ credentials: CREDS, fetchImpl: wire.fetchImpl });
  assert.deepEqual(await cloud.listHomes(), [{ id: '100', name: '测试家庭', rooms: [{ id: '200', name: '客厅' }] }]);
  assert.deepEqual(await cloud.listDevices('100'), [{ id: '10', name: '台灯', model: 'fixture.light.v1', specType: 'urn:miot-spec-v2:device:light:0000A001:fixture:1', online: true, roomId: '200', roomName: '客厅' }]);
  assert.deepEqual(await cloud.getProperties([{ did: '10', siid: 2, piid: 1 }]), [{ did: '10', siid: 2, piid: 1, code: 0, value: false }]);
  assert.deepEqual(await cloud.setProperties([{ did: '10', siid: 2, piid: 1, value: true }]), [{ did: '10', siid: 2, piid: 1, code: 0 }]); wire.complete();
});

test('expired read sessions refresh with passToken once; writes are never blindly retried', async () => {
  const wire = sequence([
    { path: '/app/miotspec/prop/get', reply: new Response('', { status: 401 }) },
    { path: '/pass/serviceLogin', reply: call => { assert.match(call.options.headers.Cookie, /passToken=fixture-pass/); assert.ok(!call.options.headers.Cookie.includes('serviceToken')); return response({ ...SUCCESS, code: 0 }); } },
    { path: '/sts', reply: finalResponse('fresh-service') },
    { path: '/app/miotspec/prop/get', reply: call => { assert.match(call.options.headers.Cookie, /serviceToken=fresh-service/); return response({ code: 0, result: [{ did: '10', siid: 2, piid: 1, code: 0, value: true }] }); } },
  ]);
  const cloud = new MijiaCloud({ credentials: CREDS, fetchImpl: wire.fetchImpl });
  assert.equal((await cloud.getProperties([{ did: '10', siid: 2, piid: 1 }]))[0].value, true); assert.equal(cloud.exportCredentials().serviceToken, 'fresh-service'); wire.complete();
  let calls = 0;
  const write = new MijiaCloud({ credentials: CREDS, fetchImpl: async () => { calls++; return response({ code: 3, message: 'private token' }); } });
  await assert.rejects(write.setProperties([{ did: '10', siid: 2, piid: 1, value: true }]), error => error.code === 'auth_expired');
  assert.equal(calls, 1); assert.equal(write.authenticated, false);
});

test('public spec lookup never sends account cookies and caches specs by URN', async () => {
  const type = 'urn:miot-spec-v2:device:light:0000A001:fixture:1';
  const wire = sequence([
    { path: '/miot-spec-v2/instances', reply: call => { assert.equal(call.url.origin, 'https://miot-spec.org'); assert.equal(call.options.headers.Cookie, undefined); return response({ instances: [{ model: 'fixture.light.v1', type, status: 'released', ts: 123 }] }); } },
    { path: '/miot-spec-v2/instance', reply: call => { assert.equal(call.url.searchParams.get('type'), type); assert.equal(call.options.headers.Cookie, undefined); return response({ type, services: [] }); } },
  ]);
  const cloud = new MijiaCloud({ credentials: CREDS, fetchImpl: wire.fetchImpl });
  const first = await cloud.getSpec({ model: 'fixture.light.v1' }); first.services.push('mutated');
  assert.deepEqual(await cloud.getSpec({ specType: type }), { type, services: [] });
  await assert.rejects(cloud.getSpec({ specType: 'https://evil.example' }), error => error.code === 'invalid_request'); wire.complete();
});

test('closed clients abort pending requests, and region/credential mismatch fails closed', async () => {
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const cloud = new MijiaCloud({ fetchImpl: async (_url, { signal }) => { started(); return new Promise((_, reject) => signal.addEventListener('abort', () => reject(Error('cancelled upstream-secret')), { once: true })); } });
  const pending = cloud.login({ username: 'test-user', password: 'test-only-password' });
  await ready; cloud.close(); await assert.rejects(pending, error => error.code === 'cancelled');
  assert.throws(() => new MijiaCloud({ region: 'arbitrary.example' }), error => error.code === 'invalid_request');
  assert.throws(() => new MijiaCloud({ region: 'de', credentials: { ...CREDS, region: 'cn' } }), error => error.code === 'invalid_credentials');
  assert.throws(() => new MijiaCloud({ credentials: { ...CREDS, serviceToken: 'bad\nHeader: token' } }), error => error.code === 'invalid_credentials');
});

test('clearing a pending login cannot commit late credentials or resurrect a challenge', async () => {
  let release, started;
  const ready = new Promise(resolve => { started = resolve; });
  let calls = 0;
  const cloud = new MijiaCloud({ fetchImpl: async () => {
    calls++;
    if (calls === 1) return response(AUTH);
    started(); return new Promise(resolve => { release = resolve; });
  } });
  const pending = cloud.login({ username: 'test-user', password: 'test-only-password' });
  await ready; cloud.clearLogin(); release(response(SUCCESS));
  await assert.rejects(pending, error => error.code === 'invalid_challenge');
  assert.equal(calls, 2); assert.equal(cloud.exportCredentials(), null); assert.equal(cloud.publicChallenge(), null);
});
