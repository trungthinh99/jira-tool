import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    // The backend holds the Jira token; the browser only ever talks to /api.
    proxy: {
      '/api': {
        target: 'http://localhost:4180',
        changeOrigin: true,
      },
    },
  },
});
