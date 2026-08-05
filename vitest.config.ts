import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const HARNESS = fileURLToPath(new URL('../deepseek-harness', import.meta.url))

/**
 * Test config: node env by default; component specs opt into jsdom via a
 * `// @vitest-environment jsdom` pragma (upstream convention). Value imports
 * of the platform packages resolve against the harness SOURCE tree (the
 * built lib/client.js artifacts are browser bundles and cannot be imported
 * from node); type-only imports resolve through the node_modules symlinks.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@deepseek-ai/dsh-client-runtime/client': `${HARNESS}/packages/client/runtime/src/client/index.ts`,
      '@deepseek-ai/dsh-client-locale/client': `${HARNESS}/packages/client/locale/src/client/index.ts`,
      '@deepseek-ai/dsh-client-ui-slots': `${HARNESS}/packages/client/ui-slots/src/index.ts`,
      '@deepseek-ai/dsh-client-ui-conversation/client': `${HARNESS}/packages/client/ui-conversation/src/client/index.ts`,
    },
  },
  test: {
    environment: 'node',
    include: ['packages/*/tests/**/*.spec.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/*.e2e.spec.ts'],
  },
})
