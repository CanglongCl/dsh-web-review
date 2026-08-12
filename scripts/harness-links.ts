/** Materialize the plugin's Harness link dependencies for this exact worktree. */
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative } from 'node:path'

interface PackageManifest {
  devDependencies?: Record<string, string>
}

function statLink(path: string): ReturnType<typeof lstatSync> | undefined {
  try {
    return lstatSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function dependencyPath(nodeModules: string, name: string): string {
  const segments = name.split('/')
  if (
    segments.length < 1 || segments.length > 2
    || segments.some(segment => segment === '' || segment === '.' || segment === '..')
    || (segments.length === 2 && !segments[0]?.startsWith('@'))
  ) {
    throw new Error(`dsh-web-review: unsafe dependency name "${name}"`)
  }
  return join(nodeModules, ...segments)
}

/**
 * Recreate every Harness-backed `link:` dependency beneath the package's own
 * node_modules. pnpm records absolute link specifiers as checkout-relative
 * lockfile targets; those targets are correct in the main checkout but point
 * at a nonexistent sibling from a git worktree. The manifest remains the
 * declaration of which packages are linked, while `harnessRoot` selects the
 * concrete checkout for this machine/worktree.
 */
export function materializeHarnessLinks(repositoryRoot: string, harnessRoot: string): {
  verified: number
  changed: number
} {
  const packageRoot = join(repositoryRoot, 'packages', 'dsh-web-review')
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as PackageManifest
  const dependencies = manifest.devDependencies ?? {}
  const runtimeSpecifier = dependencies['@deepseek-ai/dsh-client-runtime']
  if (runtimeSpecifier?.startsWith('link:') !== true) {
    throw new Error('dsh-web-review: package manifest has no linked client runtime')
  }
  const declaredRuntime = runtimeSpecifier.slice('link:'.length)
  if (!isAbsolute(declaredRuntime)) {
    throw new Error('dsh-web-review: linked client runtime must use an absolute manifest path')
  }
  const declaredHarness = dirname(dirname(dirname(declaredRuntime)))
  const resolvedHarness = realpathSync(harnessRoot)
  const nodeModules = join(packageRoot, 'node_modules')
  let verified = 0
  let changed = 0

  for (const [name, specifier] of Object.entries(dependencies)) {
    if (!specifier.startsWith('link:')) continue
    const declaredTarget = specifier.slice('link:'.length)
    if (!isAbsolute(declaredTarget)) {
      throw new Error(`dsh-web-review: linked dependency "${name}" must use an absolute manifest path`)
    }
    const suffix = relative(declaredHarness, declaredTarget)
    if (suffix === '..' || suffix.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(suffix)) {
      throw new Error(`dsh-web-review: linked dependency "${name}" escapes the declared Harness checkout`)
    }
    const target = realpathSync(join(resolvedHarness, suffix))
    const destination = dependencyPath(nodeModules, name)
    const current = statLink(destination)
    if (current !== undefined) {
      if (!current.isSymbolicLink()) {
        throw new Error(`dsh-web-review: refusing to replace non-link dependency at ${destination}`)
      }
      try {
        if (realpathSync(destination) === target) {
          verified += 1
          continue
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      unlinkSync(destination)
    }
    mkdirSync(dirname(destination), { recursive: true })
    symlinkSync(target, destination, 'dir')
    verified += 1
    changed += 1
  }
  return { verified, changed }
}
