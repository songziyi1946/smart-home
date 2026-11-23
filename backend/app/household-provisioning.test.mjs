import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { createHousehold } from '../../tools/create-household.mjs';

test('provisioning creates private, separate household data/key/configuration and refuses overwrites', t => {
  const root = mkdtempSync(join(tmpdir(), 'home-provision-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const homes = ['alice', 'bob'].map((id, i) => createHousehold({ directory: join(root, id), id, port: 3111 + i, slot: 51 + i }));
  const local = homes.map(home => parseEnv(readFileSync(join(home, '.env.local'), 'utf8')));
  const compose = homes.map(home => parseEnv(readFileSync(join(home, '.env.compose'), 'utf8')));
  assert.notEqual(local[0].SMART_HOME_DATA_DIR, local[1].SMART_HOME_DATA_DIR);
  assert.notEqual(readFileSync(local[0].SMART_HOME_DATA_KEY_FILE, 'utf8'), readFileSync(local[1].SMART_HOME_DATA_KEY_FILE, 'utf8'));
  assert.notEqual(compose[0].SMART_HOME_INSTANCE_NAME, compose[1].SMART_HOME_INSTANCE_NAME);
  assert.notEqual(compose[0].SMART_HOME_DOCKER_SUBNET, compose[1].SMART_HOME_DOCKER_SUBNET);
  for (const [i, home] of homes.entries()) {
    assert.equal(local[i].HA_URL, ''); assert.equal(local[i].HA_TOKEN, '');
    assert.equal(local[i].SMART_HOME_BOOTSTRAP_TOKEN, '');
    if (process.platform !== 'win32') {
      for (const path of [home, join(home, 'data'), join(home, 'secrets')]) assert.equal(statSync(path).mode & 0o777, 0o700);
      for (const path of [local[i].SMART_HOME_DATA_KEY_FILE, join(home, '.env.local'), join(home, '.env.compose')]) assert.equal(statSync(path).mode & 0o777, 0o600);
    }
  }
  const firstKey = readFileSync(local[0].SMART_HOME_DATA_KEY_FILE);
  assert.throws(() => createHousehold({ directory: homes[0], id: 'replacement' }), { code: 'EEXIST' });
  assert.deepEqual(readFileSync(local[0].SMART_HOME_DATA_KEY_FILE), firstKey);
  symlinkSync(homes[0], join(root, 'linked'), 'dir');
  assert.throws(() => createHousehold({ directory: join(root, 'linked'), id: 'linked' }), { code: 'EEXIST' });
  for (const input of [{ directory: 'relative', id: 'home' }, { directory: join(root, 'bad-id'), id: '../bad' }, { directory: join(root, 'bad-port'), id: 'home', port: '3101\nHA_TOKEN=bad' }, { directory: join(root, 'bad-slot'), id: 'home', slot: 256 }]) assert.throws(() => createHousehold(input));
});

test('root initialization refuses before creating any household directory', { skip: !process.getuid }, t => {
  const root = mkdtempSync(join(tmpdir(), 'home-root-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  t.mock.method(process, 'getuid', () => 0);
  const directory = join(root, 'root-home');
  assert.throws(() => createHousehold({ directory, id: 'root-home' }), /非 root/);
  assert.equal(existsSync(directory), false);
});

test('household Compose entry pins project/configuration despite inherited variables and rejects overrides', { skip: process.platform === 'win32' }, t => {
  const root = mkdtempSync(join(tmpdir(), 'home-compose-entry-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = createHousehold({ directory: join(root, 'alice'), id: 'alice' });
  const bin = join(root, 'bin'); mkdirSync(bin);
  writeFileSync(join(bin, 'docker'), `#!${process.execPath}\nprocess.stdout.write(JSON.stringify({args:process.argv.slice(2),data:process.env.SMART_HOME_HOST_DATA_DIR,ha:process.env.HA_URL}));\n`, { mode: 0o700 });
  const script = fileURLToPath(new URL('../../tools/create-household.mjs', import.meta.url));
  const env = { ...process.env, PATH: bin, COMPOSE_PROJECT_NAME: 'bob', SMART_HOME_INSTANCE_NAME: 'bob', SMART_HOME_HOST_DATA_DIR: '/other-household', HA_URL: 'https://other-household.example' };
  const invoke = args => spawnSync(process.execPath, [script, 'compose', '--directory', directory, '--', ...args], { env, encoding: 'utf8' });
  const result = invoke(['config']); assert.equal(result.status, 0, result.stderr);
  const received = JSON.parse(result.stdout);
  assert.deepEqual(received.args.slice(0, 3), ['compose', '--project-name', 'alice']);
  assert.equal(received.data, join(directory, 'data')); assert.equal(received.ha, '');
  for (const args of [['-p', 'bob', 'up'], ['--project-name=bob', 'up'], ['-f', '/other.yaml', 'up'], ['--env-file=/other.env', 'up'], ['--project-directory', '/other', 'up']]) {
    const invalid = invoke(args); assert.equal(invalid.status, 1); assert.match(invalid.stderr, /不接受覆盖/);
  }
  const configuration = join(directory, '.env.compose');
  writeFileSync(configuration, readFileSync(configuration, 'utf8').replace(/^SMART_HOME_UID=.*$/m, "SMART_HOME_UID='0'"));
  const rootUser = invoke(['config']); assert.equal(rootUser.status, 1); assert.match(rootUser.stderr, /非 root 用户 ID/);
});
