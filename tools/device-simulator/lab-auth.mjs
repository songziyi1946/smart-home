import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

const authFile = new URL('.lab-auth.json', import.meta.url);
/** Only bootstraps the disposable Compose lab; never a user-supplied HA server. */
export async function labToken(url, bootstrap = false) {
  if (process.env.HA_TOKEN) return process.env.HA_TOKEN;
  if (url !== 'http://127.0.0.1:18123') throw new Error('Set HA_TOKEN for an existing HA installation');
  let auth;
  try { auth = JSON.parse(await readFile(authFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  async function request(path, body, token) {
    const response = await fetch(url + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(token ? {Authorization:`Bearer ${token}`} : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`HA lab setup failed (${response.status}) at ${path}`);
    return response.json();
  }
  if (!auth) {
    if (!bootstrap) throw new Error('Set HA_TOKEN, or use --bootstrap on a new disposable Compose lab');
    const steps = await request('/api/onboarding');
    if (steps.find(step => step.step === 'user')?.done) throw new Error('HA already has a user; supply HA_TOKEN instead of overwriting it');
    const client_id = url + '/';
    const user = await request('/api/onboarding/users', { client_id, name: 'Home OS Device Lab', username: 'homeos_lab', password: randomBytes(24).toString('hex'), language: 'en' });
    const response = await fetch(url + '/auth/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', code: user.auth_code, client_id }), signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('HA lab token exchange failed');
    const tokens = await response.json();
    auth = { client_id, refresh_token: tokens.refresh_token };
    if (!auth.refresh_token) throw new Error('HA lab did not return a refresh token');
    await writeFile(authFile, JSON.stringify(auth), { mode: 0o600 });
    for (const step of ['core_config', 'analytics']) await request(`/api/onboarding/${step}`, {}, tokens.access_token);
    await request('/api/onboarding/integration', { client_id, redirect_uri: url + '/?auth_callback=1' }, tokens.access_token);
  }
  const response = await fetch(url + '/auth/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: auth.refresh_token, client_id: auth.client_id }), signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('HA lab refresh failed; supply HA_TOKEN or recreate the disposable lab');
  const { access_token } = await response.json();
  if (!access_token) throw new Error('HA lab access token missing');
  if (bootstrap) {
    const entries = await request('/api/config/config_entries/entry', undefined, access_token);
    if (!entries.some(entry => entry.domain === 'mqtt')) {
      let flow = await request('/api/config/config_entries/flow', { handler: 'mqtt', show_advanced_options: false }, access_token);
      flow = await request(`/api/config/config_entries/flow/${flow.flow_id}`, { broker: 'mqtt', port: 1883, protocol: '3.1.1', other_settings: { set_client_cert: false, set_ca_cert: 'off', transport: 'tcp' } }, access_token);
      if (flow.type !== 'create_entry') throw new Error(`MQTT lab integration requires setup (step: ${flow.step_id ?? flow.type})`);
    }
  }
  return access_token;
}
