import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';

export default defineConfig({
  plugins: [
    svelte({
      compilerOptions: {
        dev: true
      }
    })
  ],
  resolve: {
    alias: {
      '$components': path.resolve('src/client/components'),
      '$stores': path.resolve('src/client/stores'),
      '$apis': path.resolve('src/client/apis'),
      '$lib': path.resolve('src/client/lib')
    },
    // 让 Svelte 5 解析到 client 构建（含 mount()），而非 server 构建
    conditions: ['browser', 'module', 'import', 'default']
  },
  test: {
    include: ['test/vitest/**/*.test.js'],
    setupFiles: ['test/vitest/setup.js'],
    // Default environment for API tests is node
    environment: 'node',
    server: {
      deps: {
        // 确保 @testing-library/svelte 不走 SSR
        inline: ['@testing-library/svelte']
      }
    }
  }
});
