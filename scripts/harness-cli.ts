/** Resolve the 0811 Harness built CLI launch vector for this external plugin. */
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

/** One fully resolved child-process launch. */
export interface HarnessCliLaunch {
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
}

/**
 * Build the Web launch vector while preserving this repository as cwd.
 *
 * The installed-style CLI is the built `apps/cli/lib/bin.js`. This source
 * checkout's absolute directory entry still needs the Harness-owned tsx ESM
 * resolver so Loader can reach its root `index.ts`; a plain Node launch rejects
 * that directory before the manifest scanner can inspect package.json.
 */
export function harnessWebLaunch(
  harnessRoot: string,
  patchPath: string,
  host: string,
  port: string | number,
  environment: NodeJS.ProcessEnv = process.env,
): HarnessCliLaunch {
  const bin = join(harnessRoot, 'apps', 'cli', 'lib', 'bin.js')
  if (!existsSync(bin)) {
    throw new Error(`dsh-web-review: Harness built CLI missing at ${bin}; run pnpm setup:harness`)
  }
  const requireFromHarness = createRequire(join(harnessRoot, 'package.json'))
  const tsxEsm = requireFromHarness.resolve('tsx/esm')
  return {
    command: process.execPath,
    args: [
      '--import', tsxEsm,
      bin,
      'web',
      '--patch', patchPath,
      '--host', host,
      '--port', String(port),
    ],
    env: {
      ...environment,
      TSX_TSCONFIG_PATH: join(harnessRoot, 'tsconfig.json'),
    },
  }
}
