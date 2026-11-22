import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deploymentSecurity, isLocalRequest } from './deployment-security.mjs';

const request = (remoteAddress, hostname) => ({ socket: { remoteAddress }, hostname });

test('local preview verifies the peer and Host, ignoring spoofed forwarding headers', () => {
  for (const peer of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      assert.equal(isLocalRequest(request(peer, host)), true);
    }
    assert.equal(isLocalRequest(request(peer, 'home.example.com')), false);
  }
  for (const peer of ['198.51.100.1', '172.18.0.2', undefined]) {
    const forged = { ...request(peer, 'localhost'), headers: { 'x-forwarded-for': '127.0.0.1' } };
    assert.equal(isLocalRequest(forged), false);
    assert.equal(deploymentSecurity({}).allowSetup({ ...forged, get: () => undefined }), false);
  }
});

test('only non-production local mode allows skip-login', () => {
  assert.equal(deploymentSecurity({}).allowSkipLogin, true);
  for (const env of [
    { NODE_ENV: 'production' },
    { NODE_ENV: 'production', SMART_HOME_DEPLOYMENT_MODE: 'local' },
    { SMART_HOME_DEPLOYMENT_MODE: 'https' },
  ]) assert.equal(deploymentSecurity(env).allowSkipLogin, false);
});

test('production rejects skip-login before opening household storage, even with explicit local mode', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'smart-home-production-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const child = spawn(process.execPath, ['backend/server.mjs', '--skip-login'], {
    cwd: new URL('../../', import.meta.url),
    env: { ...process.env, NODE_ENV: 'production', SMART_HOME_DEPLOYMENT_MODE: 'local', SMART_HOME_DATA_DIR: directory },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let errorOutput = '';
  child.stderr.on('data', chunk => { errorOutput += chunk; });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  assert.equal(code, 1);
  assert.match(errorOutput, /cannot skip login/);
  assert.deepEqual(readdirSync(directory), []);
});
