import { randomUUID } from 'node:crypto';
import { MijiaCloud } from './cloud.mjs';
import { MijiaProvider } from './index.mjs';

const fail = (status, message) => Object.assign(new Error(message), { status });
const messages = {
  invalid_credentials: '小米账号或密码不正确，请检查后重试',
  auth_expired: '米家授权已失效，请重新登录小米账号',
  invalid_captcha: '图片验证码不正确，请使用新图片重试',
  invalid_verification: '验证码不正确或已过期，请检查后重试',
  unsupported_verification: '此账号需要当前尚不支持的安全验证方式',
  verification_failed: '验证码不正确或已过期，请检查后重试',
  verification_unavailable: '此账号暂未提供可用的短信或邮箱验证方式',
  invalid_challenge: '登录验证已过期或步骤不匹配，请重新登录',
  cancelled: '此米家登录或连接已取消',
};
export function integrationError(error) {
  if (error?.status >= 400 && error.status <= 429) return error;
  return fail(['invalid_credentials', 'invalid_captcha', 'verification_failed'].includes(error?.code) ? 400 : 502, messages[error?.code] ?? '暂时无法连接米家服务，请稍后重试');
}

/** One server instance owns one household and one explicitly selected Xiaomi home. */
export class MijiaService {
  constructor({ vault, cachedDevices = [], onDevicesChanged = () => {}, cloudFactory = options => new MijiaCloud(options), providerFactory = options => new MijiaProvider(options), now = Date.now, pollIntervalMs = 15000, challengeTTL = 5 * 60 * 1000 }) {
    this.vault = vault; this.connection = vault.load();
    this.cachedDevices = cachedDevices.map(device => ({ ...device, state: { ...device.state, online: false } }));
    this.onDevicesChanged = onDevicesChanged; this.cloudFactory = cloudFactory; this.providerFactory = providerFactory;
    this.now = now; this.pollIntervalMs = pollIntervalMs; this.challengeTTL = challengeTTL;
    this.homes = []; this.generation = 0; this.closed = false; this.error = ''; this.lastLoginAt = -Infinity;
    if (this.connection) this.cloud = cloudFactory({ region: this.connection.credentials.region, credentials: this.connection.credentials });
  }
  async start() {
    if (!this.connection || this.closed) return;
    const generation = this.generation;
    const provider = this.createProvider(this.cloud, this.connection);
    this.provider = provider;
    try {
      // Start the provider first so a cold-start network failure still schedules recovery.
      await provider.start();
      if (generation !== this.generation || this.closed || provider !== this.provider) return;
      this.providerChanged(provider);
    } catch (error) {
      if (generation === this.generation && !this.closed) { this.error = integrationError(error).message; this.onDevicesChanged(); }
    }
    try {
      const homes = await this.cloud.listHomes();
      if (generation === this.generation && !this.closed && provider === this.provider) this.homes = homes;
    } catch { /* The already-started provider retains its bounded recovery timer. */ }
  }
  createProvider(cloud, connection) {
    let provider;
    provider = this.providerFactory({ cloud, homeId: connection.homeId, roomBindings: connection.roomBindings, cachedDevices: this.cachedDevices, pollIntervalMs: this.pollIntervalMs, onStatus: () => this.providerChanged(provider) });
    provider.subscribe(() => this.providerChanged(provider));
    return provider;
  }
  providerChanged(provider) {
    if (this.closed || provider !== this.provider) return;
    try {
      const credentials = this.cloud.exportCredentials();
      if (credentials && JSON.stringify(credentials) !== JSON.stringify(this.connection.credentials)) {
        const next = { ...this.connection, credentials }; this.vault.save(next); this.connection = next;
      }
      this.error = ''; this.cachedDevices = provider.snapshot(); this.onDevicesChanged();
    } catch { this.error = '米家状态或连接凭据保存失败，请检查存储后重试'; }
  }
  cleanLogin() {
    const candidate = this.candidate;
    if (candidate && (this.now() >= candidate.expiresAt || !candidate.authorized())) this.cancelLogin();
  }
  cancelLogin(owner) {
    if (!this.candidate || (owner && owner !== this.candidate.owner)) return;
    clearTimeout(this.candidate.timer); this.candidate.cloud.close(); this.candidate = undefined;
  }
  revokeInvalidLogin() { this.cleanLogin(); }
  snapshot() {
    if (!this.connection) return [];
    return structuredClone(this.provider ? this.provider.snapshot() : this.cachedDevices);
  }
  status(owner) {
    this.cleanLogin();
    const candidate = this.candidate?.owner === owner ? this.candidate : undefined;
    const provider = this.provider?.status();
    const state = candidate ? candidate.cloud.authenticated ? 'choose_home' : 'authorizing'
      : !this.connection ? 'unbound' : provider?.authExpired ? 'reauth_required' : provider?.connected ? 'connected'
        : this.homes.length && !this.homes.some(home => home.id === this.connection.homeId) ? 'choose_home' : 'offline';
    const homeId = candidate ? undefined : this.connection?.homeId;
    const homes = candidate ? candidate.homes : this.homes;
    const home = homes.find(value => value.id === homeId);
    const rooms = candidate ? [] : (home?.rooms ?? provider?.rooms ?? []).map(room => ({
      id: room.id, name: room.name,
      deviceCount: provider?.rooms?.find(value => value.id === room.id)?.deviceCount ?? 0,
      mappedRoomId: this.connection?.roomBindings[room.id]?.id,
      mappedRoomName: this.connection?.roomBindings[room.id]?.name,
    }));
    const challenge = candidate?.cloud.publicChallenge();
    return {
      state, region: candidate?.region ?? this.connection?.credentials.region ?? 'cn',
      ...(challenge ? { challenge: { ...challenge, ...(candidate.sentMethod ? { sentMethod: candidate.sentMethod } : {}), id: candidate.id, expiresAt: new Date(candidate.expiresAt).toISOString() } } : {}),
      homes: structuredClone(homes), ...(homeId ? { selectedHomeId: homeId } : {}), rooms,
      deviceCount: provider?.deviceCount ?? this.snapshot().length, unsupportedCount: provider?.unsupportedCount ?? 0,
      ...(provider?.lastSyncAt ? { lastSyncAt: provider.lastSyncAt } : {}), pollIntervalSeconds: this.pollIntervalMs / 1000,
      ...((candidate?.error || this.error || provider?.error) ? { error: candidate?.error || this.error || '米家同步暂不可用，请稍后刷新' } : {}),
    };
  }
  assertActor(actor) {
    if (this.closed || !actor.authorized()) throw fail(403, '当前家庭管理员会话已失效');
  }
  assertCandidate(id, actor) {
    this.cleanLogin(); this.assertActor(actor);
    const candidate = this.candidate;
    if (!candidate || candidate.id !== id || candidate.owner !== actor.id) throw fail(409, '登录验证已过期，请重新登录小米账号');
    if (candidate.busy) throw fail(409, '正在处理登录验证，请稍候');
    return candidate;
  }
  async login(input, actor) {
    this.assertActor(actor);
    if (this.configuring) throw fail(409, '正在配置米家连接，请稍候');
    if (this.now() - this.lastLoginAt < 3000) throw fail(429, '登录操作过于频繁，请稍后重试');
    this.lastLoginAt = this.now(); this.cancelLogin();
    const candidate = { id: randomUUID(), owner: actor.id, authorized: actor.authorized, expiresAt: this.now() + this.challengeTTL, region: input.region, cloud: this.cloudFactory({ region: input.region }), homes: [], busy: true, lastSendAt: -Infinity, attempts: 0 };
    this.candidate = candidate;
    candidate.timer = setTimeout(() => { if (this.candidate === candidate) this.cancelLogin(); }, this.challengeTTL); candidate.timer.unref?.();
    try {
      await candidate.cloud.login(input);
      await this.finishAuthentication(candidate, actor);
    } catch (error) {
      if (this.candidate === candidate) { candidate.error = integrationError(error).message; if (!candidate.cloud.publicChallenge() && !candidate.cloud.authenticated) this.cancelLogin(); }
      throw integrationError(error);
    } finally { candidate.busy = false; }
    return this.status(actor.id);
  }
  async finishAuthentication(candidate, actor) {
    this.assertActor(actor);
    if (this.candidate !== candidate || this.now() >= candidate.expiresAt) throw fail(409, '登录验证已过期，请重新登录');
    if (candidate.cloud.authenticated) { candidate.cloud.clearLogin(); candidate.homes = await candidate.cloud.listHomes(); }
    this.assertActor(actor);
    if (this.candidate !== candidate) throw fail(409, '此登录已取消');
    candidate.error = '';
  }
  async challenge(input, actor) {
    const candidate = this.assertCandidate(input.id, actor); candidate.busy = true;
    try {
      if (input.action === 'captcha') await candidate.cloud.login({ captcha: input.captcha });
      else if (input.action === 'send') {
        if (this.now() - candidate.lastSendAt < 60000) throw fail(429, '验证码已发送，请稍候再试');
        const lastSendAt = candidate.lastSendAt; candidate.lastSendAt = this.now();
        await candidate.cloud.sendVerification({ method: input.method, captcha: input.captcha });
        const next = candidate.cloud.publicChallenge();
        candidate.sentMethod = next?.sent ? input.method : undefined;
        if (next?.type === 'verification' && !next.sent && next.captchaImage) candidate.lastSendAt = lastSendAt;
      } else {
        if (++candidate.attempts > 5) throw fail(429, '验证尝试过多，请重新登录');
        await candidate.cloud.verify({ code: input.code });
      }
      await this.finishAuthentication(candidate, actor);
    } catch (error) { if (this.candidate === candidate) candidate.error = integrationError(error).message; throw integrationError(error); }
    finally { candidate.busy = false; }
    return this.status(actor.id);
  }
  async install(cloud, connection, actor, candidate) {
    this.assertActor(actor);
    if (this.configuring) throw fail(409, '正在配置米家连接，请稍候');
    this.configuring = true;
    const generation = this.generation, provider = this.createProvider(cloud, connection);
    try {
      await provider.start(); this.assertActor(actor);
      if (generation !== this.generation || (candidate && this.candidate !== candidate)) throw fail(409, '连接配置已取消，请重试');
      if (!provider.status().connected) throw fail(502, '米家设备暂时无法同步，请稍后重试');
      connection = { ...connection, credentials: cloud.exportCredentials() };
      this.vault.save(connection);
      const oldProvider = this.provider, oldCloud = this.cloud;
      this.generation++;
      this.connection = connection; this.provider = provider; this.cloud = cloud; this.cachedDevices = provider.snapshot();
      if (candidate) { clearTimeout(candidate.timer); this.homes = candidate.homes; this.candidate = undefined; }
      oldProvider?.close(); if (oldCloud && oldCloud !== cloud) oldCloud.close();
      this.error = ''; this.onDevicesChanged();
    } catch (error) { provider.close(); throw integrationError(error); }
    finally { this.configuring = false; }
    return this.status(actor.id);
  }
  async selectHome(homeId, actor) {
    this.cleanLogin(); this.assertActor(actor);
    const candidate = this.candidate;
    if (candidate && candidate.owner !== actor.id) throw fail(403, '此登录属于其他管理员');
    const cloud = candidate?.cloud ?? this.cloud, homes = candidate?.homes ?? this.homes;
    if (!cloud?.authenticated) throw fail(409, '请先登录小米账号');
    if (!homes.some(home => home.id === homeId)) throw fail(400, '请选择当前账号可访问的米家家庭');
    return this.install(cloud, { credentials: cloud.exportCredentials(), homeId, roomBindings: {} }, actor, candidate);
  }
  async setRooms(bindings, actor) {
    this.assertActor(actor);
    if (!this.connection || !this.cloud) throw fail(409, '请先连接米家家庭');
    if (this.candidate) throw fail(409, '请先完成或取消当前登录');
    const allowed = new Set(this.status(actor.id).rooms.map(room => room.id)), roomBindings = {};
    for (const binding of bindings) {
      if (!allowed.has(binding.providerRoomId) || Object.hasOwn(roomBindings, binding.providerRoomId)) throw fail(400, '房间不存在或重复，请刷新后重试');
      roomBindings[binding.providerRoomId] = { id: binding.roomId, name: binding.roomName };
    }
    return this.install(this.cloud, { ...this.connection, roomBindings }, actor);
  }
  async refresh(actor) {
    this.cleanLogin(); this.assertActor(actor);
    const candidate = this.candidate;
    if (candidate?.owner === actor.id && candidate.cloud.authenticated) {
      if (candidate.busy) throw fail(409, '正在处理米家登录');
      const homes = await candidate.cloud.listHomes(); this.assertActor(actor);
      if (this.candidate !== candidate) throw fail(409, '此登录已取消');
      candidate.homes = homes;
      return this.status(actor.id);
    }
    if (!this.cloud || !this.connection) return this.status(actor.id);
    const generation = this.generation, cloud = this.cloud;
    const homes = await cloud.listHomes(); this.assertActor(actor);
    if (generation !== this.generation || cloud !== this.cloud) throw fail(409, '米家连接已变更，请刷新后重试');
    this.homes = homes;
    await this.provider?.refresh(); this.assertActor(actor);
    return this.status(actor.id);
  }
  async executeCommand(id, command) {
    if (!this.connection || !this.provider || this.closed) throw fail(409, '米家尚未连接');
    return this.provider.executeCommand(id, command);
  }
  unlink(actor) {
    this.assertActor(actor);
    this.vault.save(null);
    this.generation++; this.cancelLogin(); this.provider?.close(); this.cloud?.close();
    this.provider = undefined; this.cloud = undefined; this.connection = null; this.cachedDevices = []; this.homes = []; this.error = '';
    this.onDevicesChanged();
    return this.status(actor.id);
  }
  close() { this.closed = true; this.generation++; this.cancelLogin(); this.provider?.close(); this.cloud?.close(); }
}
