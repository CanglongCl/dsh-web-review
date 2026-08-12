/** Resolve the 0812 Harness built CLI launch vector for this external plugin. */
import { resolveHarnessCli } from './harness-path.ts'

/** One fully resolved child-process launch. */
export interface HarnessCliLaunch {
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
}

/**
 * Build the Web launch vector while preserving this repository as cwd.
 *
 * The installed-style CLI is the built `apps/cli/lib/bin.js`. The caller
 * materializes the source package under the profile-local development alias,
 * so the native-ESM Loader and client manifest scanner both use ordinary bare
 * package resolution without a tsx hook.
 */
export function harnessWebLaunch(
  harnessRoot: string,
  patchPath: string,
  host: string,
  port: string | number,
  environment: NodeJS.ProcessEnv = process.env,
): HarnessCliLaunch {
  const bin = resolveHarnessCli(harnessRoot)
  return {
    command: process.execPath,
    args: [
      bin,
      'web',
      '--patch', patchPath,
      '--host', host,
      '--port', String(port),
    ],
    env: { ...environment },
  }
}
