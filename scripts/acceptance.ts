/**
 * Persistent isolated manual-acceptance environment.
 *
 * Unlike the disposable browser E2E scaffold, this command keeps its DSH
 * home beneath `.artifacts/acceptance/`, so workspace connections, sessions,
 * and conversation history survive restarts without touching the user's
 * normal profile. It runs the current checkout through the development
 * overlay and starts the demo plus the client-bundle watcher.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { harnessWebLaunch } from './harness-cli.ts'
import { resolveHarnessRoot } from './harness-path.ts'
import { ensureAcceptanceHistory } from './acceptance-history.ts'
import { materializeProfilePluginLink } from './profile-plugin-link.ts'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const harness = resolveHarnessRoot(root)
const stateRoot = join(root, '.artifacts', 'acceptance')
const dshHome = join(stateRoot, 'dsh-home')
const overlayPath = join(stateRoot, 'acceptance.cordis.yml')
const portsPath = join(stateRoot, 'ports.json')
const host = process.env.DSH_WEB_HOST ?? '127.0.0.1'
const welcome = await import(join(
  harness,
  'packages/client/ui-settings-general/src/onboarding-copy.ts',
)) as {
  WELCOME_NOTICE_ACK_FIELD: string
  WELCOME_NOTICE_SETTINGS_NAMESPACE: string
  WELCOME_NOTICE_VERSION: string
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, host, () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        server.close(() => { reject(new Error('port probe returned no address')) })
        return
      }
      server.close(() => { resolve(address.port) })
    })
  })
}

async function portAvailable(port: number): Promise<boolean> {
  return await new Promise(resolve => {
    const server = createServer()
    server.once('error', () => { resolve(false) })
    server.listen(port, host, () => { server.close(() => { resolve(true) }) })
  })
}

async function acceptancePorts(): Promise<{ web: number; demo: number }> {
  const webOverride = process.env.DSH_WEB_PORT
  const demoOverride = process.env.DEMO_PORT
  let stored: { web: number; demo: number } | undefined
  if (existsSync(portsPath)) {
    stored = JSON.parse(readFileSync(portsPath, 'utf8')) as { web: number; demo: number }
  }
  const web = Number(webOverride ?? stored?.web ?? await freePort())
  let demo = Number(demoOverride ?? stored?.demo ?? await freePort())
  while (demo === web && demoOverride === undefined && stored === undefined) demo = await freePort()
  if (!Number.isInteger(web) || !Number.isInteger(demo) || web <= 0 || demo <= 0 || web === demo) {
    throw new Error('acceptance ports must be distinct positive integers')
  }
  if (!await portAvailable(web)) throw new Error(`acceptance DSH port ${String(web)} is already in use`)
  if (!await portAvailable(demo)) throw new Error(`acceptance demo port ${String(demo)} is already in use`)
  if (stored === undefined && webOverride === undefined && demoOverride === undefined) {
    writeFileSync(portsPath, `${JSON.stringify({ web, demo }, null, 2)}\n`)
  }
  return { web, demo }
}

function prepareProfile(): void {
  mkdirSync(dshHome, { recursive: true })
  const settingsPath = join(dshHome, 'settings.yaml')
  if (!existsSync(settingsPath)) {
    writeFileSync(settingsPath, [
      `${welcome.WELCOME_NOTICE_SETTINGS_NAMESPACE}:`,
      `  ${welcome.WELCOME_NOTICE_ACK_FIELD}: ${welcome.WELCOME_NOTICE_VERSION}`,
      '',
    ].join('\n'))
  }

  for (const candidate of [join(root, '.env'), join(homedir(), '.dsh', '.env')]) {
    try {
      process.loadEnvFile(candidate)
      break
    } catch {
      // Candidate absent — try the next product-supported source.
    }
  }

  const persistentCredentials = join(dshHome, '.credentials.yaml')
  const defaultCredentials = join(homedir(), '.dsh', '.credentials.yaml')
  if (process.env.DEEPSEEK_API_KEY === undefined
    && !existsSync(persistentCredentials)
    && existsSync(defaultCredentials)) {
    copyFileSync(defaultCredentials, persistentCredentials)
    chmodSync(persistentCredentials, 0o600)
    console.log('acceptance: copied configured DSH credentials into the isolated profile (mode 0600)')
  }
}

const setup = spawnSync(process.execPath, ['--import', 'tsx', join(root, 'scripts/dev.ts'), '--setup-only'], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
})
if (setup.status !== 0) process.exit(setup.status ?? 1)
if (!existsSync(join(root, 'packages', 'dsh-web-review', 'lib', 'client.js'))
  || !existsSync(join(root, 'packages', 'dsh-web-review', 'lib', 'index.js'))) {
  const build = spawnSync('pnpm', ['run', 'build'], { cwd: root, stdio: 'inherit', env: process.env })
  if (build.status !== 0) process.exit(build.status ?? 1)
}

prepareProfile()
materializeProfilePluginLink(root, dshHome)
const entryName = JSON.parse(
  readFileSync(join(root, 'packages', 'dsh-web-review', 'entry-name.json'), 'utf8'),
) as { name: string }
writeFileSync(overlayPath, [
  '- insert:',
  '    - id: dsh-web-review',
  `      name: ${JSON.stringify(entryName.name)}`,
  '- id: directory-picker',
  '  disabled: true',
  '- insert:',
  "    - id: directory-picker-browse",
  "      name: '@deepseek-ai/dsh-host-directory-picker-browse'",
  '- id: telemetry-otel',
  '  disabled: true',
  '- id: llm-deepseek',
  '  config:',
  '    retryPolicy:',
  '      mode: normal',
  '      maxRetries: 0',
  '',
].join('\n'))

const ports = await acceptancePorts()
const webPort = String(ports.web)
const demoPort = String(ports.demo)
const seededHistory = await ensureAcceptanceHistory({
  harness,
  dshHome,
  cwd: root,
  demoUrl: `http://${host}:${demoPort}/`,
})
const sharedEnv: NodeJS.ProcessEnv = { ...process.env, DSH_HOME: dshHome }
const children: ChildProcess[] = []

const start = (command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv = sharedEnv): ChildProcess => {
  const child = spawn(command, args, { cwd, stdio: 'inherit', env })
  children.push(child)
  return child
}

console.log(`acceptance: profile and history: ${dshHome}`)
console.log(`acceptance: DSH UI: http://${host}:${webPort}`)
console.log(`acceptance: demo page: http://${host}:${demoPort}`)
console.log(`acceptance: mock history: ${seededHistory ? 'created' : 'reused'} (网页批注验收)`)
console.log('acceptance: open 网页批注验收 and click its Demo link')

const launch = harnessWebLaunch(harness, overlayPath, host, webPort, sharedEnv)
const web = start(launch.command, launch.args, root, launch.env)
start('pnpm', ['run', 'build:watch'], root)
start(process.execPath, ['--import', 'tsx', join(root, 'demo/server.ts'), demoPort], root, process.env)

let stopping = false
const stop = (code: number): void => {
  if (stopping) return
  stopping = true
  for (const child of children) if (!child.killed) child.kill('SIGTERM')
  process.exit(code)
}
process.on('SIGINT', () => { stop(130) })
process.on('SIGTERM', () => { stop(0) })
web.once('exit', code => { stop(code ?? 1) })
