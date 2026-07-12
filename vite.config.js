import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';

export default defineConfig({
  plugins: [svelte()],
  root: 'src/client',
  build: {
    outDir: '../../public',
    emptyOutDir: true,
    cssMinify: true,
    minify: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-shiki': ['shiki'],
          'vendor-marked': ['marked'],
          'vendor-yjs': ['yjs', 'y-websocket']
        }
      }
    }
  },
  resolve: {
    alias: {
      '$components': path.resolve('src/client/components'),
      '$stores': path.resolve('src/client/stores'),
      '$apis': path.resolve('src/client/apis'),
      '$lib': path.resolve('src/client/lib')
    }
  }
});
