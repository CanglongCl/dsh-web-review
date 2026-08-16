/**
 * README media generator (`pnpm media`).
 *
 * Regenerates the three README assets under docs/assets/ by driving the real
 * DSH Web GUI with Playwright — the isolated Preview, the real picker, the real
 * property inspector, and the real annotation toolbar — instead of hand-made
 * captures:
 *
 * - web-review-preview.jpg            the preview tab with the demo page loaded
 *                                     through the isolated Preview Origin
 * - web-review-annotation-editor.jpg  the expanded Adjust inspector with the
 *                                     comment and live style changes applied
 * - web-review-demo.gif               the full annotation loop: 添加页面注释 →
 *                                     pick the hero title → 调整 (expand) →
 *                                     change 文本颜色 (hex stepped through
 *                                     intermediate shades) → scroll the
 *                                     inspector → change 字号 → type the
 *                                     comment → 确认注释 → click the toolbar
 *                                     发送 button
 *
 * The run is disposable. It copies the persistent acceptance profile into a
 * temp DSH_HOME (acknowledged settings, workspace registration, sessions, and
 * the projection cache come along), and its own demo server and DSH web boot
 * on the recorded acceptance ports so the fixture turn's Demo link stays
 * valid. DEEPSEEK_BASE_URL points at an in-process endpoint that answers boot
 * probes with 503 and switches to never-responding right before the GIF's
 * send click — the recorded send shows a real sent message and a pending
 * assistant turn without ever spending a model call. The real acceptance
 * profile is never touched.
 *
 * Usage: pnpm media [--only screenshots|gif]
 */
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright'
import ffmpegPath from 'ffmpeg-static'
import { harnessWebLaunch } from './harness-cli.ts'
import { resolveHarnessRoot } from './harness-path.ts'
import { materializeProfilePluginLink } from './profile-plugin-link.ts'
import { cursorHudControls, installCursorHudDom, noopCursorHud, type CursorHud } from './media-hud.ts'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
mkdirSync(join(root, '.artifacts'), { recursive: true })
const VIEWPORT = { width: 1280, height: 800 }
const ASSETS_DIR = join(root, 'docs', 'assets')
const GIF_FPS = 10
const GIF_MAX_BYTES = 9 * 1024 * 1024
const HERO_HEADING = '.hero h1'
// The demo page sets `.hero h1 { font-size: 28px }`; the scrubber adds one
// px per px of horizontal drag, so a 20px drag walks the title to 48px.
const FONT_SIZE_BASE_PX = 28
const FONT_SIZE_TARGET_PX = 48
const COMMENT_TEXT = '标题改成暖黄色，字号放大到 ' + FONT_SIZE_TARGET_PX + 'px，让首屏更醒目。'
// Shades walked through the color picker, pale to gold.
const TEXT_COLOR_SHADES = ['#FFF1C6', '#FFE9A8', '#FFDF8A', '#FFDB68', '#FFD43B'] as const
const SESSION_TITLE = '网页批注验收'
const DEMO_LINK_TEXT = '打开网页批注 Demo'

/** UI labels used by the drive; resolved by probing the rendered tab. */
interface MediaLabels {
  previewTab: string
  pick: string
  adjust: string
  confirm: string
  send: string
  commentPlaceholder: string
  textColor: string
  fontSize: string
  alphaSuffix: string
  dragSuffix: string
  spectrumSuffix: string
  defaultPrompt: string
}

const ZH_LABELS: MediaLabels = {
  previewTab: '网页预览',
  pick: '添加页面注释',
  adjust: '调整',
  confirm: '确认注释',
  send: '发送',
  commentPlaceholder: '描述这些更改…',
  textColor: '文本颜色',
  fontSize: '字号',
  alphaSuffix: '透明度',
  // Scrub handle and spectrum aria-labels hardcode these suffixes in Chinese
  // in both locales (InspectorControls).
  dragSuffix: '拖动调整',
  spectrumSuffix: '色谱',
  defaultPrompt: '请根据页面批注修改前端实现。',
}

const EN_LABELS: MediaLabels = {
  previewTab: 'Web Preview',
  pick: 'Add page comments',
  adjust: 'Adjust',
  confirm: 'Confirm annotation',
  send: 'Send',
  commentPlaceholder: 'Describe these changes…',
  textColor: 'Text color',
  fontSize: 'Font size',
  // InspectorControls hardcodes these suffixes in Chinese in both locales.
  alphaSuffix: '透明度',
  dragSuffix: '拖动调整',
  spectrumSuffix: '色谱',
  defaultPrompt: 'Please apply the page comments to the frontend implementation.',
}

async function portAvailable(port: number): Promise<boolean> {
  return await new Promise(resolve => {
    const server = createNetServer()
    server.once('error', () => { resolve(false) })
    server.listen(port, '127.0.0.1', () => { server.close(() => { resolve(true) }) })
  })
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
  throw new Error('waitFor(' + label + ') timed out' + (lastError === undefined ? '' : ': ' + String(lastError)))
}

/**
 * Provider-shaped endpoint for the disposable run: 503 while probing so
 * boot-time readiness checks fail instantly, then hold() makes every later
 * request hang — the GIF's send click shows a pending assistant turn without
 * ever spending a real model call.
 */
function startMediaEndpoint(): Promise<{ port: number; hold: () => void; close: () => void }> {
  return new Promise(resolve => {
    let holding = false
    let heldLogged = false
    const sockets = new Set<import('node:net').Socket>()
    const server = createServer((request, response) => {
      void request
      if (!holding) {
        response.writeHead(503, { 'content-type': 'text/plain' })
        response.end('readme-media: no model calls')
        return
      }
      if (!heldLogged) {
        heldLogged = true
        console.log('media: provider call held by the media endpoint (no model call spent)')
      }
      // Never respond: the recorded assistant turn stays pending.
    })
    server.on('connection', socket => {
      sockets.add(socket)
      socket.on('close', () => { sockets.delete(socket) })
    })
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        throw new Error('readme-media: endpoint probe returned no port')
      }
      resolve({
        port: address.port,
        hold: () => { holding = true },
        close: () => {
          for (const socket of sockets) socket.destroy()
          server.close()
        },
      })
    })
  })
}

/**
 * Copy the persistent acceptance profile into a disposable DSH_HOME. The
 * session store and its projection cache come along unchanged — the GUI's
 * sidebar list is cache-backed, so a re-seeded jsonl alone would not show up.
 * The seeded 网页批注验收 turn keeps its recorded acceptance demo URL, which
 * is why this run reuses the acceptance ports instead of free ones.
 */
function prepareDisposableHome(): string {
  const acceptanceHome = join(root, '.artifacts', 'acceptance', 'dsh-home')
  if (!existsSync(join(acceptanceHome, 'settings.yaml'))
    || !existsSync(join(acceptanceHome, 'storages', 'workspace.json'))
    || !existsSync(join(acceptanceHome, 'storages', 'session_projcache.json'))
    || !existsSync(join(acceptanceHome, 'sessions'))) {
    throw new Error(
      'readme-media: the acceptance profile is missing; run "pnpm dev:acceptance" once to bootstrap it',
    )
  }
  const dshHome = mkdtempSync(join(tmpdir(), 'dsh-web-review-media-'))
  cpSync(acceptanceHome, dshHome, { recursive: true })
  materializeProfilePluginLink(root, dshHome)
  return dshHome
}

/** Resolve the rendered locale by probing the conversation tab label. */
async function resolveLabels(page: Page): Promise<MediaLabels> {
  const zh = page.getByRole('tab', { name: ZH_LABELS.previewTab })
  const en = page.getByRole('tab', { name: EN_LABELS.previewTab })
  await waitFor(async () => (await zh.count()) > 0 || (await en.count()) > 0, 30_000, 'conversation tabs')
  return (await zh.count()) > 0 ? ZH_LABELS : EN_LABELS
}

/** Wheel-scroll in small steps so the recorded GIF shows a natural scroll. */
async function smoothWheel(page: Page, delta: number): Promise<void> {
  const steps = 6
  for (let i = 0; i < steps; i += 1) {
    await page.mouse.wheel(0, delta / steps)
    await page.waitForTimeout(70)
  }
}

/** Scroll the inspector until a control sits inside the editor's visible box. */
async function ensureRowVisible(
  page: Page,
  editor: Locator,
  row: Locator,
  move: (x: number, y: number) => Promise<void>,
): Promise<void> {
  const editorBox = await editor.boundingBox()
  if (editorBox === null) throw new Error('readme-media: editor geometry missing')
  await move(editorBox.x + editorBox.width / 2, editorBox.y + editorBox.height / 2)
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const rowBox = await row.boundingBox()
    if (rowBox === null) throw new Error('readme-media: inspector row geometry missing')
    const padding = 44
    if (rowBox.y < editorBox.y + padding) {
      await smoothWheel(page, -140)
      continue
    }
    if (rowBox.y + rowBox.height > editorBox.y + editorBox.height - padding) {
      await smoothWheel(page, 140)
      continue
    }
    return
  }
  throw new Error('readme-media: could not bring the inspector row into view')
}

/** Drive the GUI: open the seeded session, open Preview, capture, annotate. */
async function driveMedia(
  page: Page,
  options: { screenshots: boolean; gif: boolean; endpoint: { hold: () => void }; hud: CursorHud },
): Promise<{ gifStartMs: number; gifEndMs: number } | null> {
  await page.goto(webUrl())
  // Navigation wipes injected DOM, so (re)install the HUD on the loaded
  // document; the controls passed in keep working across the reload.
  if (options.gif) await installCursorHudDom(page)
  // A fresh browser profile shows the internal-beta notice; acknowledge it.
  for (const name of ['继续', 'Continue']) {
    const acknowledge = page.getByRole('button', { name }).first()
    try {
      await acknowledge.waitFor({ state: 'visible', timeout: 10_000 })
      await acknowledge.click()
      await page.waitForTimeout(1200)
      break
    } catch {
      // Notice absent — the profile state already carries the acknowledgement.
    }
  }
  try {
    await waitFor(() => page.getByText(SESSION_TITLE, { exact: true }).first().isVisible(), 90_000, 'session list')
  } catch (error) {
    const debugText = await page.evaluate(() => document.body.innerText).catch(() => 'text unavailable')
    writeFileSync(join(root, '.artifacts', 'media-debug.txt'), debugText)
    await page.screenshot({ path: join(root, '.artifacts', 'media-debug.png') }).catch(() => {})
    throw error
  }
  await page.getByText(SESSION_TITLE, { exact: true }).first().click()
  const demoLink = page.getByRole('link', { name: DEMO_LINK_TEXT })
  await demoLink.waitFor({ timeout: 30_000 })
  const labels = await resolveLabels(page)
  await demoLink.click()

  // Mouse orchestration: every move updates the HUD cursor (interpolated in
  // small steps so the GIF shows a natural glide), every click presses the
  // cursor and spawns the click ripple. Locator-only clicks before this point
  // happen off the GIF trim and leave the overlay cursor parked off-screen.
  const hud = options.hud
  let cursorAt: { x: number; y: number } | null = null
  const moveTo = async (x: number, y: number): Promise<void> => {
    const from = cursorAt
    if (from === null) {
      await page.mouse.move(x, y)
      await hud.move(x, y)
    } else {
      const steps = 10
      for (let i = 1; i <= steps; i += 1) {
        const px = from.x + ((x - from.x) * i) / steps
        const py = from.y + ((y - from.y) * i) / steps
        await page.mouse.move(px, py)
        await hud.move(px, py)
        await page.waitForTimeout(8)
      }
    }
    cursorAt = { x, y }
  }
  const clickAt = async (x: number, y: number): Promise<void> => {
    await moveTo(x, y)
    await hud.down(x, y)
    await page.mouse.down()
    await page.waitForTimeout(150)
    await page.mouse.up()
    await hud.up()
    await page.waitForTimeout(140)
  }

  const panel = page.locator('[data-webview-panel]')
  await panel.waitFor({ state: 'visible', timeout: 20_000 })
  const frame = page.frameLocator('[data-webview-panel] iframe')
  await frame.locator(HERO_HEADING).waitFor({ timeout: 30_000 })
  const pickButton = page.getByRole('button', { name: labels.pick })
  await waitFor(() => pickButton.isEnabled(), 20_000, 'picker enabled')
  await page.waitForTimeout(600)

  if (options.screenshots) {
    await hud.setVisible(false)
    const previewPath = join(ASSETS_DIR, 'web-review-preview.jpg')
    await page.screenshot({ path: previewPath, type: 'jpeg', quality: 90 })
    await hud.setVisible(true)
    console.log('media: screenshot ' + previewPath + ' (' + statSync(previewPath).size + ' bytes)')
  }

  const markers = { gifStartMs: 0, gifEndMs: 0 }
  const hero = frame.locator(HERO_HEADING)
  const heroBox = await hero.boundingBox()
  if (heroBox === null) throw new Error('readme-media: hero title has no layout box')
  const pickBox = await pickButton.boundingBox()
  if (pickBox === null) throw new Error('readme-media: pick button has no layout box')
  const pickX = pickBox.x + pickBox.width / 2
  const pickY = pickBox.y + pickBox.height / 2
  await moveTo(pickX, pickY)
  await page.waitForTimeout(500)
  markers.gifStartMs = Date.now() - 150
  await clickAt(pickX, pickY)
  await page.locator('[data-webview-annotation-toolbar]').waitFor({ timeout: 10_000 })
  await page.waitForTimeout(900)

  const heroX = heroBox.x + heroBox.width / 2
  const heroY = heroBox.y + heroBox.height / 2
  await moveTo(heroX, heroY)
  await page.waitForTimeout(800)
  await clickAt(heroX, heroY)
  // Cursor + ripple sample over the hero, used to verify the HUD rendering.
  if (options.gif) {
    await page.screenshot({ path: join(root, '.artifacts', 'media-cursor-sample.png') })
  }
  const editor = page.locator('[data-webview-annotation-editor]')
  await editor.waitFor({ timeout: 10_000 })
  await page.waitForTimeout(900)

  const adjustButton = editor.getByRole('button', { name: labels.adjust })
  const adjustBox = await adjustButton.boundingBox()
  if (adjustBox === null) throw new Error('readme-media: adjust button has no layout box')
  const adjustX = adjustBox.x + adjustBox.width / 2
  const adjustY = adjustBox.y + adjustBox.height / 2
  await moveTo(adjustX, adjustY)
  await page.waitForTimeout(400)
  await clickAt(adjustX, adjustY)
  await editor.locator('[data-webview-property-inspector]').waitFor({ timeout: 10_000 })
  await page.waitForTimeout(800)

  // Change the text color through the picker: click the spectrum control
  // (the picker gesture), then walk its value through the shade ramp — the
  // native OS dialog itself cannot be scripted, but the control's swatch and
  // the hero title visibly progress from white to gold instead of jumping.
  const colorControl = editor.getByLabel(labels.textColor, { exact: true })
  const colorBox = await colorControl.boundingBox()
  if (colorBox === null) throw new Error('readme-media: text color control has no layout box')
  await clickAt(colorBox.x + colorBox.width / 2, colorBox.y + colorBox.height / 2)
  await page.waitForTimeout(700)
  const spectrum = page.getByLabel(labels.textColor + ' · ' + labels.spectrumSuffix)
  const spectrumBox = await spectrum.boundingBox()
  if (spectrumBox === null) throw new Error('readme-media: spectrum control has no layout box')
  await clickAt(spectrumBox.x + spectrumBox.width / 2, spectrumBox.y + spectrumBox.height / 2)
  await page.waitForTimeout(600)
  for (const shade of TEXT_COLOR_SHADES) {
    await spectrum.evaluate((el, value) => {
      const input = el as HTMLInputElement
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      if (setter !== undefined) setter.call(input, value)
      else input.value = value
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }, shade)
    await page.waitForTimeout(550)
  }
  await page.waitForTimeout(900)
  // Click the comment input to close the popover without touching a control.
  const closePopoverInput = editor.locator('input.dsh-wv-comment-input')
  const closePopoverBox = await closePopoverInput.boundingBox()
  if (closePopoverBox === null) throw new Error('readme-media: comment input has no layout box')
  await clickAt(closePopoverBox.x + closePopoverBox.width / 2, closePopoverBox.y + closePopoverBox.height / 2)
  await page.waitForTimeout(900)

  // Scroll the inspector down (the GIF's 下滑 beat), then enlarge the font
  // size by dragging the scrub handle: the field value and the hero title
  // grow step by step, so the process reads instead of a typed jump.
  const sizeHandle = editor.getByRole('button', { name: labels.fontSize + ' · ' + labels.dragSuffix, exact: true })
  await ensureRowVisible(page, editor, sizeHandle, moveTo)
  await page.waitForTimeout(700)
  const handleBox = await sizeHandle.boundingBox()
  if (handleBox === null) throw new Error('readme-media: font-size scrub handle has no layout box')
  const handleX = handleBox.x + handleBox.width / 2
  const handleY = handleBox.y + handleBox.height / 2
  await moveTo(handleX, handleY)
  await page.waitForTimeout(500)
  await hud.down(handleX, handleY)
  await page.mouse.down()
  await page.waitForTimeout(160)
  // The scrubber adds step (1) px per px of horizontal drag: the 28px base
  // needs a 20px drag to reach 48px, walked in small increments.
  const dragDistance = FONT_SIZE_TARGET_PX - FONT_SIZE_BASE_PX
  const dragSteps = 12
  for (let i = 1; i <= dragSteps; i += 1) {
    const x = handleX + (dragDistance * i) / dragSteps
    await page.mouse.move(x, handleY)
    await hud.move(x, handleY)
    await page.waitForTimeout(70)
  }
  await page.mouse.up()
  await hud.up()
  await page.waitForTimeout(1500)

  // Type the comment.
  const commentInput = editor.locator('input.dsh-wv-comment-input')
  const commentBox = await commentInput.boundingBox()
  if (commentBox === null) throw new Error('readme-media: comment input has no layout box')
  await clickAt(commentBox.x + commentBox.width / 2, commentBox.y + commentBox.height / 2)
  await page.keyboard.type(COMMENT_TEXT, { delay: 30 })
  await page.waitForTimeout(1000)

  if (options.screenshots) {
    await hud.setVisible(false)
    const editorPath = join(ASSETS_DIR, 'web-review-annotation-editor.jpg')
    await page.screenshot({ path: editorPath, type: 'jpeg', quality: 90 })
    await hud.setVisible(true)
    console.log('media: screenshot ' + editorPath + ' (' + statSync(editorPath).size + ' bytes)')
  }
  if (!options.gif) return null

  // Confirm the annotation and wait for the acknowledged capsule.
  const confirmButton = editor.getByRole('button', { name: labels.confirm })
  const confirmBox = await confirmButton.boundingBox()
  if (confirmBox === null) throw new Error('readme-media: confirm button has no layout box')
  const confirmX = confirmBox.x + confirmBox.width / 2
  const confirmY = confirmBox.y + confirmBox.height / 2
  if (process.env.MEDIA_DEBUG !== undefined) {
    const commentInputValue = await editor.locator('input.dsh-wv-comment-input').inputValue()
    const confirmDisabled = await confirmButton.isDisabled()
    const computed = await frame.locator(HERO_HEADING).evaluate(el => ({
      color: getComputedStyle(el).color,
      fontSize: getComputedStyle(el).fontSize,
    }))
    const sizeValue = await editor.getByRole('spinbutton', { name: labels.fontSize, exact: true }).inputValue()
    const focusInfo = await page.evaluate(() => {
      const el = document.activeElement
      if (el === null) return null
      return {
        tag: el.tagName,
        aria: el.getAttribute('aria-label'),
        value: (el as HTMLInputElement).value ?? '',
        cls: (el as HTMLElement).className ?? '',
      }
    })
    console.log('media-debug: comment=' + JSON.stringify(commentInputValue)
      + ' confirmDisabled=' + String(confirmDisabled)
      + ' heroComputed=' + JSON.stringify(computed)
      + ' fontSizeField=' + JSON.stringify(sizeValue)
      + ' focus=' + JSON.stringify(focusInfo))
  }
  await moveTo(confirmX, confirmY)
  await page.waitForTimeout(400)
  await clickAt(confirmX, confirmY)
  if (process.env.MEDIA_DEBUG !== undefined) {
    console.log('media-debug: after confirm click, editor still visible=' + String(await editor.isVisible().catch(() => false)))
  }
  await editor.waitFor({ state: 'detached', timeout: 10_000 })
  const capsule = page.locator('[data-webview-annotation-capsule]')
  await capsule.waitFor({ timeout: 10_000 })
  await waitFor(
    async () => await capsule.getAttribute('data-sync-status') === 'synced',
    15_000,
    'annotation acknowledgement',
  )
  await page.waitForTimeout(1000)

  // Send: hold the provider endpoint first, then click the toolbar button.
  options.endpoint.hold()
  const sendButton = page.getByRole('button', { name: labels.send + ' 1' })
  const sendBox = await sendButton.boundingBox()
  if (sendBox === null) throw new Error('readme-media: send button has no layout box')
  const sendX = sendBox.x + sendBox.width / 2
  const sendY = sendBox.y + sendBox.height / 2
  await moveTo(sendX, sendY)
  await page.waitForTimeout(500)
  await clickAt(sendX, sendY)
  await page.getByText(labels.defaultPrompt).first().waitFor({ timeout: 15_000 })
  await page.waitForTimeout(2200)
  markers.gifEndMs = Date.now()
  return markers
}

let webUrlValue = ''
function webUrl(): string {
  if (webUrlValue === '') throw new Error('readme-media: web URL not set yet')
  return webUrlValue
}

async function encodeGif(videoPath: string, trimStartSec: number, durationSec: number): Promise<void> {
  const ffmpeg = ffmpegPath
  if (ffmpeg === null) throw new Error('readme-media: ffmpeg-static binary unavailable')
  const outPath = join(ASSETS_DIR, 'web-review-demo.gif')
  const encode = (width: number, maxColors: number): void => {
    const filter = [
      'fps=' + GIF_FPS,
      'scale=' + width + ':-1:flags=lanczos',
      'split[s0][s1]',
      '[s0]palettegen=max_colors=' + maxColors + ':stats_mode=diff[p]',
      '[s1][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle',
    ].join(',')
    execFileSync(ffmpeg, [
      '-y',
      '-ss', trimStartSec.toFixed(2),
      '-i', videoPath,
      '-t', durationSec.toFixed(2),
      '-vf', filter,
      '-loop', '0',
      outPath,
    ], { stdio: 'inherit' })
  }
  encode(1280, 128)
  if (statSync(outPath).size > GIF_MAX_BYTES) encode(1024, 96)
  console.log('media: gif ' + outPath + ' (' + statSync(outPath).size + ' bytes, ' + durationSec.toFixed(1) + 's @ ' + GIF_FPS + 'fps)')
}

const onlyFlag = process.argv.indexOf('--only')
const only = onlyFlag === -1 ? 'all' : (process.argv[onlyFlag + 1] ?? 'all')
if (!['all', 'screenshots', 'gif'].includes(only)) {
  throw new Error('readme-media: --only must be one of: screenshots, gif')
}
const wantScreenshots = only === 'all' || only === 'screenshots'
const wantGif = only === 'all' || only === 'gif'

const harness = resolveHarnessRoot()
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

const dshHome = prepareDisposableHome()
const portsPath = join(root, '.artifacts', 'acceptance', 'ports.json')
if (!existsSync(portsPath)) {
  throw new Error('readme-media: acceptance ports.json is missing; run "pnpm dev:acceptance" once to bootstrap it')
}
const ports = JSON.parse(readFileSync(portsPath, 'utf8')) as { web: number; demo: number }
if (!await portAvailable(ports.demo) || !await portAvailable(ports.web)) {
  throw new Error('readme-media: acceptance ports are in use; stop the running acceptance instance first')
}
const demoPort = ports.demo
const webPort = ports.web
const endpoint = await startMediaEndpoint()
const overlayPath = join(dshHome, 'media.cordis.yml')
writeFileSync(overlayPath, [
  '- insert:',
  '    - id: dsh-web-review',
  '      name: ' + JSON.stringify(
    (JSON.parse(readFileSync(join(root, 'packages', 'dsh-web-review', 'entry-name.json'), 'utf8')) as { name: string }).name,
  ),
  '- id: directory-picker',
  '  disabled: true',
  '- insert:',
  '    - id: directory-picker-browse',
  '      name: \'@deepseek-ai/dsh-host-directory-picker-browse\'',
  '    - id: ui-directory-picker-browse',
  '      name: \'@deepseek-ai/dsh-client-ui-directory-picker-browse\'',
  '- id: telemetry-otel',
  '  disabled: true',
  '- id: llm-deepseek',
  '  config:',
  '    retryPolicy:',
  '      mode: normal',
  '      maxRetries: 0',
  '',
].join('\n'))

// Load the product credential chain (readiness reads "configured"); the value
// is never printed. The hang endpoint guarantees no model call is spent.
for (const candidate of [join(root, '.env'), join(homedir(), '.dsh', '.env')]) {
  try {
    process.loadEnvFile(candidate)
    if (process.env.DEEPSEEK_API_KEY !== undefined) break
  } catch {
    // Candidate absent — try the next product-supported source.
  }
}
if (process.env.DEEPSEEK_API_KEY === undefined) {
  console.warn('media: no configured provider credential found; the send step may be gated (screenshots are unaffected)')
}

const children: ChildProcess[] = []
const launch = harnessWebLaunch(harness, overlayPath, '127.0.0.1', webPort, {
  ...process.env,
  DSH_HOME: dshHome,
  DEEPSEEK_BASE_URL: 'http://127.0.0.1:' + endpoint.port,
})
const web = spawn(launch.command, launch.args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: launch.env })
children.push(web)
web.stdout?.on('data', (chunk: Buffer) => { console.error('[web out] ' + chunk.toString().trim()) })
web.stderr?.on('data', (chunk: Buffer) => { console.error('[web err] ' + chunk.toString().trim()) })
web.on('exit', code => { console.error('[web exit] ' + String(code)) })
children.push(spawn(process.execPath, ['--import', 'tsx', join(root, 'demo/server.ts'), String(demoPort)], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: process.env,
}))
webUrlValue = 'http://127.0.0.1:' + webPort

let browser: Browser | undefined
let context: BrowserContext | undefined
let videoDir: string | undefined
try {
  await waitFor(async () => {
    try {
      return (await fetch(webUrlValue)).ok
    } catch {
      return false
    }
  }, 90_000, 'web GUI ready')

  const videoBase = mkdtempSync(join(tmpdir(), 'dsh-web-review-media-video-'))
  browser = await chromium.launch()
  context = await browser.newContext({
    viewport: VIEWPORT,
    // Retina rendering: screenshots come out at 2560x1600 physical pixels
    // (the README displays them at half width, so they stay crisp), and the
    // 1280x800 video is supersampled from the 2x render for a sharper GIF.
    deviceScaleFactor: 2,
    ...(wantGif ? { recordVideo: { dir: videoBase, size: VIEWPORT } } : {}),
  })
  // The Chinese README media shows the Chinese product UI, so pin the locale
  // the same way the eval capture pins English (browser-scope storage boot
  // default; the durable setting stays untouched in the copied profile).
  await context.addInitScript(() => { localStorage.setItem('dsh.locale', 'zh') })
  videoDir = videoBase
  const page = await context.newPage()
  const hud = wantGif ? cursorHudControls(page) : noopCursorHud()
  const videoStartMs = Date.now()
  const markers = await driveMedia(page, { screenshots: wantScreenshots, gif: wantGif, endpoint, hud })

  let videoPath: string | null = null
  if (wantGif && page.video() !== null) videoPath = await page.video()?.path() ?? null
  await context.close()
  context = undefined

  if (wantGif && markers !== null && videoPath !== null) {
    const trimStartSec = Math.max(0, (markers.gifStartMs - videoStartMs) / 1000 - 0.25)
    const durationSec = Math.max(1, (markers.gifEndMs - markers.gifStartMs) / 1000 + 0.4)
    await encodeGif(videoPath, trimStartSec, durationSec)
  }
} finally {
  if (context !== undefined) await context.close().catch(() => {})
  if (browser !== undefined) await browser.close().catch(() => {})
  for (const child of children) if (!child.killed) child.kill('SIGTERM')
  endpoint.close()
  if (videoDir !== undefined) rmSync(videoDir, { recursive: true, force: true })
  rmSync(dshHome, { recursive: true, force: true })
}
