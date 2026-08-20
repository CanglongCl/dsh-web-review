/**
 * Quality gate (`pnpm check`): the strict verification surface for this repo.
 * Runs after `pnpm install`; generated/build artifacts may be absent:
 *  1. bootstrap — generate deterministic development configuration;
 *  2. typecheck — source/scripts solution plus every unit/component/E2E test;
 *  3. build — tsdown produces the node half plus both client channels;
 *  4. unit suite — vitest, including the real directory-entry load;
 *  5. config/package contracts — generated config is deterministic, 0812
 *     Cordis/CLI names, current dsh.client + dsh.bundle shape, both banner ids, and the
 *     native-ESM package entry;
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
import { DEVELOPMENT_ENTRY_NAME } from './development-entry.ts'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const PKG = join(ROOT, 'packages', 'dsh-web-review')
const DIST = join(ROOT, 'dist')
const OFFICIAL = join(DIST, 'package')
const EXPECTED_PACKAGE_NAME = '@canglongcl/dsh-web-review'
const EXPECTED_REGISTRY = 'https://registry.npmjs.org/'
const EXPECTED_REPOSITORY = 'git+https://github.com/CanglongCl/dsh-web-review.git'
const LOCKFILE = readFileSync(join(ROOT, 'pnpm-lock.yaml'), 'utf8')
const EXPECTED_PUBLIC_DEVELOPMENT_VERSIONS: Record<string, string> = {
  '@deepseek-ai/cordis': '4.0.1',
  '@deepseek-ai/cordis-plugin-include': '1.0.6',
  '@deepseek-ai/cordis-plugin-loader': '1.0.2',
  '@deepseek-ai/dsh-agent': '0.1.0-rc.6',
  '@deepseek-ai/dsh-client-locale': '0.1.0-rc.6',
  '@deepseek-ai/dsh-client-runtime': '0.1.0-rc.6',
  '@deepseek-ai/dsh-client-ui-commands': '0.1.0-rc.6',
  '@deepseek-ai/dsh-client-ui-conversation': '0.1.0-rc.6',
  '@deepseek-ai/dsh-client-ui-layout': '0.1.0-rc.6',
  '@deepseek-ai/dsh-client-ui-primitives': '0.1.0-rc.6',
  '@deepseek-ai/dsh-client-ui-slots': '0.1.0-rc.6',
  '@deepseek-ai/dsh-host-webserver': '0.1.0-rc.6',
  '@deepseek-ai/dsh-llm': '0.1.0-rc.6',
  '@deepseek-ai/dsh-session': '0.1.0-rc.6',
  '@deepseek-ai/dsh-skill': '0.1.0-rc.6',
  '@deepseek-ai/dsh-system-prompt': '0.1.0-rc.6',
  '@deepseek-ai/schemastery': '3.18.1',
}
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

/** npm's deterministic tarball basename for one package identity. */
function tarballName(name: string, version: string): string {
  return `${name.replace(/^@/u, '').replaceAll('/', '-')}-${version}.tgz`
}

// Bootstrap is deliberately part of the gate: a clean git worktree carries
// neither generated launch config nor built bundles.
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
  () => 'generated development config changed across two consecutive runs',
)
const webLauncherFiles = [
  join(ROOT, 'scripts', 'dev.ts'),
  join(ROOT, 'scripts', 'acceptance.ts'),
  join(PKG, 'tests', 'e2e-scaffold.ts'),
]
assert(
  '0812 Web launchers share the built-CLI helper',
  () => webLauncherFiles.every(path => {
    const source = readFileSync(path, 'utf8')
    return source.includes('harnessWebLaunch(')
      && !source.includes("'--dev'")
      && !source.includes("'bin', 'dsh'")
  }),
  () => 'dev, acceptance, and E2E launchers must use harnessWebLaunch without bin/dsh or --dev',
)

run('source + scripts typecheck (tsc -b --force)', process.execPath, [
  join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'),
  '-b', '--force',
])
run('eval runner typecheck (tsc -p)', process.execPath, [
  join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'),
  '-p', join(ROOT, 'eval', 'runner-plugin', 'tsconfig.json'),
])
run('test typecheck (unit + component + E2E)', process.execPath, [
  join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'),
  '-p', join(ROOT, 'tsconfig.tests.json'),
])
run('release identity', process.execPath, ['--import', 'tsx', join(ROOT, 'scripts/verify-release.ts')])
run('build (tsdown)', 'pnpm', ['--filter', './packages/dsh-web-review', 'build'])
run('unit suite (vitest)', 'pnpm', ['vitest', 'run'])

// Bundle contract: banner id == entry name; package main is built for native ESM.
const entryName = (JSON.parse(entryBefore) as { name: string }).name
assert(
  'development launch uses the profile-local package alias',
  () => entryName === DEVELOPMENT_ENTRY_NAME
    && cordisBefore.includes(`name: ${JSON.stringify(DEVELOPMENT_ENTRY_NAME)}`)
    && [
      join(ROOT, 'scripts', 'dev.ts'),
      join(ROOT, 'scripts', 'acceptance.ts'),
      join(PKG, 'tests', 'e2e-scaffold.ts'),
    ].map(file => readFileSync(file, 'utf8')).every(source =>
      source.includes('materializeProfilePluginLink')),
  () => 'entry-name.json, cordis.yml, and every launcher must share and materialize the 0812 development alias',
)
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
assert(
  'source package declares the official dsh.bundle patch',
  () => {
    const manifest = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as {
      dsh?: { bundle?: { patch?: string } }
    }
    return manifest.dsh?.bundle?.patch === './cordis.patch.yml'
      && existsSync(join(PKG, 'cordis.patch.yml'))
  },
  () => 'package.json must declare dsh.bundle with the committed cordis.patch.yml next to it (installability contract)',
)
const repositoryManifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }
const packageManifest = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as {
  name: string
  version: string
  private?: boolean
  publishConfig?: { access?: string; registry?: string }
  repository?: { type?: string; url?: string }
  devDependencies?: Record<string, string>
  exports?: Record<string, unknown>
}
assert(
  'source package keeps the public publication boundary',
  () => packageManifest.name === EXPECTED_PACKAGE_NAME
    && packageManifest.private === true
    && packageManifest.publishConfig?.access === 'public'
    && packageManifest.publishConfig.registry === EXPECTED_REGISTRY
    && packageManifest.repository?.type === 'git'
    && packageManifest.repository.url === EXPECTED_REPOSITORY,
  () => `source manifest must guard direct workspace publication while staging public ${EXPECTED_PACKAGE_NAME}`,
)
assert(
  'source package exposes only runtime entrypoints',
  () => JSON.stringify(Object.keys(packageManifest.exports ?? {}).sort())
    === JSON.stringify(['.', './client', './package.json'].sort()),
  () => 'package.json exports must not expose private src/* modules or missing declaration artifacts',
)
assert(
  'source package uses the public 0812 runtime packages',
  () => {
    const dependencies = packageManifest.devDependencies ?? {}
    const deepseekDependencies = Object.entries(dependencies)
      .filter(([name]) => name.startsWith('@deepseek-ai/'))
    return deepseekDependencies.length === Object.keys(EXPECTED_PUBLIC_DEVELOPMENT_VERSIONS).length
      && deepseekDependencies.every(([name, specifier]) =>
        EXPECTED_PUBLIC_DEVELOPMENT_VERSIONS[name] === specifier)
      && dependencies.cordis === undefined
      && dependencies['@cordisjs/plugin-loader'] === undefined
      && dependencies['@cordisjs/plugin-include'] === undefined
      && readFileSync(join(PKG, 'tsdown.config.ts'), 'utf8').includes("'@deepseek-ai/cordis'")
  },
  () => 'public npm dependencies and browser platform externals must use the exact pinned 0812 @deepseek-ai package line',
)
const migrationSurfaces = [
  join(PKG, 'package.json'),
  join(PKG, 'src', 'index.ts'),
  join(PKG, 'src', 'annotation-context.ts'),
  join(PKG, 'src', 'client', 'index.ts'),
  join(PKG, 'tests', 'entry-load.spec.ts'),
]
assert(
  '0812 public vocabulary has no 0811 aliases',
  () => migrationSurfaces.every((file) => {
    const source = readFileSync(file, 'utf8')
    return !source.includes('@deepseek-ai/dsh-client-ui-command"')
      && !source.includes('@deepseek-ai/dsh-client-ui-command/client')
      && !source.includes('CommandServiceContract')
      && !source.includes('SkillService')
      && !source.includes('httpServer')
  }),
  () => 'source, manifests, and composition tests must use commandUi, SkillRegistry, and webServer only',
)
assert(
  'lockfile is registry-backed and machine-independent',
  () => !LOCKFILE.includes('link:') && !LOCKFILE.includes('/Users/') && !LOCKFILE.includes('C:\\Users\\'),
  () => 'pnpm-lock.yaml must not contain link: dependencies or machine-local user paths',
)
assert(
  'launchers use the 0812 app-owned CLI',
  () => {
    const source = readFileSync(join(ROOT, 'scripts', 'harness-cli.ts'), 'utf8')
    return source.includes('resolveHarnessCli')
      && source.indexOf("'--patch'") < source.indexOf("'--host'")
      && !source.includes("'--dev'")
      && !source.includes("'--import', 'tsx'")
  },
  () => '0812 launches apps/cli/lib/bin.js with --patch before app flags and has no --dev option',
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
  'native-ESM package entry exists',
  () => packageManifest.exports?.['.'] === './lib/index.js'
    && existsSync(join(PKG, 'lib', 'index.js')),
  () => 'package.json must export the built lib/index.js entry used by the 0812 profile-local alias',
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
  'README_en.md',
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
        private?: boolean
        main: string
        publishConfig?: { access?: string; registry?: string }
        repository?: { type?: string; url?: string }
        dependencies?: unknown
        devDependencies?: unknown
        exports?: { './client'?: string }
        dsh?: { bundle?: { patch?: string }; client?: { platform?: string } }
      }
      return manifest.name === packageManifest.name
        && manifest.version === repositoryManifest.version
        && manifest.version === packageManifest.version
        && manifest.private === undefined
        && manifest.publishConfig?.access === 'public'
        && manifest.publishConfig.registry === EXPECTED_REGISTRY
        && manifest.repository?.type === 'git'
        && manifest.repository.url === EXPECTED_REPOSITORY
        && manifest.dependencies === undefined
        && manifest.devDependencies === undefined
        && manifest.dsh?.bundle?.patch === './cordis.patch.yml'
        && manifest.dsh?.client?.platform === 'web'
        && existsSync(join(OFFICIAL, manifest.main))
        && manifest.exports?.['./client'] !== undefined
        && existsSync(join(OFFICIAL, manifest.exports['./client']))
        && existsSync(join(OFFICIAL, manifest.dsh.bundle.patch))
    },
    () => 'staged package.json must publish the public package and declare valid dsh.bundle/dsh.client entries',
  )
  assert(
    'official package text contains no credentials or machine paths',
    () => expectedOfficialFiles
      .filter(file => /\.(?:js|json|map|md|yml)$/u.test(file))
      .map(file => readFileSync(join(OFFICIAL, file), 'utf8'))
      .every(source => !/\bnpm_[0-9A-Za-z]{20,}\b/u.test(source)
        && !/_authToken\s*=\s*(?!\$\{[A-Z][A-Z0-9_]*\})\S+/u.test(source)
        && !source.includes(ROOT)),
    () => 'dist/package contains credential configuration or this checkout absolute path',
  )
  const packageName = tarballName(packageManifest.name, packageManifest.version)
  assert(
    'official tarball exists',
    () => existsSync(join(DIST, packageName)),
    () => 'pnpm pack did not produce the expected dist/*.tgz file',
  )
  assert(
    'official tarball checksum is current',
    () => {
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
