import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  envDir: '../../',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    // Listen on 0.0.0.0 so Docker (e.g. self-hosted Skyvern) can open the dev app via host.docker.internal.
    host: true,
    proxy: {
      '/api': {
        // Use 127.0.0.1 so the proxy matches the API bound to IPv4; `localhost` can resolve to ::1 and fail with "Failed to fetch".
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/socket.io': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
