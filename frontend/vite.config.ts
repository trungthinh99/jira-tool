import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    // Pinned so nobody "fixes" it to `true`: the proxy below would then hand
    // the whole API to the office LAN.
    host: 'localhost',
    // The backend holds the Jira token; the browser only ever talks to /api.
    proxy: {
      '/api': {
        // Not `localhost`: it can resolve to ::1, where the backend no longer
        // listens.
        target: 'http://127.0.0.1:4180',
        changeOrigin: true,
      },
    },
  },
  // Menu state lives in the path (/inbox, /actions, /report). Reloading one of
  // those must serve index.html rather than 404 on a file that does not exist.
  appType: 'spa',
});
