/** Resolve the linked DeepSeek Harness checkout in both a main checkout and a git worktree. */
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'

/**
 * Resolve the harness root from an override, the installed link, or the package manifest.
 * @param repositoryRoot - dsh-web-review repository root.
 * @returns absolute DeepSeek Harness checkout path.
 */
export function resolveHarnessRoot(repositoryRoot: string): string {
  if (process.env.DSH_HARNESS !== undefined) return realpathSync(process.env.DSH_HARNESS)

  const installedRuntime = join(
    repositoryRoot,
    'packages',
    'dsh-web-review',
    'node_modules',
    '@deepseek-ai',
    'dsh-client-runtime',
  )
  if (existsSync(installedRuntime)) {
    const runtime = realpathSync(installedRuntime)
    return dirname(dirname(dirname(runtime)))
  }

  const manifest = JSON.parse(readFileSync(
    join(repositoryRoot, 'packages', 'dsh-web-review', 'package.json'),
    'utf8',
  )) as { devDependencies?: Record<string, string> }
  const specifier = manifest.devDependencies?.['@deepseek-ai/dsh-client-runtime']
  const prefix = 'link:'
  if (specifier?.startsWith(prefix) === true) {
    const runtime = specifier.slice(prefix.length)
    if (isAbsolute(runtime)) return dirname(dirname(dirname(runtime)))
  }
  throw new Error('dsh-web-review: cannot resolve the harness checkout; set DSH_HARNESS')
}
