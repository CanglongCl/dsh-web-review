/**
 * One-command dev: prepare the harness checkout once, regenerate the launch
 * overlay, then run `dsh web --dev` (client-plugin HMR receiver) together
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
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveHarnessRoot } from './harness-path.ts'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const harness = resolveHarnessRoot(root)
const port = process.env.DSH_WEB_PORT ?? '3090'
const host = process.env.DSH_WEB_HOST ?? '127.0.0.1'
const setupOnly = process.argv.includes('--setup-only')
const skipWatch = process.argv.includes('--no-watch')

/** Harness readiness: dependencies + built lib tree + web dist (bin runs via tsx from src). */
function harnessReady(): boolean {
  return existsSync(join(harness, 'node_modules'))
    && existsSync(join(harness, 'apps/web/dist'))
    && existsSync(join(harness, 'apps/cli/node_modules'))
    && existsSync(join(harness, 'packages/client/modules/lib/index.js'))
}

// 1. Launch overlay + banner id from this checkout's absolute path (tsx runs the TS script).
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
if (setupOnly) {
  console.log('dev: harness ready.')
  process.exit(0)
}

// 3. dsh web --dev with the plugin overlay; cwd = this repo so the session
// workspace root (and the AI's file tools) defaults to the user's project.
const bin = join(harness, 'bin', 'dsh')
const webArgs = [
  'web',
  '--dev',
  '--host', host,
  '--port', port,
  '--patch', join(root, 'cordis.yml'),
]
console.log(`dev: starting dsh web on http://${host}:${port} (cwd ${root})`)
const web = spawn(bin, webArgs, { cwd: root, stdio: 'inherit', env: process.env })

// 4. Client-bundle watch (HMR rebuilds; the --dev host broadcasts rebuilt frames).
let watch: ChildProcess | undefined
if (!skipWatch) {
  console.log('dev: starting tsdown watch for the client bundle')
  watch = spawn('pnpm', ['run', 'build:watch'], { cwd: root, stdio: 'inherit', env: process.env })
}

const children: ChildProcess[] = watch === undefined ? [web] : [web, watch]
const stop = () => { for (const child of children) { if (!child.killed) child.kill('SIGTERM') } }
process.on('SIGINT', () => { stop(); process.exit(130) })
process.on('SIGTERM', () => { stop(); process.exit(0) })
