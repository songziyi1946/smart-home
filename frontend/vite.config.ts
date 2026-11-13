import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: 'localhost',
    port: 8000,
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${process.env.SMART_HOME_API_PORT || 3101}`,
        proxyTimeout: 5000,
        // Preserve the browser-facing host for the API's same-origin check.
        changeOrigin: false,
      },
    },
  },
});
