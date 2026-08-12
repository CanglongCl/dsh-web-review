/**
 * Materialize the eval-runner package under its development alias inside one
 * DSH profile's node_modules (the same loading model as the main plugin's
 * profile-local alias). The headless profile resolves the runner row name
 * '@dsh-web-review-dev/eval-runner' through this symlink.
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/** Bare alias the eval overlay inserts into the headless profile. */
export const EVAL_RUNNER_ALIAS = '@dsh-web-review-dev/eval-runner'

function existingLink(path: string): ReturnType<typeof lstatSync> | undefined {
  try {
    return lstatSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/**
 * Link the eval-runner source package into one DSH profile's node_modules.
 * @param repositoryRoot - dsh-web-review repository root.
 * @param dshHome - resolved DSH home for this launch.
 * @param profile - target DSH profile name (default 'headless').
 * @returns absolute alias path.
 */
export function materializeEvalRunnerLink(
  repositoryRoot: string,
  dshHome: string,
  profile = 'headless',
): string {
  const profileRoot = join(dshHome, 'profiles', profile)
  const target = realpathSync(join(repositoryRoot, 'eval', 'runner-plugin'))
  const destination = join(profileRoot, 'node_modules', ...EVAL_RUNNER_ALIAS.split('/'))
  const current = existingLink(destination)
  if (current !== undefined) {
    if (!current.isSymbolicLink()) {
      throw new Error(`eval: refusing to replace non-link package at ${destination}`)
    }
    const linked = resolve(dirname(destination), readlinkSync(destination))
    try {
      if (realpathSync(linked) === target) return destination
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    unlinkSync(destination)
  }
  mkdirSync(dirname(destination), { recursive: true })
  symlinkSync(target, destination, 'dir')
  return destination
}

/** True when the destination already resolves to the runner package. */
export function evalRunnerLinkExists(repositoryRoot: string, dshHome: string, profile = 'headless'): boolean {
  const destination = join(dshHome, 'profiles', profile, 'node_modules', ...EVAL_RUNNER_ALIAS.split('/'))
  if (!existsSync(destination)) return false
  try {
    return realpathSync(destination) === realpathSync(join(repositoryRoot, 'eval', 'runner-plugin'))
  } catch {
    return false
  }
}
