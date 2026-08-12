/** Resolve an explicitly selected DeepSeek Harness checkout and its app-owned CLI artifact. */
import { existsSync, realpathSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Resolve the Harness root used only by development, acceptance, and E2E.
 * @returns absolute DeepSeek Harness checkout path.
 */
export function resolveHarnessRoot(): string {
  const harness = process.env.DSH_HARNESS?.trim()
  if (harness === undefined || harness === '') {
    throw new Error('dsh-web-review: DSH_HARNESS is required for development, acceptance, and E2E')
  }
  return realpathSync(harness)
}

/**
 * Resolve the built 0812 app-owned CLI entry.
 * @param harnessRoot - Resolved DeepSeek Harness checkout.
 * @returns absolute path to `apps/cli/lib/bin.js`.
 */
export function resolveHarnessCli(harnessRoot: string): string {
  const cli = join(harnessRoot, 'apps', 'cli', 'lib', 'bin.js')
  if (!existsSync(cli)) {
    throw new Error(`dsh-web-review: Harness CLI is not built at ${cli}; run pnpm setup:harness`)
  }
  return cli
}
