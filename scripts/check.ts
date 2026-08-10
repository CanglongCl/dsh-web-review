/**
 * Quality gate (`pnpm check`): the strict verification surface for this repo.
 * Runs after `pnpm install`/`pnpm build`:
 *  1. typecheck — tsc -b --force over the solution (package + scripts);
 *  2. unit suite — vitest (rewrite/picker/format/stores/panel/entry-load);
 *  3. config consistency — gen-config must be idempotent and the generated
 *     files must match the current absolute path (moving the repo without
 *     `pnpm gen-config` is a hard error);
 *  4. package contracts — dsh.client is declared and the directory-import
 *     development entry exists;
 *  5. build — tsdown produces the node half plus development and official
 *     client bundles;
 *  6. official package — stable bundle id, dsh.bundle declaration, exact
 *     staging allowlist, and tarball output.
 * Flags: --e2e additionally runs the Playwright browser suite (requires a
 * provider key chain; see tests/e2e-scaffold.ts).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const PKG = join(ROOT, 'packages', 'dsh-web-review')
const DIST = join(ROOT, 'dist')
const OFFICIAL = join(DIST, 'package')
const runE2e = process.argv.includes('--e2e')

const FAILURES: string[] = []

/** Run one command; a non-zero exit records a failure. */
function run(label: string, command: string, args: readonly string[]): void {
  process.stdout.write(`check: ${label} ... `)
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
  if (result.status === 0) {
    console.log('ok')
    return
  }
  console.log(`FAILED (${String(result.status)})`)
  if (result.stdout !== '') process.stdout.write(`${result.stdout.slice(-2000)}\n`)
  if (result.stderr !== '') process.stdout.write(`${result.stderr.slice(-2000)}\n`)
  FAILURES.push(label)
}

/** Assert a boolean contract; a violation records a failure. */
function assert(label: string, check: () => boolean, detail: () => string): void {
  process.stdout.write(`check: ${label} ... `)
  if (check()) {
    console.log('ok')
    return
  }
  console.log('FAILED')
  console.log(`  ${detail()}`)
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

run('typecheck (tsc -b --force)', process.execPath, [
  join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'),
  '-b', '--force',
])
run('unit suite (vitest)', 'pnpm', ['vitest', 'run'])

// 3. gen-config idempotence: regenerate and compare with the committed files.
const entryBefore = readFileSync(join(PKG, 'entry-name.json'), 'utf8')
const cordisBefore = readFileSync(join(ROOT, 'cordis.yml'), 'utf8')
run('gen-config regeneration', process.execPath, ['--import', 'tsx', join(ROOT, 'scripts/gen-config.ts')])
assert(
  'gen-config idempotent (entry-name.json + cordis.yml unchanged)',
  () => readFileSync(join(PKG, 'entry-name.json'), 'utf8') === entryBefore
    && readFileSync(join(ROOT, 'cordis.yml'), 'utf8') === cordisBefore,
  () => 'generated files changed — run `pnpm gen-config` after moving the repo (absolute-path entry)',
)

// 4. Bundle contract: banner id == entry name; directory-import entry exists.
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
const packageManifest = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as { name: string; version: string }
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

// 5. Build.
run('build (tsdown)', 'pnpm', ['--filter', '@dsh-external/dsh-web-review', 'build'])

// 6. Official DSH profile bundle: stable id plus an exact prebuilt tarball.
assert(
  'official bundle banner id matches package name',
  () => {
    const client = readFileSync(join(PKG, 'lib', 'client-official.js'), 'utf8')
    const match = /__ModuleLoader__\.load\(\{[\s\S]*?id:\s*("[^"]*")/.exec(client)
    return match?.[1] !== undefined && (JSON.parse(match[1]) as string) === packageManifest.name
  },
  () => 'lib/client-official.js missing or its banner id drifted from package.json',
)
run('assemble official DSH package', process.execPath, ['--import', 'tsx', join(ROOT, 'scripts/package-official.ts')])
const expectedOfficialFiles = [
  'README.md',
  'cordis.patch.yml',
  'docs/assets/web-review-annotation-editor.jpg',
  'docs/assets/web-review-preview.jpg',
  'lib/client-official.js',
  'lib/client-official.js.map',
  'lib/index.js',
  'package.json',
]
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

if (runE2e) {
  run('e2e (Playwright browser suite)', 'pnpm', ['test:e2e'])
}

if (FAILURES.length > 0) {
  console.error(`\ncheck: ${FAILURES.length} gate(s) failed: ${FAILURES.join(', ')}`)
  process.exit(1)
}
console.log('\ncheck: all gates passed.')
