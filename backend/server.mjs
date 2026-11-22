import {clientAddressPolicy} from './app/client-address.mjs';
import {loadStorageKey} from './infrastructure/encryption.mjs';
import {acquireDataLock} from './infrastructure/data-lock.mjs';
import { deploymentSecurity, isLocalRequest } from './app/deployment-security.mjs';
import {isDeepStrictEqual} from 'node:util';
import {SQLiteStore} from './infrastructure/sqlite-store.mjs';
import { initializeAutomations, validateRule, evaluateRule, createAutomationEngine } from './domain/automations/engine.mjs';
import { initializeScenes, validateScene, createRun, executeRun } from './domain/scenes/service.mjs';
import { createStateStream } from './app/state-stream.mjs';
import { HomeAssistantProvider } from './providers/home-assistant/index.mjs';
import { initializeDevices, deviceSnapshot, executeDeviceCommand } from './domain/devices/service.mjs';
import { parseDeviceCommand, DeviceState } from './domain/devices/model.mjs';
import express from 'express';
import { createAuth, validateOrigin, authorizeHousehold, filterHouseholdState } from './auth.mjs';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';

const app = express();
const security = deploymentSecurity();
const clientAddress = clientAddressPolicy();
// HTTPS deployment is explicit: never trust arbitrary forwarded headers.
if (!security.allowSkipLogin && process.argv.includes('--skip-login')) throw new Error('Production or HTTPS deployment cannot skip login');
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
    'Referrer-Policy': 'no-referrer',
  });
  next();
});
app.use(express.json({ limit: '32kb' }));
const dir = process.env.SMART_HOME_DATA_DIR
  ? pathToFileURL(resolve(process.env.SMART_HOME_DATA_DIR) + sep)
  : new URL('./data/', import.meta.url);
const now = () => new Date().toISOString();
const initial = {
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
const normalize = input => initializeAutomations(initializeScenes(initializeDevices({...structuredClone(initial),...input})));
const releaseDataLock = acquireDataLock(fileURLToPath(dir));
const encryptionKey = loadStorageKey(fileURLToPath(dir));
const store = new SQLiteStore(fileURLToPath(dir),{initialState:initial,normalize,encryptionKey});
const storedState=store.loadState();
let state=normalize(storedState);
if(!isDeepStrictEqual(state,storedState))store.saveState(state);
let cachedProviderDevices=store.loadProviderDevices();
const ha = process.env.HA_URL ? new HomeAssistantProvider({
  url: process.env.HA_URL, token: process.env.HA_TOKEN,
  entityPrefix: process.env.HA_ENTITY_PREFIX || '',
  cachedDevices: cachedProviderDevices,
  rooms: process.env.HA_ROOMS_FILE ? JSON.parse(readFileSync(process.env.HA_ROOMS_FILE, 'utf8')) : {},
}) : undefined;
let stream, automation;
function observeDevices(){try{automation?.observe(snapshot().devices);}catch{console.error('自动化事件处理或日志保存失败');}}
ha?.subscribe(() => {
  if(ha.connected){const next=ha.snapshot();try{store.saveProviderDevices(next);cachedProviderDevices=next;}catch{console.error('Provider 状态缓存保存失败');}}
  stream?.publish();observeDevices();
});


function commit(change) {
  const draft = structuredClone(state);
  change(draft);
  store.saveState(draft);
  state = draft;
  stream?.publish();
  observeDevices();
  return snapshot();
}

function snapshot() {
  const { accounts, devices, deviceStates, ...rest } = state;
  return { ...rest, devices: [...deviceSnapshot(state), ...(ha ? ha.snapshot() : cachedProviderDevices)], accounts: accounts.map(({ number, ...account }) => ({
    ...account, masked: '••••' + number.slice(-Math.min(4, number.length - 1)),
  })) };
}

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

const label = z.string().trim().min(1).max(80);
const members = z.enum(['self', 'partner', 'child', 'parents', 'stranger']);
const categories = z.enum(['电费', '水费', '燃气费', '移动话费', '联通话费', '电信话费']);

const skipLogin = process.argv.includes('--skip-login');
let sessionFor, subscribeAuth, activeAdmin;
const testTime=process.env.SMART_HOME_AUTOMATION_TEST_TIME;
if(testTime && (process.env.NODE_ENV!=='test' || !skipLogin || !Number.isFinite(Date.parse(testTime)))) throw new Error('自动化测试时钟仅允许 NODE_ENV=test 的本机免登录测试');
app.use('/api', validateOrigin);
if (skipLogin) {
  sessionFor = req => isLocalRequest(req) ? {user:req.user,expiresAt:Infinity} : undefined;
  activeAdmin = id => id === 'local';
  const localUser = { id: 'local', username: 'local', displayName: '本地预览', role: 'admin' };
  app.use('/api', (req, res, next) => {
    if (!isLocalRequest(req)) {
      return res.status(403).json({ message: '免登录模式仅限本机访问' });
    }
    req.user = localUser;
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.get('/api/auth/session', (_req, res) => res.json({
    localPreview: true, user: localUser, household: { id: 'local', name: '本地家庭' },
  }));
} else {
  const auth = createAuth({ clientAddress, allowSetup: security.allowSetup, secureCookies: security.secureCookies, repository: {load:()=>store.loadAuth(),save:data=>store.saveAuth(data),create:data=>store.saveAuth(data,{create:true})} });
  activeAdmin = auth.isActiveAdmin;
  sessionFor = auth.sessionFor; subscribeAuth = auth.subscribeSessions;
  app.use('/api/auth', auth.router);
  app.use('/api', auth.requireAuth);
}
app.use('/api', authorizeHousehold);
app.use('/api', (req, res, next) => {
  if (req.user.role === 'guest') {
    const json = res.json.bind(res);
    res.json = payload => json(payload?.devices ? filterHouseholdState(payload, req.user) : payload);
  }
  next();
});

stream = createStateStream({ snapshot, sessionFor, subscribeAuth });
app.get('/api/events', stream.route);
app.get('/api/state', (_req, res) => res.json(snapshot()));
app.patch('/api/devices/:id', async (req, res) => {
  const command = parseDeviceCommand(req.body);
  if (req.params.id.startsWith('ha:')) {
    if (!ha) fail(404, '设备不存在');
    await ha.executeCommand(req.params.id.slice(3), command);
    return res.json(snapshot());
  }
  res.json(commit(draft => executeDeviceCommand(draft, req.params.id, command)));
});
app.post('/api/scenes', (req, res) => {
  const input=validateScene(req.body,snapshot().devices);
  res.status(201).json(commit(draft=>{if(draft.scenes.length>=100)fail(400,'场景数量已达上限');draft.scenes.push({id:randomUUID(),...input,version:1});}));
});
app.put('/api/scenes/:id', (req,res)=>{
  const {version,...body}=z.object({version:z.number().int().positive()}).passthrough().parse(req.body);
  const input=validateScene(body,snapshot().devices);
  res.json(commit(draft=>{const index=draft.scenes.findIndex(s=>s.id===req.params.id);if(index<0)fail(404,'场景不存在');if(draft.scenes[index].version!==version)fail(409,'场景已被修改，请重新打开编辑');draft.scenes[index]={id:req.params.id,...input,version:version+1};}));
});
app.delete('/api/scenes/:id',(req,res)=>res.json(commit(draft=>{const index=draft.scenes.findIndex(s=>s.id===req.params.id);if(index<0)fail(404,'场景不存在');draft.scenes.splice(index,1);} )));
let runningScene=false;
async function runScene(sceneId,actorId,authorized){
  const scene=state.scenes.find(s=>s.id===sceneId);if(!scene)fail(404,'场景不存在');if(runningScene)fail(409,'已有场景正在执行，请稍后重试');
  runningScene=true;
  try{
    const run=createRun(scene,actorId);
    const save=value=>commit(draft=>{const index=draft.sceneRuns.findIndex(r=>r.id===value.id);if(index<0)draft.sceneRuns.unshift(structuredClone(value));else draft.sceneRuns[index]=structuredClone(value);draft.sceneRuns=draft.sceneRuns.slice(0,50);});
    save(run);
    await executeRun(run,{authorized,save,execute:async(id,command)=>{
      const device=snapshot().devices.find(d=>d.id===id);if(!device)fail(404,'设备不存在或 Provider 未连接');
      if(!device.capabilities.includes(command.capability))fail(400,'设备不支持此操作');
      if(!device.state.online)fail(409,'设备已离线');
      if(device.providerId==='mock')commit(draft=>executeDeviceCommand(draft,id,command));
      else if(device.providerId==='home-assistant'&&ha)await ha.executeCommand(device.providerDeviceId,command);
      else fail(400,'设备 Provider 不可用');
    }});
    return run;
  }finally{runningScene=false;}
}
app.post('/api/scenes/:id',async(req,res)=>res.json({run:await runScene(req.params.id,req.user.id,()=>!!sessionFor(req))}));
automation=createAutomationEngine({rules:()=>state.automations,executeScene:runScene,authorized:id=>activeAdmin(id),now:()=>testTime?new Date(testTime):new Date(),save:run=>commit(draft=>{const i=draft.automationRuns.findIndex(r=>r.id===run.id);if(i<0)draft.automationRuns.unshift(structuredClone(run));else draft.automationRuns[i]=structuredClone(run);draft.automationRuns=draft.automationRuns.slice(0,100);})});
automation.observe(snapshot().devices);
app.post('/api/automations/preview',(req,res)=>{
 const body=z.object({rule:z.unknown(),event:z.object({from:z.union([z.boolean(),z.number(),z.string()]),to:z.union([z.boolean(),z.number(),z.string()])}).strict(),at:z.string().datetime({offset:true}).optional()}).strict().parse(req.body);
 const rule=validateRule(body.rule,snapshot().devices,state.scenes);
 DeviceState.shape.values.shape[rule.trigger.capability].parse(body.event.from);DeviceState.shape.values.shape[rule.trigger.capability].parse(body.event.to);
 res.json({...evaluateRule(rule,{...body.event,deviceId:rule.trigger.deviceId,capability:rule.trigger.capability},body.at?new Date(body.at):new Date()),scene:state.scenes.find(s=>s.id===rule.action.sceneId),note:'预览不执行动作；实际执行还会检查冷却、并发、授权与设备状态'});
});
app.post('/api/automations',(req,res)=>{const input=validateRule(req.body,snapshot().devices,state.scenes);res.status(201).json(commit(draft=>{if(draft.automations.length>=100)fail(400,'自动化数量已达上限');draft.automations.push({id:randomUUID(),...input,version:1,createdBy:req.user.id});}));});
app.put('/api/automations/:id',(req,res)=>{const {version,...body}=z.object({version:z.number().int().positive()}).passthrough().parse(req.body);const input=validateRule(body,snapshot().devices,state.scenes);res.json(commit(draft=>{const rule=draft.automations.find(r=>r.id===req.params.id);if(!rule)fail(404,'规则不存在');if(rule.version!==version)fail(409,'规则已被修改，请重新打开');Object.assign(rule,input,{version:version+1,createdBy:req.user.id});}));});
app.patch('/api/automations/:id',(req,res)=>{const {enabled}=z.object({enabled:z.boolean()}).strict().parse(req.body);res.json(commit(draft=>{const rule=draft.automations.find(r=>r.id===req.params.id);if(!rule)fail(404,'规则不存在');if(enabled)validateRule((({id,version,createdBy,...input})=>input)(rule),snapshot().devices,state.scenes);rule.enabled=enabled;rule.version++;}));});
app.delete('/api/automations/:id',(req,res)=>res.json(commit(draft=>{const i=draft.automations.findIndex(r=>r.id===req.params.id);if(i<0)fail(404,'规则不存在');draft.automations.splice(i,1);} )));
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
  if (error.status >= 400 && error.status <= 502) {
    res.status(error.status).json({ message: error.message });
    return;
  }
  console.error(error);
  res.status(500).json({ message: '保存失败，请重试' });
});
const port = Number(process.env.SMART_HOME_API_PORT || 3101);
const server = app.listen(port, process.env.SMART_HOME_API_HOST || '127.0.0.1', error => {
  if (error) {
    console.error(error.code === 'EADDRINUSE'
      ? `Smart Home API 端口 ${port} 已被占用，请为前后端设置相同的 SMART_HOME_API_PORT。`
      : error);
    process.exitCode = 1;
    return;
  }
  const url = `http://127.0.0.1:${server.address().port}`;
  console.log(`Smart Home API: ${url}${skipLogin ? '（本地免登录）' : ''}`);
  if (process.argv.includes('--open-browser')) {
    const [command, ...args] = process.platform === 'win32'
      ? ['cmd.exe', '/d', '/c', 'start', '', url]
      : ['open', url];
    execFile(command, args, { windowsHide: true }, error => {
      if (error) console.error(`请在浏览器中打开 ${url}`);
    });
  }
});

for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { automation.close(); stream.close(); ha?.close(); server.closeAllConnections(); server.close(()=>{store.close();releaseDataLock();}); });
