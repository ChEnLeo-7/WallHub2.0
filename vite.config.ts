import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: path.resolve(__dirname, 'frontend'),
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'frontend/src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3090',
      '/health': 'http://localhost:3090',
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'public'),
    emptyOutDir: true,
    sourcemap: false,
  },
});
