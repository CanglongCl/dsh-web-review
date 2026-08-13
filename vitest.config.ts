import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('.', import.meta.url))

/**
 * Test config: node env by default; component specs opt into jsdom via a
 * `// @vitest-environment jsdom` pragma (upstream convention). Value imports
 * The runtime client entry is a browser module-loader artifact, so unit tests
 * use a small contract-faithful store engine. Other value imports resolve from
 * the pinned public npm packages through Vite.
 */
export default defineConfig({
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@deepseek-ai/dsh-client-runtime/client': `${ROOT}packages/dsh-web-review/tests/support/runtime-client.ts`,
      '@deepseek-ai/dsh-client-ui-primitives': `${ROOT}packages/dsh-web-review/tests/support/ui-primitives.tsx`,
    },
  },
  test: {
    environment: 'node',
    include: ['packages/*/tests/**/*.spec.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/*.e2e.spec.ts'],
  },
})
