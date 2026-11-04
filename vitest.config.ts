import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'tools/**/*.test.ts'],
    // Whole bot matches (v2 brain) run in some tests; give them room on busy machines.
    testTimeout: 60_000,
  },
});
