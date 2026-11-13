import express from 'express';
import { createAuth, validateOrigin, authorizeHousehold, filterHouseholdState } from './auth.mjs';
import { z } from 'zod';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const app = express();
app.use(express.json({ limit: '32kb' }));
const dir = new URL('./data/', import.meta.url);
const file = new URL('state.json', dir);
const temp = new URL('state.tmp', dir);
const now = () => new Date().toISOString();
const initial = {
  devices: [
    { id: 'ceiling', name: '吸顶灯', room: '客厅', kind: 'light', on: true, level: 80 },
    { id: 'strip', name: '灯带', room: '客厅', kind: 'light', on: true, level: 50 },
    { id: 'floor', name: '落地灯', room: '客厅', kind: 'light', on: true, level: 60 },
    { id: 'ac', name: '空调', room: '客厅', kind: 'ac', on: false },
    { id: 'curtain', name: '窗帘', room: '客厅', kind: 'curtain', position: 'open' },
    { id: 'robot', name: '扫地机器人', room: '客厅', kind: 'robot', cleaning: false, battery: 92 },
    { id: 'dining', name: '餐厅吊灯', room: '餐厅', kind: 'light', on: false, level: 70 },
    { id: 'bed', name: '床头灯', room: '主卧', kind: 'light', on: false, level: 30 },
    { id: 'bath', name: '卫生间灯', room: '主卫', kind: 'light', on: false, level: 15 },
  ],
  rules: [
    { id: 'night', name: '起夜夜灯', trigger: '卫生间检测到活动', condition: '22:00–06:30', action: '卫生间灯开启，亮度 15%', enabled: true, runs: 0, lastRun: null },
    { id: 'temperature', name: '主卧温度守卫', trigger: '主卧温度升高', condition: '示例规则', action: '开启空调制冷', enabled: false, runs: 0, lastRun: null },
  ],
  greetings: { self: '欢迎回家，今天辛苦啦', partner: '欢迎回来，饭马上就好', child: '宝贝回来了，先去洗手哦', parents: '爸妈来啦，快进来坐', stranger: '检测到未识别的指纹' },
  speaker: '客厅小爱音箱',
  lightOn: true,
  events: [],
  accounts: [],
  expenses: [],
};
let state = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : initial;

function commit(change) {
  const draft = structuredClone(state);
  change(draft);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(temp, JSON.stringify(draft, null, 2), { mode: 0o600 });
  renameSync(temp, file);
  state = draft;
  return snapshot();
}

function snapshot() {
  const { accounts, ...rest } = state;
  return { ...rest, accounts: accounts.map(({ number, ...account }) => ({
    ...account, masked: '••••' + number.slice(-Math.min(4, number.length - 1)),
  })) };
}

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

const label = z.string().trim().min(1).max(80);
const members = z.enum(['self', 'partner', 'child', 'parents', 'stranger']);
const categories = z.enum(['电费', '水费', '燃气费', '移动话费', '联通话费', '电信话费']);

const auth = createAuth({ file: fileURLToPath(new URL('./data/auth.json', import.meta.url)) });
app.use('/api', validateOrigin);
app.use('/api/auth', auth.router);
app.use('/api', auth.requireAuth, authorizeHousehold);
app.use('/api', (req, res, next) => {
  if (req.user.role === 'guest') {
    const json = res.json.bind(res);
    res.json = payload => json(payload?.devices ? filterHouseholdState(payload, req.user) : payload);
  }
  next();
});

app.get('/api/state', (_req, res) => res.json(snapshot()));
app.patch('/api/devices/:id', (req, res) => {
  const command = z.discriminatedUnion('action', [
    z.object({ action: z.literal('power'), value: z.boolean() }),
    z.object({ action: z.literal('level'), value: z.number().int().min(1).max(100) }),
    z.object({ action: z.literal('position'), value: z.enum(['open', 'stop', 'closed']) }),
    z.object({ action: z.literal('clean'), value: z.boolean() }),
  ]).parse(req.body);
  res.json(commit((draft) => {
    const device = draft.devices.find(({ id }) => id === req.params.id);
    if (!device) fail(404, '设备不存在');
    if (command.action === 'power' && ['light', 'ac'].includes(device.kind)) device.on = command.value;
    else if (command.action === 'level' && device.kind === 'light') device.level = command.value;
    else if (command.action === 'position' && device.kind === 'curtain') device.position = command.value;
    else if (command.action === 'clean' && device.kind === 'robot') device.cleaning = command.value;
    else fail(400, '设备不支持此操作');
  }));
});
app.post('/api/scenes/:id', (req, res) => {
  const scene = z.enum(['home', 'away', 'sleep']).parse(req.params.id);
  res.json(commit((draft) => {
    for (const device of draft.devices) {
      if (device.kind === 'light') device.on = scene === 'home' ? device.room === '客厅' : scene === 'sleep' && device.id === 'bed';
      if (device.kind === 'curtain') device.position = scene === 'home' ? 'open' : 'closed';
      if (scene === 'away' && device.kind === 'ac') device.on = false;
    }
  }));
});
app.patch('/api/rules/:id', (req, res) => {
  const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
  res.json(commit((draft) => {
    const rule = draft.rules.find(({ id }) => id === req.params.id);
    if (!rule) fail(404, '规则不存在');
    rule.enabled = enabled;
  }));
});
app.put('/api/greetings', (req, res) => {
  const config = z.object({
    greetings: z.object({ self: label, partner: label, child: label, parents: label, stranger: label }),
    speaker: z.literal('客厅小爱音箱'),
    lightOn: z.boolean(),
    generate: z.boolean(),
  }).parse(req.body);
  res.json(commit((draft) => {
    draft.greetings = config.greetings;
    draft.speaker = config.speaker;
    draft.lightOn = config.lightOn;
    if (config.generate) {
      const action = config.lightOn ? '播报欢迎语并打开客厅灯' : '播报欢迎语';
      const existing = draft.rules.find(({ id }) => id === 'greeting');
      if (existing) existing.action = action;
      else draft.rules.push({
        id: 'greeting', name: '门锁指纹欢迎语', trigger: '收到门锁指纹事件', condition: '按家庭成员匹配',
        action, enabled: true, runs: 0, lastRun: null,
      });
    }
  }));
});
app.post('/api/simulations', (req, res) => {
  const { member } = z.object({ member: members }).parse(req.body);
  res.json(commit((draft) => {
    draft.events.unshift({ id: randomUUID(), message: draft.greetings[member], time: now() });
    draft.events = draft.events.slice(0, 20);
  }));
});
app.post('/api/accounts', (req, res) => {
  const account = z.object({ name: label, category: categories, number: z.string().trim().regex(/^[\dA-Za-z-]{4,32}$/) }).parse(req.body);
  res.status(201).json(commit((draft) => {
    if (draft.accounts.some((item) => item.category === account.category && item.number === account.number)) fail(409, '该账户已存在');
    draft.accounts.push({ id: randomUUID(), ...account });
  }));
});
app.post('/api/expenses', (req, res) => {
  const expense = z.object({
    category: categories,
    cents: z.number().int().positive().max(100_000_000),
    date: z.string().date(),
    note: z.string().trim().max(120),
  }).parse(req.body);
  res.status(201).json(commit((draft) => {
    draft.expenses.unshift({ id: randomUUID(), ...expense });
  }));
});
app.use('/api', (_req, res) => res.status(404).json({ message: '接口不存在' }));
const frontend = fileURLToPath(new URL('../frontend/dist/', import.meta.url));
app.use(express.static(frontend));
app.use((error, _req, res, _next) => {
  if (error instanceof z.ZodError || error.type === 'entity.parse.failed') {
    res.status(400).json({ message: '输入格式有误，请检查后重试' });
    return;
  }
  if (error.status >= 400 && error.status < 500) {
    res.status(error.status).json({ message: error.message });
    return;
  }
  console.error(error);
  res.status(500).json({ message: '保存失败，请重试' });
});
app.listen(3001, '127.0.0.1', () => console.log('Smart Home API: http://127.0.0.1:3001'));
