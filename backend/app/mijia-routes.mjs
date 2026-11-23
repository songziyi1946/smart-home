import { Router } from 'express';
import { z } from 'zod';
import { createAuthThrottle } from './auth-throttle.mjs';
import { MijiaRegion } from '../infrastructure/provider-vault.mjs';
import { integrationError } from '../providers/mijia/service.mjs';

const text = z.string().trim().min(1).max(128);
const login = z.object({ username: z.string().trim().min(1).max(254), password: z.string().min(1).max(128), region: MijiaRegion }).strict();
const challenge = z.discriminatedUnion('action', [
  z.object({ id: z.string().uuid(), action: z.literal('captcha'), captcha: z.string().trim().min(1).max(32) }).strict(),
  z.object({ id: z.string().uuid(), action: z.literal('send'), method: z.enum(['phone', 'email']), captcha: z.string().trim().min(1).max(32).optional() }).strict(),
  z.object({ id: z.string().uuid(), action: z.literal('verify'), code: z.string().trim().regex(/^[A-Za-z0-9-]{4,12}$/) }).strict(),
]);
const roomBindings = z.object({ bindings: z.array(z.object({
  providerRoomId: text.refine(value => !['__proto__', 'constructor', 'prototype'].includes(value)),
  roomId: z.string().regex(/^[a-z][a-z0-9_-]{0,79}$/), roomName: z.string().trim().min(1).max(40),
}).strict()).max(100) }).strict();

export function createMijiaRouter({ service, sessionFor, subscribeAuth, clientAddress, allowCredentials = () => true }) {
  const router = Router(), throttle = createAuthThrottle({ clientAddress });
  router.use((req, res, next) => {
    if (req.user?.role !== 'admin' || req.user.id === 'local') return res.status(403).json({ message: '请使用家庭管理员账号登录后配置米家连接' });
    if (!allowCredentials(req)) return res.status(403).json({ message: '请通过 HTTPS 或本机地址配置米家连接' });
    res.set('Cache-Control', 'no-store'); next();
  });
  const actor = req => ({ id: req.user.id, authorized: () => { const current = sessionFor(req); return current?.user.id === req.user.id && current.user.role === 'admin'; } });
  const route = action => async (req, res, next) => {
    try { res.json(await action(req, actor(req))); }
    catch (error) { next(error instanceof z.ZodError ? error : integrationError(error)); }
  };
  router.get('/', route((req, current) => service.status(current.id)));
  router.post('/login', throttle.middleware, route(async (req, current) => {
    let input;
    try { input = login.parse(req.body); } finally { if (req.body && typeof req.body === 'object') delete req.body.password; }
    return service.login(input, current);
  }));
  router.post('/challenge', throttle.middleware, route((req, current) => service.challenge(challenge.parse(req.body), current)));
  router.delete('/login', route((req, current) => { z.object({}).strict().parse(req.body); service.cancelLogin(current.id); return service.status(current.id); }));
  router.post('/home', route((req, current) => service.selectHome(z.object({ homeId: text }).strict().parse(req.body).homeId, current)));
  router.put('/rooms', route((req, current) => service.setRooms(roomBindings.parse(req.body).bindings, current)));
  router.post('/refresh', route((req, current) => { z.object({}).strict().parse(req.body); return service.refresh(current); }));
  router.delete('/', route((req, current) => { z.object({}).strict().parse(req.body); return service.unlink(current); }));
  const unsubscribe = subscribeAuth?.(() => service.revokeInvalidLogin()) ?? (() => {});
  return { router, close: unsubscribe };
}
