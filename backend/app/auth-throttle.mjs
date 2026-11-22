import { createHash } from 'node:crypto';

// Bounded per-source windows; success only resets its own source, never a proxy-wide bucket.
export function createAuthThrottle({ now = Date.now, clientAddress = req => req.socket.remoteAddress, maxSources = 10000 } = {}) {
  const attempts = new Map();
  return {
    middleware(req, res, next) {
      const time = now();
      for (const [key, value] of attempts) if (value.until <= time) attempts.delete(key);
      const key = createHash('sha256').update(clientAddress(req)).digest('hex');
      req.authThrottleKey = key;
      const attempt = attempts.get(key) ?? { count: 0, until: time + 15 * 60 * 1000 };
      if (attempt.count >= 10 || (!attempts.has(key) && attempts.size >= maxSources)) {
        res.set('Retry-After', String(Math.max(1, Math.ceil((attempt.until - time) / 1000))));
        return res.status(429).json({ message: '尝试次数过多，请稍后再试' });
      }
      attempt.count++;
      attempts.set(key, attempt);
      next();
    },
    reset(req) { attempts.delete(req.authThrottleKey); },
  };
}
