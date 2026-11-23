import { isDeepStrictEqual } from 'node:util';
import { Device, validateDeviceState, deviceError } from '../../domain/devices/model.mjs';
import { createDeviceMapping, commandToProperty, readDeviceState } from './mapping.mjs';

const failure = error => Object.assign(deviceError(error?.code === 'auth_expired' ? 409 : 502,
  error?.code === 'auth_expired' ? '米家授权已失效，请重新登录' : '暂时无法同步米家设备，请稍后重试'), { code: error?.code === 'auth_expired' ? 'auth_expired' : 'upstream_failure' });

/** The personal cloud interface is polled on the server; clients still consume SSE. */
export class MijiaProvider {
  #cloud; #homeId; #bindings; #devices = new Map(); #mappings = new Map(); #specs = new Map(); #listeners = new Set();
  #stopped = true; #generation = 0; #timer; #flight; #commandBusy = false; #failures = 0; #rooms = [];
  #lastSyncAt; #error; #authExpired = false; #unsupported = 0; #onStatus; #pollInterval;
  connected = false;
  constructor({ cloud, homeId, roomBindings = {}, cachedDevices = [], pollIntervalMs = 15000, onStatus }) {
    if (!cloud || typeof homeId !== 'string' || !homeId) throw deviceError(400, '请先选择米家家庭');
    this.#cloud = cloud; this.#homeId = homeId; this.#bindings = structuredClone(roomBindings); this.#onStatus = onStatus;
    this.#pollInterval = Math.max(20, Math.min(Number(pollIntervalMs) || 15000, 300000));
    for (const entry of cachedDevices) {
      try {
        const { state, ...metadata } = entry;
        const device = Device.parse(metadata);
        if (device.providerId !== 'mijia' || state?.source !== 'mijia' || device.id !== `mi:${device.providerDeviceId}`) continue;
        this.#devices.set(device.providerDeviceId, { ...device, state: validateDeviceState(device, { ...state, source: 'mijia', online: false }) });
      } catch { /* Invalid cache entries never become live devices. */ }
    }
  }
  status() {
    return structuredClone({ connected: this.connected, deviceCount: this.#devices.size, unsupportedCount: this.#unsupported,
      rooms: this.#rooms, ...(this.#lastSyncAt ? { lastSyncAt: this.#lastSyncAt } : {}),
      ...(this.#error ? { error: this.#error } : {}), authExpired: this.#authExpired });
  }
  snapshot() { return structuredClone([...this.#devices.values()].map(device => ({ ...device, state: { ...device.state, online: device.state.online && this.connected } }))); }
  subscribe(handler) { this.#listeners.add(handler); return () => this.#listeners.delete(handler); }
  #emit(event) { if (!this.#stopped) for (const listener of this.#listeners) listener(structuredClone(event)); }
  #valid(generation) { return !this.#stopped && generation === this.#generation; }
  #schedule() {
    clearTimeout(this.#timer);
    if (this.#stopped || this.#commandBusy || this.#authExpired) return;
    this.#timer = setTimeout(() => { void this.refresh().catch(() => {}); }, Math.min(this.#pollInterval * 2 ** this.#failures, 120000));
    this.#timer.unref();
  }
  async start() {
    if (this.#stopped) { this.#stopped = false; this.#generation++; }
    await this.refresh(); return this.snapshot();
  }
  refresh() {
    if (this.#stopped) return Promise.reject(deviceError(409, '米家连接已关闭'));
    if (this.#flight) return this.#flight;
    clearTimeout(this.#timer);
    const generation = this.#generation;
    const flight = this.#sync(generation).finally(() => {
      if (this.#flight === flight) { this.#flight = undefined; this.#schedule(); }
    });
    this.#flight = flight; return flight;
  }
  async #sync(generation) {
    try {
      if (!this.#cloud.authenticated) throw Object.assign(Error(), { code: 'auth_expired' });
      const rawDevices = await this.#cloud.listDevices(this.#homeId);
      if (!this.#valid(generation)) return;
      if (!Array.isArray(rawDevices) || rawDevices.length > 1000 || new Set(rawDevices.map(device => device.id)).size !== rawDevices.length) throw Error();
      const mappings = new Map(); let unsupported = 0, cursor = 0;
      const load = async () => {
        while (cursor < rawDevices.length && this.#valid(generation)) {
          const raw = rawDevices[cursor++], key = raw.specType || raw.model;
          if (typeof key !== 'string' || !key) { unsupported++; continue; }
          let spec = this.#specs.get(key);
          if (!spec) {
            try { spec = await this.#cloud.getSpec({ model: raw.model, specType: raw.specType }); }
            catch (error) { if (['unsupported_device', 'spec_not_found'].includes(error?.code)) { unsupported++; continue; } throw error; }
            if (!this.#valid(generation)) return;
            if (this.#specs.size >= 256) this.#specs.delete(this.#specs.keys().next().value);
            this.#specs.set(key, spec);
          }
          const mapping = createDeviceMapping(raw, spec, { homeId: this.#homeId, roomBindings: this.#bindings });
          if (mapping) mappings.set(raw.id, { raw, mapping }); else unsupported++;
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, rawDevices.length) }, load));
      if (!this.#valid(generation)) return;
      const requests = [...mappings.values()].flatMap(({ raw, mapping }) => raw.online === true ? mapping.reads : []);
      const results = [];
      for (let start = 0; start < requests.length; start += 50) {
        const response = await this.#cloud.getProperties(requests.slice(start, start + 50));
        if (!this.#valid(generation)) return;
        if (!Array.isArray(response)) throw Error();
        results.push(...response);
      }
      const timestamp = new Date().toISOString(), devices = new Map(), rooms = new Map();
      for (const { raw, mapping } of mappings.values()) {
        devices.set(raw.id, { ...mapping.device, state: readDeviceState(mapping, results, { online: raw.online === true, previous: this.#devices.get(raw.id)?.state, now: timestamp }) });
      }
      for (const raw of rawDevices) {
        if (!raw.roomId) continue;
        const room = rooms.get(raw.roomId) ?? { id: raw.roomId, name: raw.roomName || '未命名房间', deviceCount: 0 };
        room.deviceCount++; rooms.set(raw.roomId, room);
      }
      const previous = this.#devices;
      this.#devices = devices; this.#mappings = new Map([...mappings].map(([id, value]) => [id, value.mapping]));
      this.#rooms = [...rooms.values()]; this.#lastSyncAt = timestamp; this.#unsupported = unsupported;
      this.connected = true; this.#failures = 0; this.#authExpired = false; this.#error = undefined;
      for (const [id, entry] of devices) {
        if (!isDeepStrictEqual(previous.get(id), entry)) { const { state, ...device } = entry; this.#emit({ device, state }); }
      }
      for (const [id, entry] of previous) if (!devices.has(id)) this.#emit({ removedDeviceId: entry.id });
      this.#onStatus?.(this.status());
    } catch (error) {
      if (!this.#valid(generation)) return;
      const safe = failure(error);
      this.#generation++; // Other discovery requests from this failed pass must stop before continuing.
      this.connected = false; this.#failures = Math.min(this.#failures + 1, 5); this.#authExpired = safe.code === 'auth_expired'; this.#error = safe.message;
      for (const [id, entry] of this.#devices) if (entry.state.online) {
        const state = { ...entry.state, online: false }; this.#devices.set(id, { ...entry, state });
        const { state: _old, ...device } = entry; this.#emit({ device, state });
      }
      this.#onStatus?.(this.status()); throw safe;
    }
  }
  async discoverOrListDevices() { await this.refresh(); return this.snapshot().map(({ state, ...device }) => device); }
  async getDeviceState(id) { await this.refresh(); const device = this.#devices.get(id); if (!device) throw deviceError(404, '设备不存在或不受支持'); return structuredClone(device.state); }
  async executeCommand(id, command) {
    if (this.#commandBusy) throw deviceError(409, '米家设备正在执行其他操作，请稍后重试');
    if (this.#stopped) throw deviceError(409, '米家连接已关闭');
    this.#commandBusy = true; clearTimeout(this.#timer);
    const generation = this.#generation;
    try {
      await this.refresh();
      if (!this.#valid(generation)) throw deviceError(409, '米家连接已关闭');
      const mapping = this.#mappings.get(id), device = this.#devices.get(id);
      if (!mapping || !device) throw deviceError(404, '设备不存在或不受支持');
      const property = commandToProperty(mapping, device.state, command);
      let results;
      try { results = await this.#cloud.setProperties([property]); }
      catch (error) { throw failure(error); }
      if (!this.#valid(generation)) throw deviceError(409, '米家连接已关闭');
      if (!Array.isArray(results) || !results.some(result => result?.did === id && result.siid === property.siid && result.piid === property.piid && result.code === 0)) throw deviceError(502, '米家未确认接收设备命令');
      // Read back the device report; an accepted target is not a physical state update.
      await this.refresh();
      const current = this.#devices.get(id); if (!current) throw deviceError(404, '设备已移除');
      return structuredClone(current.state);
    } catch (error) {
      if (error?.status && !['auth_expired', 'upstream_failure'].includes(error.code) && [400, 404, 409, 502].includes(error.status)) throw error;
      const safe = failure(error);
      if (this.#valid(generation)) {
        this.connected = false; this.#failures = Math.min(this.#failures + 1, 5); this.#authExpired = safe.code === 'auth_expired'; this.#error = safe.message;
        for (const entry of this.snapshot()) { this.#devices.set(entry.providerDeviceId, entry); const { state, ...device } = entry; this.#emit({ device, state }); }
        this.#onStatus?.(this.status());
      }
      throw safe;
    } finally { this.#commandBusy = false; this.#schedule(); }
  }
  close() { this.#stopped = true; this.connected = false; this.#generation++; clearTimeout(this.#timer); }
}
