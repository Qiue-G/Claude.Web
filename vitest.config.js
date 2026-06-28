import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '$components': path.resolve('src/client/components'),
      '$stores': path.resolve('src/client/stores'),
      '$apis': path.resolve('src/client/apis'),
      '$lib': path.resolve('src/client/lib')
    }
  },
  test: {
    include: ['test/vitest/**/*.test.js'],
    setupFiles: ['test/vitest/setup.js'],
    environment: 'node'
  }
});
