/** Materialize the 0811 source-checkout package under its development alias. */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { DEVELOPMENT_ENTRY_NAME, OFFICIAL_PACKAGE_NAME } from './development-entry.ts'

function existingLink(path: string): ReturnType<typeof lstatSync> | undefined {
  try {
    return lstatSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/**
 * Link the external source package into one DSH profile's node_modules.
 * Only a symlink at the exact development alias may be replaced.
 * @param repositoryRoot - dsh-web-review repository root.
 * @param dshHome - resolved DSH home for this launch.
 * @param profile - target DSH profile name.
 * @returns absolute alias path.
 */
export function materializeProfilePluginLink(
  repositoryRoot: string,
  dshHome: string,
  profile = 'web',
): string {
  const profileRoot = join(dshHome, 'profiles', profile)
  const manifestPath = join(profileRoot, 'package.json')
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      dependencies?: Record<string, unknown>
      dsh?: { profile?: { bundles?: unknown[] } }
    }
    if (manifest.dependencies?.[OFFICIAL_PACKAGE_NAME] !== undefined
      || manifest.dsh?.profile?.bundles?.includes(OFFICIAL_PACKAGE_NAME) === true) {
      throw new Error(
        `dsh-web-review: ${OFFICIAL_PACKAGE_NAME} is already installed in the ${profile} profile; `
        + 'remove it explicitly or use an isolated DSH_HOME before launching the source overlay',
      )
    }
  }
  const target = realpathSync(join(repositoryRoot, 'packages', 'dsh-web-review'))
  const destination = join(profileRoot, 'node_modules', ...DEVELOPMENT_ENTRY_NAME.split('/'))
  const current = existingLink(destination)
  if (current !== undefined) {
    if (!current.isSymbolicLink()) {
      throw new Error(`dsh-web-review: refusing to replace non-link development package at ${destination}`)
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
