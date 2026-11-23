import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const publicUrl = new URL('../public/', import.meta.url);
function worker() {
  const handlers = {}, stored = new Map(), removed = [];
  const offline = new Response(readFileSync(new URL('offline.html', publicUrl)), { headers: { 'Content-Type': 'text/html' } });
  const cache = {
    async add(path) { stored.set(path, offline); },
    async match(path) { return stored.get(path); },
  };
  const context = {
    URL, Response,
    self: { location: { origin: 'https://home.example' }, addEventListener: (name, handler) => { handlers[name] = handler; }, skipWaiting: async () => {}, clients: { claim: async () => {} } },
    caches: { open: async () => cache, keys: async () => ['home-os-public-old', 'home-os-public-v1', 'another-app'], delete: async key => { removed.push(key); } },
    fetch: async () => new Response('authenticated household page'),
  };
  runInNewContext(readFileSync(new URL('sw.js', publicUrl), 'utf8'), context);
  async function lifecycle(name) { let pending; handlers[name]({ waitUntil(value) { pending = value; } }); await pending; }
  function request(path, options = {}) {
    let response;
    handlers.fetch({ request: { url: 'https://home.example' + path, method: 'GET', mode: 'navigate', ...options }, respondWith(value) { response = value; } });
    return response;
  }
  return { context, stored, removed, lifecycle, request };
}

test('PWA never intercepts APIs, SSE, commands, or cross-origin requests', async () => {
  const harness = worker();
  await harness.lifecycle('install');
  for (const path of ['/api/state', '/api/events', '/api/auth/session', '/api/accounts', '/api/devices/lamp']) assert.equal(harness.request(path), undefined);
  assert.equal(harness.request('/', { method: 'POST' }), undefined);
  assert.equal(harness.request('/assets/index.js', { mode: 'cors' }), undefined);
  assert.equal(harness.request('/', { url: 'https://other.example/' }), undefined);
  assert.deepEqual([...harness.stored.keys()], ['/offline.html']);
});

test('network responses stay uncached; offline navigation shows a public recovery page', async () => {
  const harness = worker();
  await harness.lifecycle('install');
  assert.equal(await (await harness.request('/')).text(), 'authenticated household page');
  assert.deepEqual([...harness.stored.keys()], ['/offline.html']);
  harness.context.fetch = async () => { throw Error('offline'); };
  const response = await harness.request('/');
  assert.match(await response.text(), /暂时无法连接家庭服务/);
  await harness.lifecycle('activate');
  assert.deepEqual(harness.removed, ['home-os-public-old']);
});

test('install manifest has standalone launch and correctly sized local PNG icons', () => {
  const manifest = JSON.parse(readFileSync(new URL('manifest.webmanifest', publicUrl), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/#home');
  assert.equal(manifest.scope, '/');
  for (const icon of manifest.icons) {
    const bytes = readFileSync(new URL('.' + icon.src, publicUrl));
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
    assert.equal(icon.sizes, `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`);
  }
  assert.ok(manifest.icons.some(icon => icon.purpose === 'maskable'));
});
