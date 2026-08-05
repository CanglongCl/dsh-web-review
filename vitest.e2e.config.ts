import { defineConfig } from 'vitest/config'

/** E2E config: Playwright-driven browser scenarios against spawned services. */
export default defineConfig({
  test: {
    include: ['packages/*/tests/**/*.e2e.spec.ts'],
    testTimeout: 90_000,
    hookTimeout: 200_000,
    fileParallelism: false,
  },
})
