import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { ProviderVault } from './provider-vault.mjs';

const connection = () => ({ credentials: { region: 'cn', sid: 'xiaomiio', userId: 'fixture-user', deviceId: 'fixture-device', serviceToken: 'fixture-service-secret', passToken: 'fixture-refresh-secret', ssecurity: Buffer.alloc(32, 4).toString('base64') }, homeId: '1', roomBindings: { room1: { id: 'living', name: '客厅' } } });
test('provider credentials persist only as authenticated ciphertext outside business data', t => {
  const root = mkdtempSync(join(tmpdir(), 'home-provider-vault-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const data = join(root, 'data'); mkdirSync(data); const key = randomBytes(32), vault = new ProviderVault(data, key);
  assert.equal(vault.load(), null); vault.save(connection());
  assert.deepEqual(new ProviderVault(data, key).load(), connection());
  assert.deepEqual(readdirSync(data), []);
  const bytes = readFileSync(vault.path, 'utf8'); assert.ok(!bytes.includes('fixture-service-secret')); assert.ok(!bytes.includes('fixture-refresh-secret'));
  if (process.platform !== 'win32') assert.equal(statSync(vault.path).mode & 0o777, 0o600);
  assert.throws(() => new ProviderVault(data, randomBytes(32)).load(), /无法读取/);
  assert.throws(() => vault.save({ ...connection(), credentials: { ...connection().credentials, password: 'never-save' } }));
  assert.deepEqual(vault.load(), connection());
  vault.save(null); assert.equal(vault.load(), null);
  assert.ok(readdirSync(root).every(name => !name.endsWith('.tmp')));
});
test('provider vault refuses symlinked credential input', t => {
  const root = mkdtempSync(join(tmpdir(), 'home-provider-link-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const a = new ProviderVault(join(root, 'a'), randomBytes(32)); a.save(connection());
  const b = new ProviderVault(join(root, 'b'), randomBytes(32)); symlinkSync(a.path, b.path);
  assert.throws(() => b.load(), /无法读取/);
  const data = join(root, 'data'); mkdirSync(data); symlinkSync(data, join(root, 'alias'), 'dir');
  assert.throws(() => new ProviderVault(data, randomBytes(32), join(root, 'alias', 'account.mijia.enc')), /业务数据目录之外/);
});
