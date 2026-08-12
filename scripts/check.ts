/**
 * Quality gate (`pnpm check`): the strict verification surface for this repo.
 * Runs after `pnpm install`; generated/build artifacts may be absent:
 *  1. bootstrap — repair worktree-local Harness links and generate config;
 *  2. typecheck — source/scripts solution plus every unit/component/E2E test;
 *  3. build — tsdown produces the node half plus both client channels;
 *  4. unit suite — vitest, including the real directory-entry load;
 *  5. config/package contracts — generated config is deterministic, current
 *     dsh.client shape, both banner ids, and the forwarding entry;
 *  6. official package — stable bundle id, dsh.bundle declaration, exact
 *     staging allowlist, tarball output, and checksum.
 * Flags: --fast skips official-package assembly; --e2e additionally runs the
 * Playwright browser suite (requires the product provider chain).
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const PKG = join(ROOT, 'packages', 'dsh-web-review')
const DIST = join(ROOT, 'dist')
const OFFICIAL = join(DIST, 'package')
const runE2e = process.argv.includes('--e2e')
const fast = process.argv.includes('--fast')

const FAILURES: string[] = []

/** Run one command; a non-zero exit records a failure. */
function run(label: string, command: string, args: readonly string[]): boolean {
  process.stdout.write(`check: ${label} ... `)
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
  if (result.status === 0) {
    console.log('ok')
    return true
  }
  console.log(`FAILED (${String(result.status)})`)
  if (result.stdout !== '') process.stdout.write(`${result.stdout.slice(-2000)}\n`)
  if (result.stderr !== '') process.stdout.write(`${result.stderr.slice(-2000)}\n`)
  FAILURES.push(label)
  return false
}

/** Assert a boolean contract; a violation records a failure. */
function assert(label: string, check: () => boolean, detail: () => string): void {
  process.stdout.write(`check: ${label} ... `)
  try {
    if (check()) {
      console.log('ok')
      return
    }
    console.log('FAILED')
    console.log(`  ${detail()}`)
  } catch (error) {
    console.log('FAILED')
    console.log(`  ${error instanceof Error ? error.message : String(error)}`)
  }
  FAILURES.push(label)
}

/** List files beneath a generated package root using POSIX-style separators. */
function listFiles(root: string, current = root): string[] {
  const files: string[] = []
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const path = join(current, entry.name)
    if (entry.isDirectory()) files.push(...listFiles(root, path))
    else files.push(relative(root, path).replaceAll('\\', '/'))
  }
  return files.sort()
}

/** Static/dynamic ESM imports emitted by tsdown (builtins are allowed). */
function esmImports(source: string): string[] {
  const specifiers = [
    ...source.matchAll(/^\s*import(?:.+?\sfrom\s+)?["']([^"']+)["'];?\s*$/gmu),
    ...source.matchAll(/\bimport\(["']([^"']+)["']\)/gu),
  ]
  return specifiers.flatMap(match => match[1] === undefined ? [] : [match[1]])
}

// Bootstrap is deliberately part of the gate: a clean git worktree carries
// neither generated absolute-path config nor built bundles, and pnpm's
// checkout-relative link targets need rematerializing in secondary worktrees.
run('Harness dependency links', process.execPath, [
  '--import', 'tsx', join(ROOT, 'scripts/link-harness-deps.ts'),
])
run('gen-config initial generation', process.execPath, [
  '--import', 'tsx', join(ROOT, 'scripts/gen-config.ts'),
])
const entryBefore = readFileSync(join(PKG, 'entry-name.json'), 'utf8')
const cordisBefore = readFileSync(join(ROOT, 'cordis.yml'), 'utf8')
run('gen-config regeneration', process.execPath, ['--import', 'tsx', join(ROOT, 'scripts/gen-config.ts')])
assert(
  'gen-config deterministic (entry-name.json + cordis.yml unchanged)',
  () => readFileSync(join(PKG, 'entry-name.json'), 'utf8') === entryBefore
    && readFileSync(join(ROOT, 'cordis.yml'), 'utf8') === cordisBefore,
  () => 'generated absolute-path config changed across two consecutive runs',
)

run('source + scripts typecheck (tsc -b --force)', process.execPath, [
  join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'),
  '-b', '--force',
])
run('test typecheck (unit + component + E2E)', process.execPath, [
  join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'),
  '-p', join(ROOT, 'tsconfig.tests.json'),
])
run('build (tsdown)', 'pnpm', ['--filter', '@dsh-external/dsh-web-review', 'build'])
run('unit suite (vitest)', 'pnpm', ['vitest', 'run'])

// Bundle contract: banner id == entry name; directory-import entry exists.
const entryName = (JSON.parse(entryBefore) as { name: string }).name
assert(
  'client package declares dsh.client',
  () => {
    const manifest = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as {
      dsh?: { client?: { platform?: unknown } }
      dshClient?: unknown
    }
    return manifest.dsh?.client?.platform === 'web' && manifest.dshClient === undefined
  },
  () => 'package.json must use the current nested dsh.client manifest; legacy dshClient is ignored by the host',
)
const repositoryManifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }
const packageManifest = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as {
  name: string
  version: string
  exports?: Record<string, unknown>
}
assert(
  'source package exposes only runtime entrypoints',
  () => JSON.stringify(Object.keys(packageManifest.exports ?? {}).sort())
    === JSON.stringify(['.', './client', './package.json'].sort()),
  () => 'package.json exports must not expose private src/* modules or missing declaration artifacts',
)
assert(
  'bundle banner id matches the entry name',
  () => {
    const client = readFileSync(join(PKG, 'lib', 'client.js'), 'utf8')
    // tsdown/rolldown reformats the banner, so extract the id rather than
    // matching the literal one-line form.
    const match = /__ModuleLoader__\.load\(\{[\s\S]*?id:\s*("[^"]*")/.exec(client)
    if (match === null || match[1] === undefined) return false
    return (JSON.parse(match[1]) as string) === entryName
  },
  () => 'lib/client.js missing or its banner id drifted from entry-name.json — run `pnpm build`',
)
assert(
  'directory-import forwarding entry (index.ts) exists',
  () => existsSync(join(PKG, 'index.ts')),
  () => 'packages/dsh-web-review/index.ts missing — the Loader cannot import the package directory without it',
)
assert(
  'built node half is self-contained',
  () => esmImports(readFileSync(join(PKG, 'lib', 'index.js'), 'utf8'))
    .every(specifier => specifier.startsWith('node:')),
  () => `lib/index.js has non-builtin imports: ${esmImports(readFileSync(join(PKG, 'lib', 'index.js'), 'utf8'))
    .filter(specifier => !specifier.startsWith('node:')).join(', ')}`,
)
assert(
  'browser half excludes the node HTML parser',
  () => [join(PKG, 'lib', 'client.js'), join(PKG, 'lib', 'bridge.js')]
    .every(file => !readFileSync(file, 'utf8').includes('parse5')),
  () => 'a browser artifact contains parse5 — import URL helpers from proxy-url.ts, not rewrite.ts',
)
assert(
  'isolated frame bridge is a self-contained IIFE',
  () => {
    const bridge = readFileSync(join(PKG, 'lib', 'bridge.js'), 'utf8')
    return bridge.startsWith('(function() {')
      && esmImports(bridge).length === 0
      && !/\brequire\s*\(/u.test(bridge)
  },
  () => 'lib/bridge.js must not retain runtime imports or CommonJS requires',
)

// Official DSH profile bundle: stable id plus an exact prebuilt tarball.
assert(
  'official bundle banner id matches package name',
  () => {
    const client = readFileSync(join(PKG, 'lib', 'client-official.js'), 'utf8')
    const match = /__ModuleLoader__\.load\(\{[\s\S]*?id:\s*("[^"]*")/.exec(client)
    return match?.[1] !== undefined && (JSON.parse(match[1]) as string) === packageManifest.name
  },
  () => 'lib/client-official.js missing or its banner id drifted from package.json',
)
if (!fast) run('assemble official DSH package', process.execPath, ['--import', 'tsx', join(ROOT, 'scripts/package-official.ts')])
const expectedOfficialFiles = [
  'README.md',
  'cordis.patch.yml',
  'docs/assets/web-review-annotation-editor.jpg',
  'docs/assets/web-review-demo.gif',
  'docs/assets/web-review-preview.jpg',
  'lib/bridge.js',
  'lib/bridge.js.map',
  'lib/client-official.js',
  'lib/client-official.js.map',
  'lib/index.js',
  'package.json',
  ...listFiles(join(PKG, 'skills')).map(file => `skills/${file}`),
].sort()
if (!fast) {
  assert(
    'official package contains only the distribution allowlist',
    () => JSON.stringify(listFiles(OFFICIAL)) === JSON.stringify(expectedOfficialFiles),
    () => `dist/package files differ: ${listFiles(OFFICIAL).join(', ')}`,
  )
  assert(
    'official package declares the DSH bundle and its entries exist',
    () => {
      const manifest = JSON.parse(readFileSync(join(OFFICIAL, 'package.json'), 'utf8')) as {
        name: string
        version: string
        main: string
        exports?: { './client'?: string }
        dsh?: { bundle?: { patch?: string }; client?: { platform?: string } }
      }
      return manifest.name === packageManifest.name
        && manifest.version === repositoryManifest.version
        && manifest.version === packageManifest.version
        && manifest.dsh?.bundle?.patch === './cordis.patch.yml'
        && manifest.dsh?.client?.platform === 'web'
        && existsSync(join(OFFICIAL, manifest.main))
        && manifest.exports?.['./client'] !== undefined
        && existsSync(join(OFFICIAL, manifest.exports['./client']))
        && existsSync(join(OFFICIAL, manifest.dsh.bundle.patch))
    },
    () => 'staged package.json must declare dsh.bundle/dsh.client and point at existing entries',
  )
  assert(
    'official tarball exists',
    () => existsSync(join(DIST, `dsh-external-dsh-web-review-${packageManifest.version}.tgz`)),
    () => 'pnpm pack did not produce the expected dist/*.tgz file',
  )
  assert(
    'official tarball checksum is current',
    () => {
      const packageName = `dsh-external-dsh-web-review-${packageManifest.version}.tgz`
      const packagePath = join(DIST, packageName)
      if (!existsSync(packagePath) || !existsSync(join(DIST, 'SHA256SUMS'))) return false
      const checksum = createHash('sha256').update(readFileSync(packagePath)).digest('hex')
      return readFileSync(join(DIST, 'SHA256SUMS'), 'utf8') === `${checksum}  ${packageName}\n`
    },
    () => 'dist/SHA256SUMS is missing or does not match the official tarball',
  )
}

if (runE2e) {
  run('e2e (Playwright browser suite)', 'pnpm', ['test:e2e'])
}

if (FAILURES.length > 0) {
  console.error(`\ncheck: ${FAILURES.length} gate(s) failed: ${FAILURES.join(', ')}`)
  process.exit(1)
}
console.log('\ncheck: all gates passed.')
