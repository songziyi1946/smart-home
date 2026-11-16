import WebSocket from 'ws';
import { mapEntity, commandToService, deviceId } from './mapping.mjs';
import { deviceError } from '../../domain/devices/model.mjs';

/** Server-only REST/WS adapter. No raw HA attributes or credentials leave this class. */
export class HomeAssistantProvider {
  #token;
  constructor({ url, token, rooms = {}, cachedDevices = [], entityPrefix = '', timeoutMs = 5000, reconnectMs = 1000 }) {
    this.url = new URL(url);
    if (!['http:', 'https:'].includes(this.url.protocol) || this.url.username || this.url.password || this.url.search || this.url.hash) throw new Error('HA_URL 必须是无凭据的 HTTP(S) 地址');
    if (!token?.trim()) throw new Error('未配置 HA_TOKEN');
    if (!this.url.pathname.endsWith('/')) this.url.pathname += '/';
    this.#token = token;
    this.rooms = rooms;
    this.cachedDevices = cachedDevices.filter(d=>!entityPrefix || d.providerDeviceId.split('.')[1]?.startsWith(entityPrefix));
    this.entityPrefix = entityPrefix;
    this.timeoutMs = timeoutMs;
    this.reconnectMs = reconnectMs;
    this.entities = new Map();
    this.eventVersions = new Map();
    this.listeners = new Set();
    this.connected = false;
    this.stopped = true;
    this.attempts = 0;
  }
  accepts(entity) { return !this.entityPrefix || entity.entity_id?.split('.')[1]?.startsWith(this.entityPrefix); }
  async request(path, body) {
    let response;
    try {
      response = await fetch(new URL(`api/${path}`, this.url), {
        method: body === undefined ? 'GET' : 'POST', redirect: 'error',
        headers: { Authorization: `Bearer ${this.#token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch { throw deviceError(502, 'Home Assistant 连接失败或超时'); }
    if (!response.ok) throw deviceError(response.status === 404 ? 404 : 502,
      response.status === 401 || response.status === 403 ? 'Home Assistant 认证失败' : 'Home Assistant 请求失败');
    try { return await response.json(); } catch { throw deviceError(502, 'Home Assistant 响应格式错误'); }
  }
  normalize(entity) {
    if (entity?.entity_id?.startsWith('climate.')) return { ...entity, attributes: { ...entity.attributes, temperature_unit: entity.attributes?.temperature_unit ?? this.temperatureUnit ?? '°C' } };
    return entity;
  }
  mapped(entity) {
    if (!this.accepts(entity)) return null;
    try { return mapEntity(entity, this.rooms); } catch { return null; }
  }
  emit(event) { for (const listener of this.listeners) listener(structuredClone(event)); }
  ingest(entityId, entity) {
    entity = this.normalize(entity);
    if(entity){
      const previous=this.entities.get(entityId);
      const persisted=this.cachedDevices.find(d=>d.providerDeviceId===entityId)?.state;
      const online=!['unavailable','unknown'].includes(entity.state);
      entity={...entity,attributes:{...entity.attributes,
        source:entity.attributes?.source??previous?.attributes?.source??(persisted?.source==='simulator'?'simulator':undefined),
        last_seen:entity.attributes?.last_seen??(online?entity.last_updated:previous?.attributes?.last_seen??persisted?.lastSeenAt),
      }};
    }
    if (!entity || !this.mapped(entity)) {
      if (this.entities.delete(entityId)) this.emit({ removedDeviceId: deviceId(entityId) });
      return;
    }
    const old = this.entities.get(entityId);
    if (old && Date.parse(old.last_updated) > Date.parse(entity.last_updated)) return;
    this.entities.set(entityId, entity);
    this.emit(this.mapped(entity));
  }
  async discoverOrListDevices() {
    const config = await this.request('config');
    this.temperatureUnit = config.unit_system?.temperature ?? '°C';
    const states = await this.request('states');
    if (!Array.isArray(states)) throw deviceError(502, 'Home Assistant 设备列表格式错误');
    const ids = new Set(states.map(entity => entity.entity_id));
    for (const entity of states) this.ingest(entity.entity_id, entity);
    for (const id of this.entities.keys()) if (!ids.has(id)) this.ingest(id, null);
    return [...this.entities.values()].map(entity => this.mapped(entity).device);
  }
  async getDeviceState(id) {
    if (!/^[a-z_]+\.[a-z0-9_]+$/.test(id)) throw deviceError(404, '设备不存在');
    if (id.startsWith('climate.') && !this.temperatureUnit) {
      const config = await this.request('config');
      this.temperatureUnit = config.unit_system?.temperature ?? '°C';
    }
    const version = this.eventVersions.get(id);
    const entity = this.normalize(await this.request(`states/${encodeURIComponent(id)}`));
    if (entity?.entity_id !== id) throw deviceError(502, 'Home Assistant 设备响应不匹配');
    const mapped = this.mapped(entity);
    if (!mapped) throw deviceError(404, '设备不存在或不受支持');
    if (version === this.eventVersions.get(id)) this.ingest(id, entity);
    const current = this.entities.get(id);
    if (!current) throw deviceError(404, '设备已移除');
    return this.mapped(current).state;
  }
  async executeCommand(id, command) {
    await this.getDeviceState(id);
    const { domain, service, data } = commandToService(this.entities.get(id), command);
    await this.request(`services/${domain}/${service}`, data);
    // A service acknowledgement is not physical state confirmation; read actual HA state.
    return this.getDeviceState(id);
  }
  snapshot() {
    const live = [...this.entities.values()].map(entity => {
      const { device, state } = this.mapped(entity);
      return { ...device, state: { ...state, online: state.online && this.connected } };
    });
    if(this.connected){this.cachedDevices=live;return live;}
    const ids=new Set(live.map(d=>d.id));
    return [...live,...this.cachedDevices.filter(d=>!ids.has(d.id)).map(d=>({...d,state:{...d.state,online:false}}))];
  }
  subscribe(handler) {
    this.listeners.add(handler);
    if (this.stopped) { this.stopped = false; this.connect(); }
    return () => { this.listeners.delete(handler); if (!this.listeners.size) this.close(); };
  }
  connect() {
    if (this.stopped) return;
    const url = new URL('api/websocket', this.url);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url);
    this.socket = socket;
    let buffer = [];
    let syncing = true;
    let live = true;
    const timer = setTimeout(() => socket.terminate(), this.timeoutMs * 3);
    timer.unref();
    let heartbeat;
    socket.on('pong', () => { live = true; });
    socket.on('message', async raw => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { socket.terminate(); return; }
      if (message.type === 'auth_required') socket.send(JSON.stringify({ type: 'auth', access_token: this.#token }));
      else if (message.type === 'auth_invalid') socket.terminate();
      else if (message.type === 'auth_ok') socket.send(JSON.stringify({ id: 1, type: 'subscribe_events', event_type: 'state_changed' }));
      else if (message.type === 'result' && message.id === 1) {
        if (!message.success) { socket.terminate(); return; }
        try {
          await this.discoverOrListDevices();
          if (this.socket !== socket || socket.readyState !== WebSocket.OPEN || this.stopped) return;
          for (const event of buffer) this.ingest(event.entity_id, event.new_state);
          buffer = []; syncing = false; this.connected = true; this.attempts = 0;
          clearTimeout(timer);
          for (const entity of this.entities.values()) this.emit(this.mapped(entity));
          heartbeat = setInterval(() => { if (!live) socket.terminate(); else { live = false; socket.ping(); } }, 30000);
          heartbeat.unref();
        } catch { socket.terminate(); }
      } else if (message.type === 'event' && message.id === 1 && message.event?.event_type === 'state_changed') {
        const event = message.event.data;
        if (!event?.entity_id) return;
        this.eventVersions.set(event.entity_id, (this.eventVersions.get(event.entity_id) ?? 0) + 1);
        if (syncing) {
          if (buffer.length >= 10000) { socket.terminate(); return; }
          buffer.push(event);
        } else this.ingest(event.entity_id, event.new_state);
      }
    });
    socket.on('error', () => {}); // Never log socket errors containing connection details.
    socket.on('close', () => {
      clearTimeout(timer); clearInterval(heartbeat);
      if (this.socket !== socket) return;
      this.connected = false;
      for (const { state, ...device } of this.snapshot()) this.emit({ device, state });
      if (!this.stopped) {
        this.retry = setTimeout(() => this.connect(), Math.min(this.reconnectMs * 2 ** this.attempts++, 30000));
        this.retry.unref();
      }
    });
  }
  close() {
    this.stopped = true; this.connected = false;
    clearTimeout(this.retry);
    this.socket?.terminate();
  }
}
