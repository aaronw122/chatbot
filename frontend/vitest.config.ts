import path from 'path';
import { defineConfig } from 'vitest/config';

// B1 (`buildAnchorModel`) is a pure function — the `node` environment is
// sufficient; no DOM is needed.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
