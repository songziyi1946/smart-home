import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = `http://127.0.0.1:${process.env.SMART_HOME_API_PORT || 3101}`;

export default defineConfig({
  plugins: [react()],
  server: {
    host: 'localhost',
    port: 8000,
    strictPort: true,
    proxy: {
      '^/api/events(?:\\?|$)': {
        target: apiTarget,
        changeOrigin: false,
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
      '/api': {
        target: apiTarget,
        proxyTimeout: 5000,
        // Preserve the browser-facing host for the API's same-origin check.
        changeOrigin: false,
      },
    },
  },
});
