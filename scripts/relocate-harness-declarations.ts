/** Relocate committed absolute Harness link declarations inside a disposable CI checkout. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

interface PackageManifest {
  devDependencies?: Record<string, string>
}

function posixPath(path: string): string {
  return path.replaceAll(sep, '/')
}

function replaceImporterLink(
  source: string,
  name: string,
  beforeSpecifier: string,
  afterSpecifier: string,
  afterVersion: string,
): string {
  const key = `      '${name}':\n`
  const start = source.indexOf(key)
  if (start < 0 || source.indexOf(key, start + key.length) >= 0) {
    throw new Error(`dsh-web-review: expected exactly one lockfile importer entry for ${JSON.stringify(name)}`)
  }
  const contentStart = start + key.length
  const nextEntry = /\n {6}(?:'[^'\n]+'|[^\s'][^:\n]*):\n/gu
  nextEntry.lastIndex = contentStart
  const next = nextEntry.exec(source)
  const end = next === null ? source.length : next.index
  const block = source.slice(contentStart, end)
  const specifierLine = `        specifier: ${beforeSpecifier}`
  if (block.split(specifierLine).length !== 2) {
    throw new Error(`dsh-web-review: lockfile specifier drifted for ${JSON.stringify(name)}`)
  }
  const versions = [...block.matchAll(/^        version: (.+)$/gmu)]
  if (versions.length !== 1 || versions[0]?.[0] === undefined) {
    throw new Error(`dsh-web-review: lockfile version drifted for ${JSON.stringify(name)}`)
  }
  const relocated = block
    .replace(specifierLine, `        specifier: ${afterSpecifier}`)
    .replace(versions[0][0], `        version: ${afterVersion}`)
  return `${source.slice(0, contentStart)}${relocated}${source.slice(end)}`
}

/**
 * Rewrite only Harness-backed link declarations for a disposable checkout.
 * The committed manifest remains the suffix authority; the exact CI Harness
 * checkout supplies the root. Both importer specifiers and resolved link
 * targets are updated so the following install can stay frozen.
 * @param repositoryRoot - dsh-web-review repository root.
 * @param harnessRoot - exact checked-out Harness root.
 */
export function relocateHarnessDeclarations(repositoryRoot: string, harnessRoot: string): void {
  const packageRoot = join(repositoryRoot, 'packages', 'dsh-web-review')
  const manifestPath = join(packageRoot, 'package.json')
  const lockfilePath = join(repositoryRoot, 'pnpm-lock.yaml')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest
  const dependencies = manifest.devDependencies ?? {}
  const runtime = dependencies['@deepseek-ai/dsh-client-runtime']
  if (runtime?.startsWith('link:') !== true || !isAbsolute(runtime.slice('link:'.length))) {
    throw new Error('dsh-web-review: source manifest has no absolute linked client runtime')
  }

  const declaredRuntime = runtime.slice('link:'.length)
  const declaredHarness = dirname(dirname(dirname(declaredRuntime)))
  const targetHarness = resolve(harnessRoot)
  if (!existsSync(join(targetHarness, 'package.json'))) {
    throw new Error(`dsh-web-review: Harness checkout is missing at ${targetHarness}`)
  }

  let lockfile = readFileSync(lockfilePath, 'utf8')
  let changed = 0
  for (const [name, specifier] of Object.entries(dependencies)) {
    if (!specifier.startsWith('link:')) continue
    const declaredTarget = specifier.slice('link:'.length)
    if (!isAbsolute(declaredTarget)) {
      throw new Error(`dsh-web-review: linked dependency ${JSON.stringify(name)} is not absolute`)
    }
    const suffix = relative(declaredHarness, declaredTarget)
    if (suffix === '..' || suffix.startsWith(`..${sep}`) || isAbsolute(suffix)) {
      throw new Error(`dsh-web-review: linked dependency ${JSON.stringify(name)} escapes the declared Harness`)
    }
    const target = join(targetHarness, suffix)
    if (!existsSync(join(target, 'package.json'))) {
      throw new Error(`dsh-web-review: linked Harness package ${JSON.stringify(name)} is missing at ${target}`)
    }
    if (target === declaredTarget) continue

    const targetRelative = posixPath(relative(packageRoot, target))
    lockfile = replaceImporterLink(
      lockfile,
      name,
      `link:${posixPath(declaredTarget)}`,
      `link:${posixPath(target)}`,
      `link:${targetRelative}`,
    )
    dependencies[name] = `link:${target}`
    changed += 1
  }

  if (changed > 0) {
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    writeFileSync(lockfilePath, lockfile)
  }
  console.log(`harness-declarations: ${String(changed)} link(s) relocated -> ${targetHarness}`)
}

const invoked = process.argv[1]
if (invoked !== undefined && pathToFileURL(resolve(invoked)).href === import.meta.url) {
  const harness = process.env.DSH_HARNESS
  if (harness === undefined || harness.trim() === '') {
    throw new Error('dsh-web-review: DSH_HARNESS is required when relocating CI declarations')
  }
  relocateHarnessDeclarations(dirname(dirname(resolve(invoked))), harness)
}
