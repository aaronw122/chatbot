import path from 'path';
import { defineConfig } from 'vitest/config';

// The pure logic (buildAnchorModel, projection, capture, the rehype alignment
// plugin) and React server-render tests need no DOM, so the `node` environment
// is sufficient. The exhaustive DOM/Range fixture suite is B4.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
