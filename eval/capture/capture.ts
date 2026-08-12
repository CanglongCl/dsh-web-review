/**
 * Capture tool (`pnpm eval:capture`): produces the frozen REAL snapshot for a
 * task by driving the actual DSH Web GUI — the isolated Preview, the real
 * picker, the real property inspector, and the browser's own POST to
 * /webview-annotations — then freezing the exact wire body into
 * eval/tasks/frozen/<taskId>.snapshot.json plus capture metadata.
 *
 * Verify mode (--verify) re-captures and diffs the live snapshot against the
 * frozen one, failing on any drift so a stale bank is caught before paid runs.
 *
 * Flags: --task id (repeatable; default: every task) --verify
 */
import { spawn } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { harnessWebLaunch } from '../../scripts/harness-cli.ts'
import { resolveHarnessRoot } from '../../scripts/harness-path.ts'
import { materializeProfilePluginLink } from '../../scripts/profile-plugin-link.ts'
import { loadTask, loadTasks } from '../tasks/register.ts'
import { hashDir, baselineDir, FIXTURES_ROOT, REPO_ROOT, repoCommit, harnessCommit, probeFreePort } from '../runner/runner.ts'
import type { AdjustAction, CaptureMeta, EvalTask, FrozenSnapshot } from '../types.ts'

const CAPTURE_VIEWPORT = { width: 1680, height: 1000 }

/** Inspector control mapping for the Adjust actions the bank uses. */
const ADJUST_CONTROLS: Record<string, { kind: 'hex' | 'spinbutton' | 'text' | 'menu'; label: string }> = {
  'background-color': { kind: 'hex', label: 'Background' },
  color: { kind: 'hex', label: 'Text color' },
  'font-size': { kind: 'spinbutton', label: 'Font size' },
  width: { kind: 'spinbutton', label: 'Width' },
  gap: { kind: 'spinbutton', label: 'Gap' },
  'text-align': { kind: 'menu', label: 'Alignment' },
  text: { kind: 'text', label: 'Text content' },
}

async function waitFor(check: () => Promise<boolean> | boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      if (await check()) return
    } catch (error) {
      lastError = error
    }
    await new Promise(resolve => { setTimeout(resolve, 400) })
  }
  throw new Error(`waitFor(${label}) timed out${lastError === undefined ? '' : `: ${String(lastError)}`}`)
}

async function startFixtureServer(task: EvalTask): Promise<{ url: string; stop: () => void }> {
  const port = await probeFreePort()
  if (task.fixtureKind === 'static') {
    const child = spawn(process.execPath, ['--import', 'tsx', join(REPO_ROOT, 'eval', 'fixtures', 'serve.ts'), baselineDir(task.fixture), String(port)], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout?.on('data', (c: Buffer) => { console.error(`[fs out] ${c.toString().trim()}`) })
    child.stderr?.on('data', (c: Buffer) => { console.error(`[fs err] ${c.toString().trim()}`) })
    const url = `http://127.0.0.1:${port}/`
    await waitFor(async () => {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) })
      return response.ok
    }, 15_000, `${task.id} static server`)
    return { url, stop: () => { child.kill('SIGTERM') } }
  }
  const viteBin = join(FIXTURES_ROOT, 'node_modules', 'vite', 'bin', 'vite.js')
  // Vite apps also serve from a temp copy so the dep optimizer cannot write
  // into the committed baseline.
  const copy = mkdtempSync(join(tmpdir(), `eval-capture-${task.id}-`))
  cpSync(baselineDir(task.fixture), copy, { recursive: true, filter: (path) => !path.endsWith('.patch') })
  symlinkSync(join(FIXTURES_ROOT, 'node_modules'), join(copy, 'node_modules'), 'dir')
  const child = spawn(process.execPath, [viteBin, '--port', String(port), '--strictPort'], {
    cwd: copy,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.on('data', () => {})
  child.stderr?.on('data', () => {})
  const url = `http://127.0.0.1:${port}/`
  await waitFor(async () => (await fetch(url)).ok, 30_000, `${task.id} vite server`)
  return { url, stop: () => { child.kill('SIGTERM'); rmSync(copy, { recursive: true, force: true }) } }
}

async function bootGui(): Promise<{ webUrl: string; stop: () => Promise<void> }> {
  const dshHome = mkdtempSync(join(tmpdir(), 'dsh-web-review-capture-'))
  const harness = resolveHarnessRoot()
  const welcome = await import(pathToFileURL(
    join(harness, 'packages/client/ui-settings-general/src/onboarding-copy.ts'),
  ).href) as {
    WELCOME_NOTICE_ACK_FIELD: string
    WELCOME_NOTICE_SETTINGS_NAMESPACE: string
    WELCOME_NOTICE_VERSION: string
  }
  writeFileSync(join(dshHome, 'settings.yaml'), [
    `${welcome.WELCOME_NOTICE_SETTINGS_NAMESPACE}:`,
    `  ${welcome.WELCOME_NOTICE_ACK_FIELD}: ${welcome.WELCOME_NOTICE_VERSION}`,
    '',
  ].join('\n'))
  materializeProfilePluginLink(REPO_ROOT, dshHome, 'web')
  const entryName = JSON.parse(
    readFileSync(join(REPO_ROOT, 'packages', 'dsh-web-review', 'entry-name.json'), 'utf8'),
  ) as { name: string }
  const overlayPath = join(dshHome, 'capture.cordis.yml')
  writeFileSync(overlayPath, [
    '- insert:',
    '    - id: dsh-web-review',
    `      name: ${JSON.stringify(entryName.name)}`,
    '- id: directory-picker',
    '  disabled: true',
    '- insert:',
    "    - id: directory-picker-browse",
    "      name: '@deepseek-ai/dsh-host-directory-picker-browse'",
    "    - id: ui-directory-picker-browse",
    "      name: '@deepseek-ai/dsh-client-ui-directory-picker-browse'",
    '- id: telemetry-otel',
    '  disabled: true',
    // The probe message must fail instantly: dead loopback endpoint and no
    // retries, so capture never spends a real model call.
    '- id: llm-deepseek',
    '  config:',
    '    retryPolicy:',
    '      mode: normal',
    '      maxRetries: 0',
    '',
  ].join('\n'))
  const webPort = await probeFreePort()
  // Load the product credential chain so model onboarding closes itself
  // (readiness reads 'configured'); the dead endpoint below still makes the
  // blank-state probe fail instantly, so capture spends no real model call.
  for (const candidate of [join(REPO_ROOT, '.env'), join(homedir(), '.dsh', '.env')]) {
    try {
      process.loadEnvFile(candidate)
      if (process.env.DEEPSEEK_API_KEY !== undefined) break
    } catch {
      // Candidate absent — try the next.
    }
  }
  const launch = harnessWebLaunch(harness, overlayPath, '127.0.0.1', webPort, {
    ...process.env,
    DSH_HOME: dshHome,
    DEEPSEEK_BASE_URL: 'http://127.0.0.1:9',
  })
  const web = spawn(launch.command, launch.args, { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: launch.env })
  web.stdout?.on('data', (chunk: Buffer) => { console.error(`[web out] ${chunk.toString().trim()}`) })
  web.stderr?.on('data', (chunk: Buffer) => { console.error(`[web err] ${chunk.toString().trim()}`) })
  web.on('exit', (code) => { console.error(`[web exit] ${code}`) })
  const webUrl = `http://127.0.0.1:${webPort}`
  const stop = async (): Promise<void> => {
    web.kill('SIGTERM')
    await new Promise(resolve => { setTimeout(resolve, 300) })
    rmSync(dshHome, { recursive: true, force: true })
  }
  try {
    await waitFor(async () => (await fetch(webUrl)).ok, 90_000, 'web GUI ready')
  } catch (error) {
    await stop()
    throw error
  }
  return { webUrl, stop }
}

async function connectWorkspace(page: Page, root: string, name: string): Promise<void> {
  mkdirSync(join(root, name), { recursive: true })
  await page.getByRole('button', { name: 'Choose workspace' }).click()
  const dialog = page.getByRole('dialog', { name: 'Select Workspace Directory' })
  const addWorkspace = page.getByRole('menuitem', { name: /Add workspace/ })
  await Promise.race([
    dialog.waitFor({ timeout: 15_000 }),
    addWorkspace.waitFor({ timeout: 15_000 }),
  ])
  if (!await dialog.isVisible()) await addWorkspace.click()
  await dialog.waitFor({ timeout: 15_000 })
  await dialog.getByRole('button', { name: 'Edit path' }).click()
  const pathInput = dialog.getByRole('textbox', { name: 'Edit path' })
  await pathInput.fill(join(root, name))
  await pathInput.press('Enter')
  await dialog.getByRole('button', { name: 'Open', exact: true }).click()
  await dialog.waitFor({ state: 'detached', timeout: 15_000 })
  const heroSeat = page.locator('[data-composer-seat]')
  await heroSeat.getByText(name, { exact: true }).waitFor({ timeout: 20_000 })
  const composer = heroSeat.locator('textarea:enabled[placeholder="Describe what you want to build"]')
  await composer.waitFor({ timeout: 20_000 })
  await composer.fill('hello')
  await composer.press('Enter')
  await page.getByRole('tab', { name: 'Web Preview' }).waitFor({ state: 'visible', timeout: 30_000 })
}

async function clickWhenStable(page: Page, locator: import('playwright').Locator, timeoutMs = 60_000): Promise<void> {
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

async function driveAdjusts(page: Page, editor: import('playwright').Locator, adjusts: AdjustAction[]): Promise<void> {
  await editor.getByRole('button', { name: 'Adjust' }).click()
  for (const adjust of adjusts) {
    const control = ADJUST_CONTROLS[adjust.property]
    if (control === undefined) throw new Error(`unsupported adjust property "${adjust.property}"`)
    if (control.kind === 'hex') {
      await editor.getByLabel(control.label, { exact: true }).click()
      await page.getByLabel(`${control.label} · Hex`).fill(adjust.after)
      // The picker's selection highlight tints the picked element's
      // background with 10% alpha; a user asking for a solid color raises
      // alpha back to 100%.
      await page.getByRole('spinbutton', { name: `${control.label} · 透明度` }).fill('100')
    } else if (control.kind === 'spinbutton') {
      await editor.getByRole('spinbutton', { name: control.label, exact: true }).fill(adjust.after)
    } else if (control.kind === 'menu') {
      await editor.getByRole('button', { name: control.label, exact: true }).click()
      await page.getByRole('menuitem', { name: adjust.after, exact: true }).click()
    } else {
      await editor.getByLabel(control.label).fill(adjust.after)
    }
  }
}

/** Drive the real GUI once and return the exact intercepted POST body. */
async function captureOnce(task: EvalTask): Promise<{ snapshot: FrozenSnapshot; meta: Omit<CaptureMeta, 'fixtureRevision'> }> {
  const fixture = await startFixtureServer(task)
  const gui = await bootGui()
  const browser: Browser = await chromium.launch()
  const page: Page = await browser.newPage({ viewport: CAPTURE_VIEWPORT, locale: 'en-US' })
  const bodies: string[] = []
  await page.route('**/webview-annotations', async (route) => {
    const body = route.request().postData()
    if (body !== null && body !== undefined) bodies.push(body)
    await route.continue()
  })
  try {
    await page.addInitScript(() => { localStorage.setItem('dsh.locale', 'en') })
    await page.goto(gui.webUrl)
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'dsh-web-review-capture-ws-'))
    await connectWorkspace(page, workspaceRoot, 'capture')
    await clickWhenStable(page, page.getByRole('tab', { name: 'Web Preview' }))
    const urlInput = page.getByPlaceholder('Enter a URL and press Enter (e.g. https://example.com)')
    await urlInput.waitFor({ timeout: 15_000 })
    await urlInput.fill(fixture.url)
    await urlInput.press('Enter')
    const frame = page.frameLocator('iframe[title="Web preview"]')
    await frame.locator(task.capture.target).first().waitFor({ timeout: 30_000 })

    const pick = page.getByRole('button', { name: 'Add page comments' })
    await expectEnabled(pick)
    await pick.click()
    await frame.locator(task.capture.target).first().click()
    const editor = page.locator('[data-webview-annotation-editor]')
    await editor.waitFor({ timeout: 10_000 })
    await editor.getByPlaceholder('Describe these changes…').fill(task.capture.comment)
    if (task.capture.adjusts !== undefined && task.capture.adjusts.length > 0) {
      await driveAdjusts(page, editor, task.capture.adjusts)
    }
    await editor.getByRole('button', { name: 'Confirm annotation' }).click()
    await editor.waitFor({ state: 'detached', timeout: 10_000 })
    const capsule = page.locator('[data-webview-annotation-capsule]')
    await capsule.waitFor({ timeout: 10_000 })
    await waitFor(
      async () => await capsule.getAttribute('data-sync-status') === 'synced',
      15_000,
      'annotation acknowledged',
    )
    const confirmed = bodies
      .map(body => JSON.parse(body) as FrozenSnapshot)
      .filter(snapshot => snapshot.comments.length > 0)
      .at(-1)
    if (confirmed === undefined) throw new Error('no confirmed annotation POST intercepted')
    return {
      snapshot: confirmed,
      meta: {
        viewport: CAPTURE_VIEWPORT,
        pluginCommit: repoCommit(),
        harnessCommit: harnessCommit(resolveHarnessRoot()),
        capturedAt: new Date().toISOString(),
      },
    }
  } finally {
    await browser.close()
    await gui.stop()
    fixture.stop()
  }
}

async function expectEnabled(locator: import('playwright').Locator): Promise<void> {
  await waitFor(async () => locator.isEnabled(), 15_000, 'picker enabled')
}

function frozenPath(taskId: string, suffix: string): string {
  return join(REPO_ROOT, 'eval', 'tasks', 'frozen', `${taskId}.${suffix}`)
}

function writeFrozen(task: EvalTask, snapshot: FrozenSnapshot, meta: Omit<CaptureMeta, 'fixtureRevision'>): void {
  const dir = dirname(frozenPath(task.id, 'x'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(frozenPath(task.id, 'snapshot.json'), JSON.stringify(snapshot, null, 2))
  writeFileSync(frozenPath(task.id, 'meta.json'), JSON.stringify({
    ...meta,
    fixtureRevision: hashDir(baselineDir(task.fixture)),
  }, null, 2))
}

function styleValueTolerant(a: string, b: string): boolean {
  const normalize = (value: string): string => {
    const rgb = /^rgba?\(([^)]+)\)$/u.exec(value.trim())
    if (rgb !== null) {
      const parts = rgb[1]!.split(',').slice(0, 3).map(part => Math.round(Number.parseFloat(part)))
      return `rgb(${parts.join(', ')})`
    }
    const length = /^(-?\d+(?:\.\d+)?)(px|rem|em|%)$/u.exec(value.trim())
    if (length !== null) return `${Math.round(Number.parseFloat(length[1]!) * 100) / 100}${length[2]}`
    return value.trim()
  }
  return normalize(a) === normalize(b)
}

function diffCaptures(frozen: FrozenSnapshot, live: FrozenSnapshot): string[] {
  const issues: string[] = []
  const frozenComments = frozen.comments as Record<string, unknown>[]
  const liveComments = live.comments as Record<string, unknown>[]
  if (frozenComments.length !== liveComments.length) {
    issues.push(`comment count ${frozenComments.length} -> ${liveComments.length}`)
    return issues
  }
  frozenComments.forEach((frozenComment, index) => {
    const liveComment = liveComments[index]!
    for (const field of ['tagName', 'role', 'label', 'cssPath', 'fullPath', 'inToolChrome']) {
      if (frozenComment[field] !== liveComment[field]) {
        issues.push(`comment ${index + 1} ${field}: ${JSON.stringify(frozenComment[field])} -> ${JSON.stringify(liveComment[field])}`)
      }
    }
    const frozenClasses = (frozenComment.stableClasses as string[]).join(' ')
    const liveClasses = (liveComment.stableClasses as string[]).join(' ')
    if (frozenClasses !== liveClasses) issues.push(`comment ${index + 1} stableClasses drifted`)
    const frozenChanges = (frozenComment.changes ?? []) as { property: string; before: string; after: string }[]
    const liveChanges = (liveComment.changes ?? []) as { property: string; before: string; after: string }[]
    if (frozenChanges.length !== liveChanges.length) {
      issues.push(`comment ${index + 1} change count drifted`)
    } else {
      frozenChanges.forEach((change, changeIndex) => {
        const live = liveChanges[changeIndex]!
        if (change.property !== live.property || change.after !== live.after) {
          issues.push(`comment ${index + 1} change ${change.property} drifted`)
        } else if (!styleValueTolerant(change.before, live.before)) {
          issues.push(`comment ${index + 1} change ${change.property} before ${change.before} -> ${live.before}`)
        }
      })
    }
  })
  return issues
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const verify = argv.includes('--verify')
  const taskIds = argv.filter(arg => !arg.startsWith('--'))
  const tasks = taskIds.length > 0
    ? await Promise.all(taskIds.map(id => loadTask(id)))
    : await loadTasks()
  for (const task of tasks) {
    console.log(`[capture] ${task.id} (${verify ? 'verify' : 'freeze'})`)
    const live = await captureOnce(task)
    if (verify) {
      if (!existsSync(frozenPath(task.id, 'snapshot.json'))) {
        console.error(`[capture] ${task.id} has no frozen snapshot to verify against; run capture without --verify first`)
        process.exitCode = 1
        continue
      }
      const frozen = JSON.parse(readFileSync(frozenPath(task.id, 'snapshot.json'), 'utf8')) as FrozenSnapshot
      const issues = diffCaptures(frozen, live.snapshot)
      if (issues.length === 0) {
        console.log(`[capture] ${task.id} verify OK`)
      } else {
        console.error(`[capture] ${task.id} DRIFT:`)
        for (const issue of issues) console.error(`  - ${issue}`)
        process.exitCode = 1
      }
    } else {
      writeFrozen(task, live.snapshot, live.meta)
      console.log(`[capture] ${task.id} frozen (${live.snapshot.comments.length} comment(s), ${live.snapshot.selectedSkills.length} skill(s))`)
    }
  }
}

void main()
