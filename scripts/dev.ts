/**
 * One-command dev: prepare the harness checkout once, regenerate the launch
 * overlay, then run the 0811 app-owned `dsh web` CLI together with this
 * package's tsdown watch (rebuilds the client bundle). Both must
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
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { materializeHarnessLinks } from './harness-links.ts'
import { resolveHarnessCli, resolveHarnessRoot } from './harness-path.ts'
import { materializeProfilePluginLink } from './profile-plugin-link.ts'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const harness = resolveHarnessRoot(root)
const port = process.env.DSH_WEB_PORT ?? '3090'
const host = process.env.DSH_WEB_HOST ?? '127.0.0.1'
const setupOnly = process.argv.includes('--setup-only')
const skipWatch = process.argv.includes('--no-watch')
const dshHome = process.env.DSH_HOME?.trim() === '' || process.env.DSH_HOME === undefined
  ? join(homedir(), '.dsh')
  : process.env.DSH_HOME

/** Harness readiness: dependencies + built app CLI + client/web artifacts. */
function harnessReady(): boolean {
  return existsSync(join(harness, 'node_modules'))
    && existsSync(join(harness, 'apps/web/dist'))
    && existsSync(join(harness, 'apps/cli/node_modules'))
    && existsSync(join(harness, 'apps/cli/lib/bin.js'))
    && existsSync(join(harness, 'packages/client/modules/lib/index.js'))
}

// 1. Launch overlay + banner id from the stable development alias.
spawnSync(process.execPath, ['--import', 'tsx', join(root, 'scripts/gen-config.ts')], { cwd: root, stdio: 'inherit' })

// 2. One-time harness prep (install + full build) when not ready.
if (!harnessReady()) {
  console.log(`dev: harness not ready at ${harness} — running pnpm install && pnpm build (one-time, minutes)`)
  for (const args of [['install', '--frozen-lockfile'], ['build']]) {
    const result = spawnSync('pnpm', args, { cwd: harness, stdio: 'inherit' })
    if (result.status !== 0) {
      console.error(`dev: harness step "pnpm ${args.join(' ')}" failed (status ${result.status})`)
      process.exit(1)
    }
  }
}
const links = materializeHarnessLinks(root, harness)
console.log(`dev: Harness links ready (${links.verified} verified, ${links.changed} updated)`)
if (setupOnly) {
  console.log('dev: harness ready.')
  process.exit(0)
}
const profileLink = materializeProfilePluginLink(root, dshHome)
console.log(`dev: source package linked at ${profileLink}`)

// 3. dsh web with the plugin overlay; 0811 mounts the HMR receiver in every
// Web profile. Launcher-owned --patch precedes app-owned --host/--port.
// cwd = this repo so the session
// workspace root (and the AI's file tools) defaults to the user's project.
const bin = resolveHarnessCli(harness)
const webArgs = [
  bin,
  'web',
  '--patch', join(root, 'cordis.yml'),
  '--host', host,
  '--port', port,
]
console.log(`dev: starting dsh web on http://${host}:${port} (cwd ${root})`)
const web = spawn(process.execPath, webArgs, { cwd: root, stdio: 'inherit', env: process.env })

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
