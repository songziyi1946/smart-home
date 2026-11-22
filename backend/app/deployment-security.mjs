import { timingSafeEqual, createHash } from 'node:crypto';

export function isLocalRequest(req) {
  // Host is client-controlled. Always verify the direct network peer as well.
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)
    && ['localhost', '127.0.0.1', '[::1]'].includes(req.hostname);
}

export function deploymentSecurity(env = process.env) {
  const mode = env.SMART_HOME_DEPLOYMENT_MODE || (env.NODE_ENV === 'production' ? 'https' : 'local');
  if (!['local', 'https'].includes(mode)) throw new Error('SMART_HOME_DEPLOYMENT_MODE must be local or https');
  const token = env.SMART_HOME_BOOTSTRAP_TOKEN;
  if (token && token.length < 32) throw new Error('Bootstrap token must contain at least 32 characters');
  const hash = value => createHash('sha256').update(value).digest();
  return {
    mode,
    secureCookies: mode === 'https',
    allowSkipLogin: mode === 'local' && env.NODE_ENV !== 'production',
    allowSetup(req) {
      // Check the direct peer and Host, never forwarded headers. Vite preserves Host.
      if (mode === 'local' && isLocalRequest(req)) return true;
      const supplied = req.get('X-Bootstrap-Token');
      return !!token && typeof supplied === 'string' && timingSafeEqual(hash(supplied), hash(token));
    },
  };
}
