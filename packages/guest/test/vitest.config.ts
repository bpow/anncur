import { defineConfig } from 'vitest/config';

/**
 * Browser tests: they build the bundle and drive headless Chromium, so
 * they run apart from `pnpm test` (which needs no browser) through
 * `pnpm --filter @anncur/guest test:browser`.
 */
export default defineConfig({
  test: {
    include: ['test/browser/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
