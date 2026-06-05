import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  css: {
    postcss: './postcss.config.cjs',
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@playwright-reports/shared': resolve(
        __dirname,
        process.env.DOCKER_BUILD === 'true' ? './packages/shared' : '../../packages/shared'
      ),
    },
  },
  server: {
    port: 3000,
    host: true, // allow external connections for development
    cors: true, // enable CORS for development
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false, // for development only
      },
      '/data': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false, // for development only
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          recharts: ['recharts'],
          markdown: ['react-markdown', 'lowlight', 'rehype-raw', 'remark-gfm'],
        },
      },
    },
  },
  ssr: {
    external: ['fastify'], // don't bundle Fastify
  },
});
