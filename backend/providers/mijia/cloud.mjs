// Personal MiCloud adapter. Protocol references and licenses: docs/third-party/mijia-cloud-NOTICE.md.
import { createHash, randomBytes } from 'node:crypto';

const ACCOUNT = 'https://account.xiaomi.com';
const STS = 'https://sts.api.io.mi.com';
const SPEC = 'https://miot-spec.org';
const REGIONS = new Set(['cn', 'de', 'i2', 'ru', 'sg', 'tw', 'us']);
const MESSAGES = {
  invalid_credentials: '小米账号或密码有误，请检查后重试',
  auth_expired: '米家授权已失效，请重新登录',
  invalid_challenge: '登录验证已失效，请重新开始',
  verification_failed: '验证码有误或已过期，请重新输入',
  verification_unavailable: '当前小米账号没有可用的短信或邮箱验证方式',
  upstream_failure: '暂时无法连接小米服务，请稍后重试',
  invalid_response: '小米服务返回了无法识别的数据，请稍后重试',
  unsupported_device: '暂未找到该设备的公开功能规格',
  invalid_request: '米家请求参数有误',
  cancelled: '米家连接已关闭',
};
export class CloudError extends Error {
  constructor(code = 'upstream_failure') { super(Object.hasOwn(MESSAGES, code) ? MESSAGES[code] : MESSAGES.upstream_failure); this.name = 'CloudError'; this.code = Object.hasOwn(MESSAGES, code) ? code : 'upstream_failure'; }
}
const fail = code => { throw new CloudError(code); };
const sha1 = value => createHash('sha1').update(value).digest('base64');
const safeCookie = value => typeof value === 'string' && value.length > 0 && value.length <= 8192 && !/[\x00-\x20\x7f";,\\]/.test(value);
const id = value => typeof value === 'string' || Number.isSafeInteger(value) ? String(value) : '';
const bounded = (value, max = 200) => typeof value === 'string' && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);

// RC4-drop1024 is required by this upstream wire protocol; it is never used for local storage.
export function rc4Drop1024(key, input) {
  if (!Buffer.isBuffer(key) || !key.length || !Buffer.isBuffer(input)) fail('invalid_request');
  const state = Uint8Array.from({ length: 256 }, (_, n) => n);
  let j = 0;
  for (let n = 0; n < 256; n++) { j = (j + state[n] + key[n % key.length]) & 255; [state[n], state[j]] = [state[j], state[n]]; }
  let i = 0; j = 0;
  const next = () => { i = (i + 1) & 255; j = (j + state[i]) & 255; [state[i], state[j]] = [state[j], state[i]]; return state[(state[i] + state[j]) & 255]; };
  for (let n = 0; n < 1024; n++) next();
  return Buffer.from(input.map(value => value ^ next()));
}

export function encodeCloudRequest(path, data, ssecurity, nonce) {
  const signedNonce = createHash('sha256').update(Buffer.from(ssecurity, 'base64')).update(Buffer.from(nonce, 'base64')).digest('base64');
  const signature = params => sha1(['POST', path, ...Object.keys(params).sort().map(name => `${name}=${params[name]}`), signedNonce].join('&'));
  const params = { data: JSON.stringify(data) };
  params.rc4_hash__ = signature(params);
  const key = Buffer.from(signedNonce, 'base64');
  for (const name of Object.keys(params)) params[name] = rc4Drop1024(key, Buffer.from(params[name])).toString('base64');
  return { body: new URLSearchParams({ ...params, signature: signature(params), ssecurity, _nonce: nonce }), key };
}

function json(bytes) {
  try { return JSON.parse(bytes.toString('utf8').replace(/^&&&START&&&/, '')); }
  catch { fail('invalid_response'); }
}
function accountUrl(value, kind = 'redirect') {
  if (!bounded(value, 16384) || /\s/.test(value)) fail('invalid_response');
  let url; try { url = new URL(value, ACCOUNT); } catch { fail('invalid_response'); }
  if (url.username || url.password || url.hash || url.protocol !== 'https:' || url.port) fail('invalid_response');
  if (kind === 'redirect' && url.origin === STS && url.pathname === '/sts') return url;
  if (url.origin !== ACCOUNT) fail('invalid_response');
  if (kind === 'notification' && !url.pathname.endsWith('/identity/authStart')) fail('invalid_response');
  if (kind === 'captcha' && url.pathname !== '/pass/getCode' && !url.pathname.startsWith('/captcha')) fail('invalid_response');
  if (kind === 'redirect' && !['/pass/', '/fe/', '/identity/', '/sts/'].some(prefix => url.pathname.startsWith(prefix))) fail('invalid_response');
  return url;
}

export class MijiaCloud {
  #fetch; #timeout; #credentials; #expired = false; #cookies = new Map(); #login; #challenge;
  #controllers = new Set(); #closed = false; #homes = new Map(); #specs = new Map(); #modelSpecs; #epoch = 0; #refreshing;
  constructor({ region = 'cn', credentials, fetchImpl = fetch, timeoutMs = 10000 } = {}) {
    if (!REGIONS.has(region) || typeof fetchImpl !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) fail('invalid_request');
    this.region = region; this.#fetch = fetchImpl; this.#timeout = timeoutMs;
    if (credentials) {
      if (credentials.region && credentials.region !== region || credentials.sid && credentials.sid !== 'xiaomiio') fail('invalid_credentials');
      this.#credentials = this.#validateCredentials(credentials);
    }
  }
  get authenticated() { return !this.#closed && !!this.#credentials && !this.#expired; }
  exportCredentials() { return this.#credentials ? { ...this.#credentials } : null; }
  publicChallenge() { return this.#challenge ? structuredClone(this.#challenge) : null; }
  clearLogin() { this.#epoch++; this.#login = undefined; this.#challenge = undefined; this.#cookies.clear(); }
  close() { this.#closed = true; for (const controller of this.#controllers) controller.abort(); this.clearLogin(); }

  #validateCredentials(value) {
    const { userId, serviceToken, ssecurity } = value;
    if (![userId, serviceToken, ssecurity].every(safeCookie) || !/^[A-Za-z0-9+/]+={0,2}$/.test(ssecurity) || Buffer.from(ssecurity, 'base64').length < 16 || Buffer.from(ssecurity, 'base64').length > 128) fail('invalid_credentials');
    const result = { region: this.region, sid: 'xiaomiio', userId, serviceToken, ssecurity, deviceId: value.deviceId || randomBytes(8).toString('hex') };
    if (!safeCookie(result.deviceId)) fail('invalid_credentials');
    for (const field of ['passToken', 'cUserId']) if (value[field]) { if (!safeCookie(value[field])) fail('invalid_credentials'); result[field] = value[field]; }
    return result;
  }
  #userAgent() { return `Android-7.1.1-1.0.0-ONEPLUS A3010-136-${this.#login?.deviceId ?? this.#credentials?.deviceId ?? 'homeos'} APP/xiaomi.smarthome APPV/62830`; }
  #rememberCookies(headers, url) {
    for (const header of headers.getSetCookie()) {
      const parts = header.split(';'), split = parts[0].indexOf('='), name = parts[0].slice(0, split).trim(), value = parts[0].slice(split + 1).trim();
      if (split < 1 || !/^[A-Za-z0-9_-]+$/.test(name) || value && !safeCookie(value)) continue;
      let domain = url.hostname, path = '/', hostOnly = true, expiresAt = Infinity;
      for (const part of parts.slice(1)) {
        const index = part.indexOf('='), key = (index < 0 ? part : part.slice(0, index)).trim().toLowerCase(), attr = index < 0 ? '' : part.slice(index + 1).trim();
        if (key === 'domain') { domain = attr.replace(/^\./, '').toLowerCase(); hostOnly = false; }
        if (key === 'path' && attr.startsWith('/')) path = attr;
        if (key === 'max-age' && /^-?\d+$/.test(attr)) expiresAt = Date.now() + Number(attr) * 1000;
      }
      if (domain !== url.hostname && (!url.hostname.endsWith('.' + domain) || domain.split('.').length < 2)) continue;
      const key = `${domain}|${path}|${name}`;
      if (!value || expiresAt <= Date.now()) this.#cookies.delete(key);
      else this.#cookies.set(key, { name, value, domain, path, hostOnly, expiresAt });
    }
  }
  #cookieHeader(url) {
    return [...this.#cookies.values()].filter(cookie => cookie.expiresAt > Date.now() &&
      (cookie.hostOnly ? cookie.domain === url.hostname : url.hostname === cookie.domain || url.hostname.endsWith('.' + cookie.domain)) &&
      (url.pathname === cookie.path || url.pathname.startsWith(cookie.path.endsWith('/') ? cookie.path : cookie.path + '/')))
      .map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
  }
  #cookie(name, origin = STS) {
    const host = new URL(origin).hostname;
    return [...this.#cookies.values()].filter(cookie => cookie.name === name && cookie.expiresAt > Date.now() &&
      (cookie.hostOnly ? cookie.domain === host : host === cookie.domain || host.endsWith('.' + cookie.domain))).at(-1)?.value;
  }
  async #fetchBytes(url, { method = 'GET', body, headers = {}, cookies = false, limit = 2 * 1024 * 1024, epoch = this.#epoch } = {}) {
    if (this.#closed) fail('cancelled');
    const controller = new AbortController(); this.#controllers.add(controller);
    let timer;
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new CloudError('upstream_failure')); }, this.#timeout); });
    try {
      return await Promise.race([deadline, (async () => {
        const response = await this.#fetch(url.href, { method, body, redirect: 'manual', signal: controller.signal, headers: { 'User-Agent': this.#userAgent(), ...(cookies ? { Cookie: this.#cookieHeader(url) } : {}), ...headers } });
        if (this.#closed || controller.signal.aborted) fail(this.#closed ? 'cancelled' : 'upstream_failure');
        if (cookies && epoch !== this.#epoch) fail('invalid_challenge');
        if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); fail('invalid_response'); }
        const chunks = []; let length = 0;
        if (response.body) {
          const reader = response.body.getReader();
          try { while (true) { const part = await reader.read(); if (part.done) break; length += part.value.byteLength; if (length > limit) { await reader.cancel(); fail('invalid_response'); } chunks.push(Buffer.from(part.value)); } }
          finally { reader.releaseLock(); }
        }
        if (this.#closed || controller.signal.aborted) fail(this.#closed ? 'cancelled' : 'upstream_failure');
        if (cookies && epoch !== this.#epoch) fail('invalid_challenge');
        if (cookies) this.#rememberCookies(response.headers, url);
        return { status: response.status, headers: response.headers, bytes: Buffer.concat(chunks), url };
      })()]);
    } catch (error) { if (error instanceof CloudError) throw error; throw new CloudError(this.#closed ? 'cancelled' : 'upstream_failure'); }
    finally { clearTimeout(timer); this.#controllers.delete(controller); }
  }
  async #account(path, data, extra = {}) {
    const url = accountUrl(path), headers = { ...extra.headers };
    let body;
    if (data !== undefined) { body = new URLSearchParams(data); headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
    const response = await this.#fetchBytes(url, { method: data === undefined ? 'GET' : 'POST', body, headers, cookies: true });
    if (response.status !== 200) fail('upstream_failure');
    return json(response.bytes);
  }
  async #follow(value) {
    let url = accountUrl(value); const epoch = this.#epoch;
    for (let n = 0; n < 6; n++) {
      if (epoch !== this.#epoch) fail('invalid_challenge');
      const response = await this.#fetchBytes(url, { cookies: true, epoch });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location'); if (!location) fail('invalid_response');
        url = accountUrl(new URL(location, url).href); continue;
      }
      if (response.status !== 200) fail('upstream_failure');
      return response;
    }
    fail('invalid_response');
  }
  async #serviceLogin() {
    const deviceId = this.#login?.deviceId ?? this.#credentials?.deviceId ?? randomBytes(8).toString('hex');
    for (const [name, value] of [['sdkVersion', '3.8.6'], ['deviceId', deviceId]]) this.#cookies.set(`base-${name}`, { name, value, domain: 'account.xiaomi.com', path: '/', hostOnly: true, expiresAt: Infinity });
    return this.#account('/pass/serviceLogin?sid=xiaomiio&_json=true');
  }
  async #finish(auth, context = this.#login) {
    if (auth.location) await this.#follow(auth.location);
    if (context !== this.#login) fail('invalid_challenge');
    const userId = id(auth.userId) || this.#cookie('userId') || this.#cookie('userId', ACCOUNT);
    const serviceToken = this.#cookie('serviceToken');
    const credentials = this.#validateCredentials({ userId, serviceToken, ssecurity: auth.ssecurity,
      passToken: auth.passToken || this.#cookie('passToken', ACCOUNT), cUserId: auth.cUserId || this.#cookie('cUserId', ACCOUNT), deviceId: this.#login?.deviceId ?? this.#credentials?.deviceId });
    this.#credentials = credentials; this.#expired = false; this.clearLogin(); return null;
  }
  async #captcha(value) {
    const response = await this.#fetchBytes(accountUrl(value, 'captcha'), { cookies: true, limit: 512 * 1024 });
    if (response.status !== 200) fail('upstream_failure');
    const bytes = response.bytes;
    const type = bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])) ? 'jpeg' : bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'png' : undefined;
    if (!type || !this.#cookie('ick', ACCOUNT)) fail('invalid_response');
    return `data:image/${type};base64,${bytes.toString('base64')}`;
  }
  async login({ username, password, captcha } = {}) {
    if (this.#closed) fail('cancelled');
    if (username !== undefined || password !== undefined) {
      if (!bounded(username, 254) || !username.trim() || !bounded(password, 128) || !password) fail('invalid_request');
      this.clearLogin();
      this.#login = { username: username.trim(), passwordHash: createHash('md5').update(password).digest('hex').toUpperCase(), deviceId: randomBytes(8).toString('hex') };
      const context = this.#login, auth = await this.#serviceLogin();
      if (context !== this.#login) fail('invalid_challenge'); context.auth = auth;
    }
    if (!this.#login?.passwordHash || !this.#login.auth) fail('invalid_challenge');
    if (captcha !== undefined && (!bounded(captcha, 32) || !captcha.trim() || this.#challenge?.type !== 'captcha')) fail('invalid_challenge');
    const context = this.#login, auth = context.auth;
    const result = await this.#account('/pass/serviceLoginAuth2?_json=true', { user: this.#login.username, hash: this.#login.passwordHash,
      callback: auth.callback || '', sid: 'xiaomiio', qs: auth.qs || '', _sign: auth._sign || '', ...(captcha ? { captCode: captcha.trim() } : {}) });
    if (context !== this.#login) fail('invalid_challenge');
    if (result.location) return this.#finish(result, context);
    if (result.notificationUrl) {
      context.verifyUrl = accountUrl(result.notificationUrl, 'notification');
      const listUrl = new URL(context.verifyUrl); listUrl.pathname = '/identity/list';
      const options = await this.#account(listUrl.href);
      if (context !== this.#login) fail('invalid_challenge');
      if (!this.#cookie('identity_session', ACCOUNT)) fail('invalid_response');
      const flags = (Array.isArray(options.options) ? options.options : [options.flag]).filter(value => value === 4 || value === 8);
      if (!flags.length) fail('verification_unavailable');
      this.#login.methods = [...new Set(flags)].map(flag => ({ id: flag === 4 ? 'phone' : 'email', label: flag === 4 ? '手机短信' : '邮箱验证码' }));
      this.#challenge = { type: 'verification', methods: this.#login.methods, sent: false };
      return this.publicChallenge();
    }
    if (result.captchaUrl) {
      const image = await this.#captcha(result.captchaUrl);
      if (context !== this.#login) fail('invalid_challenge');
      this.#challenge = { type: 'captcha', image };
      return this.publicChallenge();
    }
    this.clearLogin();
    fail([20003, 70002, 70016].includes(result.code) ? 'invalid_credentials' : 'upstream_failure');
  }
  async sendVerification({ method, captcha } = {}) {
    if (this.#challenge?.type !== 'verification' || !this.#login?.methods.some(value => value.id === method)) fail('invalid_challenge');
    if (captcha !== undefined && (!bounded(captcha, 32) || !captcha.trim() || !this.#challenge.captchaImage)) fail('invalid_challenge');
    const flag = method === 'phone' ? 4 : 8, channel = method === 'phone' ? 'Phone' : 'Email';
    const probe = await this.#account(`/identity/auth/verify${channel}?_flag=${flag}&_json=true`);
    if (probe.code !== 0) fail('verification_unavailable');
    this.#login.method = method;
    const path = `/identity/auth/send${channel}Ticket?_dc=${Date.now()}`;
    const ick = this.#cookie('ick', ACCOUNT);
    const result = await this.#account(path, { _flag: String(flag), retry: '0', _json: 'true', icode: captcha?.trim() || '' },
      ick ? { headers: { Cookie: this.#cookieHeader(new URL(path, ACCOUNT)) + `; ick=${ick}` } } : {});
    this.#challenge = { type: 'verification', methods: this.#login.methods, sent: result.code === 0 };
    if (result.code === 0) return this.publicChallenge();
    if (result.code === 87001 && result.captchaUrl) { this.#challenge.captchaImage = await this.#captcha(result.captchaUrl); return this.publicChallenge(); }
    fail('upstream_failure');
  }
  async verify({ code } = {}) {
    if (this.#challenge?.type !== 'verification' || !this.#challenge.sent || !this.#login?.method || typeof code !== 'string' || !/^[A-Za-z0-9-]{4,12}$/.test(code)) fail('invalid_challenge');
    const flag = this.#login.method === 'phone' ? 4 : 8, channel = flag === 4 ? 'Phone' : 'Email';
    const result = await this.#account(`/identity/auth/verify${channel}?_dc=${Date.now()}`, { _flag: String(flag), ticket: code, trust: 'false', _json: 'true' });
    if (result.code !== 0) fail('verification_failed');
    if (!result.location) fail('invalid_response');
    const response = await this.#follow(result.location);
    const skipUrl = response.url.origin === ACCOUNT && response.url.pathname.startsWith('/fe/') ? response.url.searchParams.get('skipUrl') : undefined;
    if (skipUrl) await this.#follow(skipUrl);
    const auth = await this.#serviceLogin();
    return this.#finish(auth);
  }
  async #refresh() {
    if (this.#refreshing) return this.#refreshing;
    this.#refreshing = this.#refreshSession();
    try { return await this.#refreshing; } finally { this.#refreshing = undefined; }
  }
  async #refreshSession() {
    if (!this.#credentials?.passToken) fail('auth_expired');
    const saved = this.#credentials;
    this.#cookies.clear();
    for (const name of ['passToken', 'userId', 'cUserId']) if (saved[name]) this.#cookies.set(`refresh-${name}`, { name, value: saved[name], domain: 'account.xiaomi.com', path: '/', hostOnly: true, expiresAt: Infinity });
    try { const auth = await this.#serviceLogin(); if (auth.code !== 0 || !auth.ssecurity || !auth.location) fail('auth_expired'); await this.#finish(auth); }
    catch { this.#expired = true; this.clearLogin(); fail(this.#closed ? 'cancelled' : 'auth_expired'); }
  }
  async #cloud(path, data, readOnly = true, refreshed = false) {
    if (!this.#credentials) fail('auth_expired');
    const nonce = Buffer.alloc(12); randomBytes(8).copy(nonce); nonce.writeUInt32BE(Math.floor(Date.now() / 60000), 8);
    const encoded = encodeCloudRequest(path, data, this.#credentials.ssecurity, nonce.toString('base64'));
    const origin = this.region === 'cn' ? 'https://api.io.mi.com' : `https://${this.region}.api.io.mi.com`;
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded', 'MIOT-ENCRYPT-ALGORITHM': 'ENCRYPT-RC4', 'Accept-Encoding': 'identity', 'x-xiaomi-protocal-flag-cli': 'PROTOCAL-HTTP2',
      Cookie: `userId=${this.#credentials.userId}; serviceToken=${this.#credentials.serviceToken}; yetAnotherServiceToken=${this.#credentials.serviceToken}; deviceId=${this.#credentials.deviceId}; locale=zh_CN; channel=MI_APP_STORE` };
    const response = await this.#fetchBytes(new URL('/app' + path, origin), { method: 'POST', headers, body: encoded.body });
    let result;
    if (response.status === 200) {
      try { result = json(response.bytes); }
      catch { result = json(rc4Drop1024(encoded.key, Buffer.from(response.bytes.toString('utf8'), 'base64'))); }
    }
    if (response.status === 401 || result?.code === 3 || result?.code === 401) {
      this.#expired = true;
      if (readOnly && !refreshed) { await this.#refresh(); return this.#cloud(path, data, true, true); }
      fail('auth_expired');
    }
    if (response.status !== 200) fail('upstream_failure');
    if (!result || result.code !== undefined && result.code !== 0 || !Object.hasOwn(result, 'result')) fail('upstream_failure');
    return result.result;
  }
  async listHomes() {
    const result = await this.#cloud('/v2/homeroom/gethome_merged', { fg: true, fetch_share: true, fetch_share_dev: true, fetch_cariot: true, limit: 300, app_ver: 7, plat_form: 0 });
    if (!Array.isArray(result?.homelist) || result.homelist.length > 300) fail('invalid_response');
    const homes = new Map();
    const publicHomes = result.homelist.map(raw => {
      if (!raw || typeof raw !== 'object') fail('invalid_response');
      const homeId = id(raw.id); if (!homeId || !bounded(raw.name, 80) || !Array.isArray(raw.roomlist ?? [])) fail('invalid_response');
      if ((raw.roomlist?.length ?? 0) > 1000) fail('invalid_response');
      const rooms = (raw.roomlist ?? []).map(room => { const roomId = id(room?.id); if (!roomId || !bounded(room.name, 80) || !Array.isArray(room.dids ?? [])) fail('invalid_response'); return { id: roomId, name: room.name }; });
      const deviceRooms = new Map();
      for (const room of raw.roomlist ?? []) for (const did of room.dids ?? []) if (id(did)) deviceRooms.set(id(did), id(room.id));
      homes.set(homeId, { owner: raw.uid, rooms, deviceRooms });
      return { id: homeId, name: raw.name, rooms };
    });
    this.#homes = homes; return publicHomes;
  }
  async listDevices(homeId) {
    if (!this.#homes.has(homeId)) await this.listHomes();
    const home = this.#homes.get(homeId);
    if (!home || !Number.isSafeInteger(Number(homeId)) || !Number.isSafeInteger(Number(home.owner))) fail('invalid_request');
    const devices = []; let cursor = '';
    for (let n = 0; n < 20; n++) {
      const result = await this.#cloud('/home/home_device_list', { home_id: Number(homeId), home_owner: Number(home.owner), limit: 200, start_did: cursor, get_split_device: true, support_smart_home: true, get_cariot_device: true, get_third_device: true });
      if (!result || !Array.isArray(result.device_info) || result.device_info.length > 500) fail('invalid_response');
      for (const raw of result.device_info) {
        if (!raw || typeof raw !== 'object') fail('invalid_response');
        const deviceId = id(raw.did), roomId = id(raw.room_id ?? raw.roomId) || home.deviceRooms.get(deviceId) || '';
        if (!deviceId || !bounded(raw.name, 80) || !bounded(raw.model, 200) || !raw.model) fail('invalid_response');
        devices.push({ id: deviceId, name: raw.name, model: raw.model, ...(bounded(raw.spec_type, 300) && raw.spec_type ? { specType: raw.spec_type } : {}), online: raw.isOnline === true || raw.is_online === true,
          roomId, roomName: home.rooms.find(room => room.id === roomId)?.name || '' });
      }
      if (devices.length > 2000 || new Set(devices.map(device => device.id)).size !== devices.length) fail('invalid_response');
      if (!result.has_more) return devices;
      const next = id(result.max_did); if (!next || next === cursor) fail('invalid_response'); cursor = next;
      if (devices.length >= 2000) fail('invalid_response');
    }
    fail('invalid_response');
  }
  async getSpec({ model, specType } = {}) {
    if (!specType) {
      if (!bounded(model, 200) || !model) fail('invalid_request');
      if (!this.#modelSpecs) {
        const response = await this.#fetchBytes(new URL('/miot-spec-v2/instances?status=all', SPEC), { limit: 16 * 1024 * 1024 });
        if (response.status !== 200) fail('upstream_failure');
        const data = json(response.bytes); if (!Array.isArray(data.instances) || data.instances.length > 60000) fail('invalid_response');
        this.#modelSpecs = new Map();
        for (const value of [...data.instances].sort((a, b) => (b.ts || 0) - (a.ts || 0))) if (value.status === 'released' && bounded(value.model) && bounded(value.type, 300) && !this.#modelSpecs.has(value.model)) this.#modelSpecs.set(value.model, value.type);
      }
      specType = this.#modelSpecs.get(model); if (!specType) fail('unsupported_device');
    }
    if (!bounded(specType, 300) || !/^urn:miot-spec-v2:device:[A-Za-z0-9:._-]+$/.test(specType)) fail('invalid_request');
    if (!this.#specs.has(specType)) {
      const url = new URL('/miot-spec-v2/instance', SPEC); url.searchParams.set('type', specType);
      const response = await this.#fetchBytes(url); if (response.status !== 200) fail('upstream_failure');
      const data = json(response.bytes); if (!data || !Array.isArray(data.services) || data.services.length > 1000) fail('invalid_response');
      if (this.#specs.size >= 500) this.#specs.delete(this.#specs.keys().next().value);
      this.#specs.set(specType, data);
    }
    return structuredClone(this.#specs.get(specType));
  }
  #propertyParams(params, write) {
    if (!Array.isArray(params) || !params.length || params.length > 100 || params.some(value => !value || !bounded(value.did, 80) || !value.did || !Number.isInteger(value.siid) || value.siid < 1 || value.siid > 65535 || !Number.isInteger(value.piid) || value.piid < 1 || value.piid > 65535 || write && (!['boolean', 'number', 'string'].includes(typeof value.value) || typeof value.value === 'number' && !Number.isFinite(value.value) || typeof value.value === 'string' && !bounded(value.value, 1024)))) fail('invalid_request');
    return params.map(value => ({ did: value.did, siid: value.siid, piid: value.piid, ...(write ? { value: value.value } : {}) }));
  }
  async #properties(params, write) {
    const requested = this.#propertyParams(params, write);
    const result = await this.#cloud(write ? '/miotspec/prop/set' : '/miotspec/prop/get', { params: requested }, !write);
    const keys = new Set(requested.map(value => `${value.did}|${value.siid}|${value.piid}`));
    if (!Array.isArray(result) || result.length > requested.length || result.some(value => !value || !keys.has(`${value.did}|${value.siid}|${value.piid}`) || !Number.isInteger(value.code))) fail('invalid_response');
    return result.map(value => ({ did: value.did, siid: value.siid, piid: value.piid, code: value.code, ...(Object.hasOwn(value, 'value') ? { value: value.value } : {}) }));
  }
  getProperties(params) { return this.#properties(params, false); }
  setProperties(params) { return this.#properties(params, true); }
}
