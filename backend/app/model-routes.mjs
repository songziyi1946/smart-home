import express from 'express';

export function createModelRouter({ service }) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!req.user) return res.status(401).json({ message: '请先登录' });
    if (req.user.role === 'guest' || (req.method !== 'GET' && req.method !== 'HEAD' && req.user.role !== 'admin')) return res.status(403).json({ message: '模型管理需要家庭管理员权限' });
    next();
  });
  // This router is mounted after origin/session/role checks, before large payload parsing.
  const parseUpload = express.json({ limit: '42mb' }), parseSmall = express.json({ limit: '32kb' });
  router.use((req, res, next) => (req.method === 'POST' && (req.path === '/' || /^\/[^/]+\/versions\/?$/.test(req.path)) ? parseUpload : parseSmall)(req, res, next));
  router.get('/', (_req, res) => res.json(service.list()));
  router.get('/assets/:id', (req, res) => res.type('model/gltf-binary').send(service.asset(req.params.id)));
  router.post('/', (req, res) => res.status(201).json(service.save(req.body)));
  router.post('/:id/versions', (req, res) => res.status(201).json(service.save(req.body, req.params.id)));
  router.post('/:id/restore', (req, res) => res.json(service.restore(req.params.id, req.body)));
  router.put('/default', (req, res) => res.json(service.setDefault(req.body)));
  return router;
}
