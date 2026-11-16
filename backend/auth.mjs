import { Router } from 'express';
import { randomBytes, randomUUID, scrypt as deriveKey, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';

const scrypt = promisify(deriveKey);
const cookieName = 'smart_home_session';
const credentials = z.object({
  username: z.string().trim().regex(/^[A-Za-z0-9_-]{3,32}$/),
  password: z.string().min(12).max(128),
});
const identity = credentials.extend({ displayName: z.string().trim().min(1).max(40) });
const publicUser = ({ passwordHash, salt, disabled, ...user }) => user;
const digest = (token) => createHash('sha256').update(token).digest('hex');

export function createAuth({ file, repository, sessionTTL = 8 * 60 * 60 * 1000, now = Date.now }) {
  const stored = repository ? repository.load() : existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  let data = stored && (stored.users ? stored : {
    household: { id: randomUUID(), name: '我的家' }, users: [stored], invitations: [],
  });
  const sessions = new Map();
  const sessionListeners = new Set();
  const notifySessions = () => { for (const listener of sessionListeners) listener(); };
  const attempts = new Map();
  const router = Router();
  const getToken = (req) => (req.headers.cookie ?? '').split(';').map(value => value.trim()).find(value => value.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
  const cookieOptions = (req) => ({ httpOnly: true, sameSite: 'strict', secure: req.secure, path: '/' });
  const active = user => user && !user.disabled && (!user.accessExpiresAt || user.accessExpiresAt > now());
  function save() {
    if(repository){try{repository.save(data);}catch(error){data=repository.load();throw error;}return;}
    writeFileSync(file + '.tmp', JSON.stringify(data, null, 2), { mode: 0o600 });
    renameSync(file + '.tmp', file);
  }
  function session(req) {
    const token = getToken(req);
    if (!token) return;
    const key = digest(token);
    const value = sessions.get(key);
    const user = data?.users.find(user => user.id === value?.userId);
    if (value && value.expiresAt > now() && active(user)) return { value, user };
    sessions.delete(key);
  }
  function sessionInfo(user, value) {
    return { user: publicUser(user), household: data.household, expiresAt: value.expiresAt, loggedInAt: value.loggedInAt };
  }
  function signIn(req, res, user) {
    for (const [key, value] of sessions) if (value.expiresAt <= now()) sessions.delete(key);
    const previous = getToken(req);
    if (previous) sessions.delete(digest(previous));
    const token = randomBytes(32).toString('hex');
    const expiresAt = Math.min(now() + sessionTTL, user.accessExpiresAt ?? Infinity);
    const value = { userId: user.id, expiresAt, loggedInAt: new Date(now()).toISOString() };
    sessions.set(digest(token), value);
    notifySessions();
    res.cookie(cookieName, token, { ...cookieOptions(req), maxAge: expiresAt - now() });
    res.json(sessionInfo(user, value));
  }
  function throttle(req, res, next) {
    for (const [key, value] of attempts) if (value.until <= now()) attempts.delete(key);
    const key = req.ip;
    const attempt = attempts.get(key) ?? { count: 0, until: now() + 15 * 60 * 1000 };
    if (attempt.count >= 10) {
      res.set('Retry-After', String(Math.ceil((attempt.until - now()) / 1000)));
      return res.status(429).json({ message: '尝试次数过多，请稍后再试' });
    }
    attempt.count++;
    attempts.set(key, attempt);
    next();
  }
  function requireAuth(req, res, next) {
    const current = session(req);
    if (!current) return res.status(401).json({ message: '登录已过期或家庭权限已失效，请重新登录', setupRequired: !data });
    req.user = current.user;
    res.set('Cache-Control', 'no-store');
    next();
  }
  function ownerOnly(req, res, next) {
    if (req.user.role !== 'admin') return res.status(403).json({ message: '仅家庭管理员可以管理成员和邀请' });
    next();
  }
  async function makeUser(input, role, accessExpiresAt) {
    const salt = randomBytes(16).toString('hex');
    const passwordHash = (await scrypt(input.password, salt, 64)).toString('hex');
    return { id: randomUUID(), username: input.username, displayName: input.displayName, role, createdAt: new Date(now()).toISOString(), salt, passwordHash, ...(accessExpiresAt ? { accessExpiresAt } : {}) };
  }
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.get('/session', (req, res) => {
    const current = session(req);
    if (!current) return res.status(401).json({ message: '请先登录', setupRequired: !data });
    res.json(sessionInfo(current.user, current.value));
  });
  router.post('/setup', throttle, async (req, res) => {
    if (data) return res.status(409).json({ message: '家庭已创建，请登录或通过邀请加入' });
    const input = identity.extend({ homeName: z.string().trim().min(1).max(40) }).parse(req.body);
    const user = await makeUser(input, 'admin');
    const household = { id: randomUUID(), name: input.homeName };
    const initial = { household, users: [user], invitations: [] };
    if(!repository)mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    try { if(repository)repository.create(initial);else writeFileSync(file, JSON.stringify(initial, null, 2), { flag: 'wx', mode: 0o600 }); }
    catch (error) {
      if (error.code === 'EEXIST') return res.status(409).json({ message: '家庭已创建，请登录或通过邀请加入' });
      throw error;
    }
    data = initial;
    attempts.delete(req.ip);
    signIn(req, res, user);
  });
  router.post('/login', throttle, async (req, res) => {
    const input = credentials.parse(req.body);
    const user = data?.users.find(user => user.username === input.username);
    const actual = await scrypt(input.password, user?.salt ?? 'unconfigured-account', 64);
    if (!active(user) || !timingSafeEqual(actual, Buffer.from(user.passwordHash, 'hex'))) {
      return res.status(401).json({ message: '用户名或密码错误，或家庭访问权限已失效' });
    }
    attempts.delete(req.ip);
    signIn(req, res, user);
  });
  router.post('/join', throttle, async (req, res) => {
    const input = identity.extend({ code: z.string().trim().regex(/^[A-Fa-f0-9]{12}$/) }).parse(req.body);
    const findInvite = () => data?.invitations.find(invite => invite.hash === digest(input.code.toUpperCase()) && invite.expiresAt > now());
    if (!findInvite()) return res.status(400).json({ message: '邀请码无效或已过期，请向家庭管理员重新申请' });
    const user = await makeUser(input, findInvite().role);
    const invite = findInvite();
    if (!invite) return res.status(400).json({ message: '邀请码已使用或过期' });
    if (data.users.some(user => user.username === input.username)) return res.status(409).json({ message: '用户名已存在，请换一个用户名' });
    if (invite.role === 'guest') user.accessExpiresAt = now() + invite.guestHours * 60 * 60 * 1000;
    data.users.push(user);
    data.invitations = data.invitations.filter(item => item !== invite);
    save();
    attempts.delete(req.ip);
    signIn(req, res, user);
  });
  router.get('/members', requireAuth, ownerOnly, (_req, res) => {
    res.json({ members: data.users.filter(active).map(publicUser) });
  });
  router.post('/invitations', requireAuth, ownerOnly, (req, res) => {
    const input = z.object({ role: z.enum(['member', 'guest']), guestHours: z.union([z.literal(1), z.literal(24), z.literal(168)]).default(24) }).parse(req.body);
    const code = randomBytes(6).toString('hex').toUpperCase();
    const expiresAt = now() + 15 * 60 * 1000;
    data.invitations = data.invitations.filter(invite => invite.expiresAt > now()).slice(-19);
    data.invitations.push({ hash: digest(code), expiresAt, ...input });
    save();
    res.status(201).json({ code, expiresAt });
  });
  router.delete('/members/:id', requireAuth, ownerOnly, (req, res) => {
    const user = data.users.find(user => user.id === req.params.id);
    if (!user || user.disabled) return res.status(404).json({ message: '成员不存在' });
    if (user.role === 'admin') return res.status(400).json({ message: '不能移除家庭管理员' });
    user.disabled = true;
    save();
    for (const [key, value] of sessions) if (value.userId === user.id) sessions.delete(key);
    notifySessions();
    res.json({ ok: true });
  });
  router.post('/logout', (req, res) => {
    const token = getToken(req);
    if (token) sessions.delete(digest(token));
    notifySessions();
    res.clearCookie(cookieName, cookieOptions(req));
    res.json({ ok: true });
  });
  return { router, requireAuth,
    isActiveAdmin(id) { const user=data?.users.find(u=>u.id===id);return !!active(user)&&user.role==='admin'; },
    sessionFor(req) { const current = session(req); return current ? { user: publicUser(current.user), expiresAt: current.value.expiresAt } : undefined; },
    subscribeSessions(listener) { sessionListeners.add(listener); return () => sessionListeners.delete(listener); },
  };
}

export function authorizeHousehold(req, res, next) {
  const role = req.user.role;
  const path = req.path.toLowerCase();
  if(role!=='admin' && /^\/automations(\/|$)/.test(path) && req.method!=='GET')return res.status(403).json({message:'自动化管理需要家庭管理员权限'});
  if(role !== 'admin' && ((path === '/scenes' && req.method === 'POST') || (['PUT','PATCH','DELETE'].includes(req.method) && /^\/scenes(\/|$)/.test(path)))) return res.status(403).json({message:'场景管理需要家庭管理员权限'});
  if (role === 'guest' && !(
    (req.method === 'GET' && (path === '/state' || path === '/events')) ||
    (req.method === 'PATCH' && /^\/devices\/[^/]+$/.test(path)) ||
    (req.method === 'POST' && /^\/scenes\/[^/]+$/.test(path))
  )) return res.status(403).json({ message: '访客仅可使用设备和场景控制' });
  if (role !== 'admin' && ((['PATCH', 'PUT'].includes(req.method) && /^\/(rules|greetings)(\/|$)/.test(path)) || (req.method === 'POST' && path === '/simulations'))) {
    return res.status(403).json({ message: '自动化配置需要家庭管理员权限' });
  }
  next();
}

export function validateOrigin(req, res, next) {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    if (req.get('Origin')) {
      try {
        if (new URL(req.get('Origin')).host !== req.get('Host')) return res.status(403).json({ message: '请求来源不受信任' });
      } catch { return res.status(403).json({ message: '请求来源不受信任' }); }
    }
    if (!req.is('application/json')) return res.status(415).json({ message: '请使用 JSON 格式提交' });
  }
  next();
}

export function filterHouseholdState(state, user) {
  if (user.role !== 'guest') return state;
  return { devices: state.devices, automations: [], automationRuns: [], scenes: state.scenes ?? [], sceneRuns: (state.sceneRuns ?? []).filter(run=>run.actorId===user.id).map(({actorId,...run})=>run), rules: [], accounts: [], expenses: [], events: [], greetings: {}, speaker: '', lightOn: false };
}
