import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';

export function createApiProxy(apiUrl = '', port = '3101'): Record<string, ProxyOptions> {
  const target = new URL(apiUrl || `http://127.0.0.1:${port}`);
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password
    || target.pathname !== '/' || target.search || target.hash) {
    throw new Error('SMART_HOME_API_URL must be an HTTP(S) origin without credentials, path, query or hash');
  }
  const common: ProxyOptions = {
    target: target.origin,
    changeOrigin: !!apiUrl,
    // Validate the browser-facing origin BEFORE adapting it for the remote backend.
    // Vite returns 404 for rejected requests without contacting the upstream.
    bypass: apiUrl ? (req) => {
      if (req.headers.origin) {
        try {
          if (new URL(req.headers.origin).host !== req.headers.host) return false;
        } catch {
          return false;
        }
        req.headers.origin = target.origin;
      }
    } : undefined,
  };
  return {
    '^/api/events(?:\\?|$)': {
      ...common,
      // SSE stays open between heartbeats; the REST inactivity timeout would silently freeze it.
      proxyTimeout: 0,
      timeout: 0,
      configure(proxy) {
        proxy.on('proxyRes', (upstream, _req, downstream) => {
          upstream.once('aborted', () => downstream.destroy());
          upstream.once('error', () => downstream.destroy());
          downstream.once('close', () => upstream.destroy());
        });
      },
    },
    '^/api/integrations/mijia(?:/|\\?|$)': { ...common, proxyTimeout: 90000 },
    '^/api/model-generation(?:/|\\?|$)': { ...common, proxyTimeout: 130000 },
    '^/api/ai(?:/|\\?|$)': { ...common, proxyTimeout: 90000 },
    '^/api/(?:devices|scenes)/[^/?]+(?:\\?|$)': { ...common, proxyTimeout: 90000 },
    '/api': { ...common, proxyTimeout: 5000 },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'SMART_HOME_');
  return {
    plugins: [react()],
    server: {
      host: 'localhost',
      port: 8000,
      strictPort: true,
      proxy: createApiProxy(env.SMART_HOME_API_URL, env.SMART_HOME_API_PORT),
    },
  };
});
