import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: path.resolve(__dirname, 'frontend'),
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: '@',
        replacement: path.resolve(__dirname, 'frontend/src'),
      },
    ],
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
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](?:react|react-dom|scheduler)[\\/]/.test(id)) return 'react-vendor';
          if (/[\\/]node_modules[\\/](?:motion|framer-motion|motion-dom|motion-utils)[\\/]/.test(id)) return 'motion-vendor';
          if (id.includes('/node_modules/lucide-react/') || id.includes('\\node_modules\\lucide-react\\')) return 'icons-vendor';
          return 'vendor';
        },
      },
    },
  },
});
