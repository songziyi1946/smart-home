import test from 'node:test';
import assert from 'node:assert/strict';
import { aiConnectionOwnerKey, validateAIConnectionInput } from './profile/ai-connections-model.ts';

const session = { household: { id: 'home-1' }, user: { id: 'user-1', role: 'member' }, loggedInAt: '2026-11-24T00:00:00Z' };
const form = { name: '我的服务', baseUrl: 'https://api.openai.com/v1', model: 'gpt-6.1-terra', apiKey: 'private-key' };

test('personal AI state is isolated across household, user and fresh sign-in', () => {
  const original = aiConnectionOwnerKey(session);
  assert.ok(original);
  assert.notEqual(original, aiConnectionOwnerKey({ ...session, household: { id: 'home-2' } }));
  assert.notEqual(original, aiConnectionOwnerKey({ ...session, user: { id: 'user-2', role: 'admin' } }));
  assert.notEqual(original, aiConnectionOwnerKey({ ...session, loggedInAt: '2026-11-24T01:00:00Z' }));
  assert.equal(aiConnectionOwnerKey({ ...session, localPreview: true }), undefined);
  assert.equal(aiConnectionOwnerKey({ ...session, user: { ...session.user, role: 'guest' } }), undefined);
});

test('connection form rejects credentials in URL and requires explicit nonempty key', () => {
  assert.equal(validateAIConnectionInput(form), undefined);
  assert.equal(validateAIConnectionInput({ ...form, baseUrl: 'https://gateway.example.com/openai/v1' }), undefined);
  for (const baseUrl of ['http://api.openai.com/v1', 'https://user:secret@api.openai.com/v1', 'https://api.openai.com/v1?api_key=secret', 'https://api.openai.com/v1#secret', 'not-a-url']) {
    assert.match(validateAIConnectionInput({ ...form, baseUrl }), /地址/);
  }
  assert.match(validateAIConnectionInput({ ...form, apiKey: '   ' }), /密钥/);
  assert.match(validateAIConnectionInput({ ...form, name: ' ' }), /服务名称/);
  assert.match(validateAIConnectionInput({ ...form, model: ' ' }), /模型名称/);
  assert.match(validateAIConnectionInput({ ...form, apiKey: 'k'.repeat(8193) }), /密钥/);
});
