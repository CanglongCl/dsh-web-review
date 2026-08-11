/**
 * One-command dev: prepare the harness checkout once, regenerate the launch
 * overlay, then run the 0811 built CLI (whose HMR receiver is always mounted)
 * with this package's tsdown watch (rebuilds the client bundle). Both must
 * run from their own places per the loading model — neither alone updates
 * the GUI; browser refresh applies rebuilt bundles, node-half changes need
 * a web-process restart (cordis HMR is disabled for web).
 *
 * Usage:
 *   pnpm dev                 — full dev loop (web + watch)
 *   pnpm dev -- --setup-only — harness prep only (install + build)
 *   pnpm dev -- --no-watch   — web only, no bundle watch
 * Env: DSH_HARNESS (explicit checkout override), DSH_WEB_PORT (default 3090),
 *      DSH_WEB_HOST (default 127.0.0.1). Without an override, the linked
 *      runtime package identifies the harness checkout.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { harnessWebLaunch } from './harness-cli.ts'
import { materializeHarnessLinks } from './harness-links.ts'
import { resolveHarnessRoot } from './harness-path.ts'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const harness = resolveHarnessRoot(root)
const port = process.env.DSH_WEB_PORT ?? '3090'
const host = process.env.DSH_WEB_HOST ?? '127.0.0.1'
const setupOnly = process.argv.includes('--setup-only')
const skipWatch = process.argv.includes('--no-watch')
const buildStampPath = join(root, '.artifacts', 'harness-build.json')

/** Exact Harness commit whose generated artifacts must match this checkout. */
function harnessHead(): string {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: harness, encoding: 'utf8' })
  if (result.status !== 0 || result.stdout.trim() === '') {
    throw new Error(`dev: cannot resolve Harness HEAD at ${harness}: ${result.stderr.trim()}`)
  }
  return result.stdout.trim()
}

const head = harnessHead()

/** Harness readiness: current-commit stamp plus the 0811 built CLI and runtime artifacts. */
function harnessReady(): boolean {
  let stamp: { harness?: string; head?: string } = {}
  try {
    stamp = JSON.parse(readFileSync(buildStampPath, 'utf8')) as typeof stamp
  } catch {
    return false
  }
  return stamp.harness === harness
    && stamp.head === head
    && existsSync(join(harness, 'node_modules'))
    && existsSync(join(harness, 'apps/web/dist'))
    && existsSync(join(harness, 'apps/cli/lib/bin.js'))
    && existsSync(join(harness, 'packages/client/modules/lib/index.js'))
}

// 1. Launch overlay + banner id from this checkout's absolute path (tsx runs the TS script).
spawnSync(process.execPath, ['--import', 'tsx', join(root, 'scripts/gen-config.ts')], { cwd: root, stdio: 'inherit' })

// 2. Commit-aware harness prep. Clean first so a tag switch cannot reuse
// deleted-package artifacts from the previous snapshot.
if (!harnessReady()) {
  console.log(`dev: Harness artifacts do not match ${head.slice(0, 12)} — installing, cleaning, and rebuilding`)
  for (const args of [['install', '--frozen-lockfile'], ['clean'], ['build']]) {
    const result = spawnSync('pnpm', args, { cwd: harness, stdio: 'inherit' })
    if (result.status !== 0) {
      console.error(`dev: harness step "pnpm ${args.join(' ')}" failed (status ${result.status})`)
      process.exit(1)
    }
  }
  mkdirSync(dirname(buildStampPath), { recursive: true })
  writeFileSync(buildStampPath, `${JSON.stringify({ harness, head }, null, 2)}\n`)
}
const links = materializeHarnessLinks(root, harness)
console.log(`dev: Harness links ready (${links.verified} verified, ${links.changed} updated)`)
if (setupOnly) {
  console.log('dev: harness ready.')
  process.exit(0)
}

// 3. 0811 built CLI with the plugin overlay; cwd = this repo so the session
// workspace root (and the AI's file tools) defaults to the user's project.
const launch = harnessWebLaunch(harness, join(root, 'cordis.yml'), host, port)
console.log(`dev: starting dsh web on http://${host}:${port} (cwd ${root})`)
const web = spawn(launch.command, launch.args, { cwd: root, stdio: 'inherit', env: launch.env })

// 4. Client-bundle watch (the always-mounted HMR host broadcasts rebuilt frames).
let watch: ChildProcess | undefined
if (!skipWatch) {
  console.log('dev: starting tsdown watch for the client bundle')
  watch = spawn('pnpm', ['run', 'build:watch'], { cwd: root, stdio: 'inherit', env: process.env })
}

const children: ChildProcess[] = watch === undefined ? [web] : [web, watch]
let stopping = false
const stop = () => {
  stopping = true
  for (const child of children) { if (!child.killed) child.kill('SIGTERM') }
}
for (const [label, child] of [
  ['dsh web', web],
  ...(watch === undefined ? [] : [['client bundle watch', watch] as const]),
] as const) {
  child.once('error', (error) => {
    if (stopping) return
    console.error(`dev: ${label} failed to start: ${String(error)}`)
    stop()
    process.exitCode = 1
  })
  child.once('exit', (code, signal) => {
    if (stopping) return
    console.error(`dev: ${label} exited unexpectedly (${signal ?? `status ${code ?? 'unknown'}`})`)
    stop()
    process.exitCode = code === null || code === 0 ? 1 : code
  })
}
process.on('SIGINT', () => { stop(); process.exit(130) })
process.on('SIGTERM', () => { stop(); process.exit(0) })
