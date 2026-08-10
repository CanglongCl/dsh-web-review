/**
 * E2E scaffold: services under test + browser plumbing.
 *
 * Mirrors the harness web-e2e pattern (apps/web/tests/support.ts): services
 * are spawned for the run (this repo's dev instance via scripts/dev.ts
 * `--no-watch`, plus the demo page server), the browser boots with a fixed
 * English locale so role locators stay deterministic, workspace connection
 * follows the harness's dialog flow, and failure evidence lands in the
 * gitignored `.artifacts/`.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Locator, Page } from 'playwright'
import { chromium } from 'playwright'
import {
  WELCOME_NOTICE_ACK_FIELD,
  WELCOME_NOTICE_SETTINGS_NAMESPACE,
  WELCOME_NOTICE_VERSION,
} from '@deepseek-ai/dsh-client-ui-settings-general'
import { resolveHarnessRoot } from '../../../scripts/harness-path.ts'

/** Repo root (dsh-web-review). */
export const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/** Spawned services for one e2e run. */
export interface E2EServices {
  webUrl: string
  demoUrl: string
  /** Temp dir staged as the connected workspace root. */
  workspaceRoot: string
  stop: () => Promise<void>
}

/** OS-assigned free port (released before use). */
export function probeFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      if (address === null || typeof address === 'string') {
        probe.close(() => { reject(new Error('port probe returned no address')) })
        return
      }
      probe.close(() => { resolvePort(address.port) })
    })
  })
}

/** Poll `check` until it resolves true or the timeout elapses. */
export async function waitFor(check: () => Promise<boolean> | boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      if (await check()) return
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => { setTimeout(resolve, 500) })
  }
  throw new Error(`waitFor(${label}) timed out after ${timeoutMs}ms${lastError === undefined ? '' : `: ${String(lastError)}`}`)
}

/**
 * Start the dev instance (`dsh web --dev --patch ./cordis.yml`, no bundle
 * watch — the e2e asserts the built bundle) and the demo page server on
 * free ports. Returns the URLs plus a stopper.
 */
export async function startServices(): Promise<E2EServices> {
  const webPort = await probeFreePort()
  const demoPort = await probeFreePort()
  // Isolated harness home: a fresh GUI must boot into the hero (workspace
  // picker) state instead of inheriting the developer's ~/.dsh sessions.
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-web-review-e2e-home-'))
  // Configuration-level overlay dismissal, mirroring the harness: resolve
  // the provider key through the same chain the product uses (repo .env,
  // then the current user's harness home .env) so the model onboarding
  // closes itself (deepSeekReadiness → 'configured'); pre-write the
  // welcome-notice acknowledgement into $DSH_HOME/settings.yaml (exact
  // version match) so the first-boot notice never renders. With a real key
  // the blank-state probe message succeeds and the session stays
  // non-blank; without one it fails instantly against a dead endpoint.
  for (const candidate of [join(REPO_ROOT, '.env'), join(homedir(), '.dsh', '.env')]) {
    try {
      process.loadEnvFile(candidate)
      break
    } catch {
      // Candidate absent — try the next.
    }
  }
  const apiKey = process.env.DEEPSEEK_API_KEY
  writeFileSync(join(dshHome, 'settings.yaml'), [
    `${WELCOME_NOTICE_SETTINGS_NAMESPACE}:`,
    `  ${WELCOME_NOTICE_ACK_FIELD}: ${WELCOME_NOTICE_VERSION}`,
    '',
  ].join('\n'))
  const logs: string[] = []
  const capture = (label: string) => (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split('\n')) {
      if (line.trim() !== '') logs.push(`[${label}] ${line}`)
    }
  }

  // E2E overlay: the dsh-web-review row plus the harness scaffold's own
  // configuration-layer fixes — pin the in-app directory browser (the
  // shipped -auto chooser cannot resolve interactions headless) and disable
  // telemetry (no session logs should leave the test world).
  const entryName = JSON.parse(
    readFileSync(join(REPO_ROOT, 'packages', 'dsh-web-review', 'entry-name.json'), 'utf8'),
  ) as { name: string }
  const overlayPath = join(dshHome, 'e2e.cordis.yml')
  writeFileSync(overlayPath, [
    '- insert:',
    `    - id: dsh-web-review`,
    `      name: ${JSON.stringify(entryName.name)}`,
    '- id: directory-picker',
    '  disabled: true',
    '- insert:',
    "    - id: directory-picker-browse",
    "      name: '@deepseek-ai/dsh-host-directory-picker-browse'",
    '- id: telemetry-otel',
    '  disabled: true',
    // The blank-state probe message must fail instantly: patch the shipped
    // llm-deepseek row with a no-retry policy, so the turn settles and the
    // session header stops churning. Endpoint and credential resolution stay
    // on the product's environment/settings path.
    '- id: llm-deepseek',
    '  config:',
    '    retryPolicy:',
    '      mode: normal',
    '      maxRetries: 0',
    '',
  ].join('\n'))

  const harness = resolveHarnessRoot(REPO_ROOT)
  const bin = join(harness, 'bin', 'dsh')
  const web = spawn(bin, [
    'web',
    '--dev',
    '--host', '127.0.0.1',
    '--port', String(webPort),
    '--patch', overlayPath,
  ], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      DSH_HOME: dshHome,
      DEEPSEEK_API_KEY: apiKey,
      // With a real key the probe message hits the real provider; without
      // one, point it at a dead loopback so the failure settles instantly
      // (a hung turn would churn the session header).
      ...(apiKey === undefined ? { DEEPSEEK_BASE_URL: 'http://127.0.0.1:9' } : {}),
    },
  })
  web.stdout?.on('data', capture('web'))
  web.stderr?.on('data', capture('web'))

  const demo = spawn(process.execPath, ['--import', 'tsx', join(REPO_ROOT, 'demo/server.ts'), String(demoPort)], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  })
  demo.stdout?.on('data', capture('demo'))
  demo.stderr?.on('data', capture('demo'))

  const webUrl = `http://127.0.0.1:${webPort}`
  const demoUrl = `http://127.0.0.1:${demoPort}`
  try {
    await waitFor(async () => (await fetch(webUrl)).ok, 90_000, 'web ready')
    await waitFor(async () => (await fetch(demoUrl)).ok, 30_000, 'demo ready')
  } catch (error) {
    console.error(logs.join('\n'))
    web.kill('SIGTERM')
    demo.kill('SIGTERM')
    throw error
  }

  const workspaceRoot = await mkdtemp(join(tmpdir(), 'dsh-web-review-e2e-'))

  const stop = async (): Promise<void> => {
    web.kill('SIGTERM')
    demo.kill('SIGTERM')
    await rm(workspaceRoot, { recursive: true, force: true }).catch(() => {})
    await rm(dshHome, { recursive: true, force: true }).catch(() => {})
  }
  return { webUrl, demoUrl, workspaceRoot, stop }
}

/** Open the standard browser page with the English locale pinned (deterministic locators). */
export async function newPage(browser: Browser): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: 'en-US' })
  await page.addInitScript(() => { localStorage.setItem('dsh.locale', 'en') })
  return page
}

/**
 * Connect a fresh workspace through the sidebar's Add-workspace dialog (the
 * harness workspace-management path: with the -browse directory picker
 * pinned by {@link startServices}, the click lands directly in the in-app
 * 'Select Workspace Directory' dialog). First-boot overlays are suppressed
 * at the configuration layer (welcome-notice ack + provider key), so no UI
 * dismissal is needed here.
 * @param page - the page under test (already on the GUI URL).
 * @param root - workspace parent directory (a `workspace` folder is staged inside).
 */
export async function connectWorkspace(page: Page, root: string, name = 'workspace'): Promise<void> {
  mkdirSync(join(root, name), { recursive: true })
  await page.getByRole('button', { name: 'Add workspace' }).click()
  const dialog = page.getByRole('dialog', { name: 'Select Workspace Directory' })
  await dialog.waitFor({ timeout: 15_000 })
  await dialog.getByRole('button', { name: 'Edit path' }).click()
  const pathInput = dialog.getByRole('textbox', { name: 'Edit path' })
  await pathInput.fill(join(root, name))
  await pathInput.press('Enter')
  await dialog.getByRole('button', { name: 'Open', exact: true }).click()
  // The dialog must actually close: on a re-run the previous session's
  // composer can satisfy the wait below while the dialog still covers the
  // page, derailing every later gesture.
  await dialog.waitFor({ state: 'detached', timeout: 15_000 })
  // The startup initial-selection may open (or create) a blank session in the
  // most recent workspace BEFORE this connect lands; that session's hero shows
  // the SAME hero composer, so the wait below must first confirm the CURRENT
  // session is the freshly connected one. The hero's workspace chip names the
  // current session's workspace — wait for this workspace's basename before
  // sending the probe, or the 'hello' would go to the wrong (still blank)
  // session and this scenario would boot into a session that never renders the
  // view tablist.
  const heroSeat = page.locator('[data-composer-seat]')
  await heroSeat.getByText(name, { exact: true }).waitFor({ timeout: 20_000 })
  const composer = heroSeat.locator('textarea:enabled[placeholder="Describe what you want to build"]')
  await composer.waitFor({ timeout: 20_000 })
  // Leave the blank state: the conversation session header (and with it the
  // view tablist — [Chat] [Preview]) only renders once the session holds a
  // message. The probe message fails fast against the dead provider endpoint,
  // so the turn settles and the header stays mounted; wait for the Preview
  // tab here so callers never race the remount window.
  await composer.fill('hello')
  await composer.press('Enter')
  await page.getByRole('tab', { name: 'Web Preview' }).waitFor({ state: 'visible', timeout: 30_000 })
}

/** Poll until a click succeeds: the session header re-mounts while a turn
 * settles (post-send state churn detaches the webview toggle briefly), so a
 * single locator.click can exhaust its actionability retries on a detached
 * element. Retrying the whole gesture tolerates the remount window.
 * @param page - the page under test.
 * @param locator - the element to click.
 * @param timeoutMs - overall budget for the gesture.
 */
export async function clickWhenStable(page: Page, locator: Locator, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let last: unknown
  while (Date.now() < deadline) {
    try {
      await locator.click({ timeout: 5_000 })
      return
    } catch (error) {
      last = error
    }
    await page.waitForTimeout(300)
  }
  throw last instanceof Error ? last : new Error(String(last))
}

/** Failure evidence into the gitignored .artifacts/ (harness convention). */
export async function saveFailureShot(page: Page, name: string): Promise<void> {
  const dir = join(REPO_ROOT, '.artifacts')
  mkdirSync(dir, { recursive: true })
  try {
    await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true })
  } catch {
    // Best-effort: a dead page must not mask the real assertion error.
  }
}

export { chromium }
export type { Browser }
