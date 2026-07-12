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
        manualChunks(id) {
          if (id.includes('node_modules/shiki')) return 'vendor-shiki';
          if (id.includes('node_modules/marked')) return 'vendor-marked';
          if (id.includes('node_modules/yjs') || id.includes('node_modules/y-websocket')) return 'vendor-yjs';
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
