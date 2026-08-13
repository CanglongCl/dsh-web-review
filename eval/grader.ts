/**
 * Grader: executes a task's assertions against a served fixture variant.
 * dom assertions run in headless Chromium directly against the dev server
 * (never through the plugin proxy); code assertions inspect workspace files.
 */
import { spawn, execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Locator, type Page } from 'playwright'
import type { CodeAssertion, DomAssertion, GraderOutcome, LoadedEvalTask } from './types.ts'
import { FIXTURES_ROOT, REPO_ROOT } from './runner/runner.ts'

const SERVE_SCRIPT = fileURLToPath(new URL('./fixtures/serve.ts', import.meta.url))
const DEFAULT_VIEWPORT = { width: 1680, height: 1000 }
const COLOR_TOLERANCE = 2

function probeFreePort(): Promise<number> {
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

async function waitForUrl(url: string, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch (error) {
      lastError = error
    }
    await new Promise(resolve => { setTimeout(resolve, 400) })
  }
  throw new Error(`waited for ${label} at ${url}: ${String(lastError)}`)
}

export interface ServedFixture {
  url: string
  stop: () => Promise<void>
}

/** Serve a fixture directory (static file server or Vite dev server). */
export async function serveFixtureDir(task: LoadedEvalTask, dir: string): Promise<ServedFixture> {
  const port = await probeFreePort()
  if (task.fixtureKind === 'static') {
    const child = spawn(process.execPath, ['--import', 'tsx', SERVE_SCRIPT, dir, String(port)], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout?.on('data', () => {})
    child.stderr?.on('data', () => {})
    const url = `http://127.0.0.1:${port}/`
    await waitForUrl(url, 15_000, `${task.id} static server`)
    return { url, stop: async () => { child.kill('SIGTERM') } }
  }
  const viteBin = join(FIXTURES_ROOT, 'node_modules', 'vite', 'bin', 'vite.js')
  const child = spawn(process.execPath, [viteBin, '--port', String(port), '--strictPort'], {
    cwd: dir,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.on('data', () => {})
  child.stderr?.on('data', () => {})
  const url = `http://127.0.0.1:${port}/`
  await waitForUrl(url, 30_000, `${task.id} vite server`)
  return { url, stop: async () => { child.kill('SIGTERM') } }
}

/** Apply a git patch variant into a temp copy; html-dir variants return their dir. */
export function prepareVariant(task: LoadedEvalTask, variant: 'baseline' | 'golden'): string {
  const base = join(FIXTURES_ROOT, task.fixture)
  // Static apps serve the committed dirs read-only; Vite apps always run from
  // a temp copy so the dep optimizer (node_modules/.vite) can never pollute
  // the committed baselines.
  if (task.fixtureKind === 'static') {
    if (variant === 'baseline') return join(base, 'baseline')
    if (task.golden.kind === 'html-dir') return join(base, task.golden.dir)
  }
  const temp = mkdtempSync(join(tmpdir(), `eval-${variant}-${task.id}-`))
  cpSync(join(base, 'baseline'), temp, {
    recursive: true,
    filter: (path) => !path.endsWith('.patch'),
  })
  if (task.fixtureKind !== 'static' && !existsSync(join(temp, 'node_modules'))) {
    const modules = join(FIXTURES_ROOT, 'node_modules')
    if (existsSync(modules)) {
      symlinkSync(modules, join(temp, 'node_modules'), 'dir')
    }
  }
  if (variant === 'golden') {
    if (task.golden.kind !== 'git-patch') throw new Error(`task ${task.id}: unsupported golden kind for copied variant`)
    const patch = readFileSync(join(base, task.golden.patchFile), 'utf8')
    execFileSync('git', ['apply', '-p1'], { cwd: temp, input: patch, encoding: 'utf8' })
  }
  return temp
}

/** Canonical rgb(r, g, b) int triple for hex/rgb inputs, or undefined. */
function rgbOf(value: string): [number, number, number] | undefined {
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/iu.exec(value.trim())
  if (hex !== null) {
    const raw = hex[1]!
    const expanded = raw.length === 3 ? raw.split('').map(c => c + c).join('') : raw
    const int = (part: string): number => Number.parseInt(part, 16)
    return [int(expanded.slice(0, 2)), int(expanded.slice(2, 4)), int(expanded.slice(4, 6))]
  }
  const rgb = /^rgba?\(([^)]+)\)$/iu.exec(value.trim())
  if (rgb === null) return undefined
  const parts = rgb[1]!.split(',').slice(0, 3).map(part => Number.parseFloat(part))
  if (parts.some(Number.isNaN)) return undefined
  return [Math.round(parts[0]!), Math.round(parts[1]!), Math.round(parts[2]!)]
}

/** Numeric value + unit from a CSS length string, or the raw string. */
function lengthOf(value: string): { value: number; unit: string } | { raw: string } {
  const match = /^(-?\d+(?:\.\d+)?)(px|rem|em|%|vh|vw|fr)?$/u.exec(value.trim())
  if (match === null) return { raw: value.trim() }
  return { value: Number.parseFloat(match[1]!), unit: match[2] ?? '' }
}

function styleMatches(expected: string, measured: string, tolerance: number): boolean {
  const expectedRgb = rgbOf(expected)
  const measuredRgb = rgbOf(measured)
  if (expectedRgb !== undefined || measuredRgb !== undefined) {
    if (expectedRgb === undefined || measuredRgb === undefined) return false
    return expectedRgb.every((part, index) => Math.abs(part - measuredRgb[index]!) <= COLOR_TOLERANCE)
  }
  const expectedLength = lengthOf(expected)
  const measuredLength = lengthOf(measured)
  if ('raw' in expectedLength || 'raw' in measuredLength) {
    return expected.trim() === measured.trim()
  }
  if (expectedLength.unit !== measuredLength.unit) return false
  return Math.abs(expectedLength.value - measuredLength.value) <= tolerance
}

async function accessibleNameOf(locator: Locator): Promise<string> {
  return locator.evaluate((element) => {
    const el = element as HTMLElement
    const aria = el.getAttribute('aria-label')
    if (aria !== null && aria.trim() !== '') return aria.trim()
    const labelledby = el.getAttribute('aria-labelledby')
    if (labelledby !== null) {
      const text = labelledby.split(/\s+/u)
        .map(id => document.getElementById(id)?.textContent?.trim() ?? '')
        .filter(Boolean).join(' ')
      if (text !== '') return text
    }
    if (el.id !== '') {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
      if (label !== null && label.textContent?.trim() !== '') return label.textContent.trim()
    }
    const placeholder = el.getAttribute('placeholder')
    if (placeholder !== null && placeholder.trim() !== '') return placeholder.trim()
    if (el instanceof HTMLImageElement && el.alt.trim() !== '') return el.alt.trim()
    return ''
  })
}

async function roleOf(locator: Locator): Promise<string> {
  return locator.evaluate((element) => {
    const el = element as HTMLElement
    const explicit = el.getAttribute('role')
    if (explicit !== null) return explicit
    const tag = el.tagName.toLowerCase()
    const byType = el.getAttribute('type') ?? ''
    const implicit = tag === 'a' && el.hasAttribute('href') ? 'link' : undefined
    return implicit ?? (tag === 'input' ? (byType === 'search' ? 'searchbox' : '') : '')
  })
}

async function runDomAssertion(page: Page, assertion: DomAssertion, url: string): Promise<{ ok: boolean; expected: string; measured: string }> {
  const viewport = assertion.viewport ?? DEFAULT_VIEWPORT
  if (assertion.viewport !== undefined) await page.setViewportSize(viewport)
  else await page.setViewportSize(DEFAULT_VIEWPORT)
  await page.goto(url, { waitUntil: 'load' })
  if (assertion.all === true) {
    const matches = page.locator(assertion.selector)
    const count = await matches.count()
    if (count === 0) return { ok: false, expected: `${assertion.selector} matches`, measured: 'no matches' }
    await matches.first().waitFor({ state: 'attached', timeout: 10_000 })
    const failures: string[] = []
    for (let index = 0; index < count; index += 1) {
      const single = await runSingleDom(page, matches.nth(index), assertion)
      if (!single.ok) failures.push(`[${index + 1}/${count}] ${single.measured}`)
    }
    return {
      ok: failures.length === 0,
      expected: `all ${count} matches of ${assertion.selector}`,
      measured: failures.length === 0 ? 'all match' : failures.join('; '),
    }
  }
  const locator = page.locator(assertion.selector).first()
  if (await locator.count() === 0) return { ok: false, expected: `${assertion.selector} matches`, measured: 'no matches' }
  await locator.waitFor({ state: 'attached', timeout: 10_000 })
  return runSingleDom(page, locator, assertion)
}

function regexpOf(pattern: string): RegExp | undefined {
  try {
    return new RegExp(pattern, 'u')
  } catch {
    return undefined
  }
}

async function runSingleDom(page: Page, locator: Locator, assertion: DomAssertion): Promise<{ ok: boolean; expected: string; measured: string }> {
  if (assertion.hover === true) await locator.hover()
  if (assertion.focus === true) await locator.focus()
  const expectedParts: string[] = []
  const measuredParts: string[] = []
  let ok = true
  if (assertion.style !== undefined) {
    const measured = await locator.evaluate((element, props) => {
      const style = getComputedStyle(element)
      return Object.fromEntries(props.map(prop => [prop, style.getPropertyValue(prop)]))
    }, Object.keys(assertion.style))
    for (const [property, expected] of Object.entries(assertion.style)) {
      const actual = String(measured[property] ?? '')
      if (!styleMatches(expected, actual, assertion.tolerance ?? 0.5)) {
        ok = false
      }
      expectedParts.push(`${property}=${expected}`)
      measuredParts.push(`${property}=${actual}`)
    }
  }
  if (assertion.styleGreaterThan !== undefined) {
    const measured = await locator.evaluate((element, props) => {
      const style = getComputedStyle(element)
      return Object.fromEntries(props.map(prop => [prop, style.getPropertyValue(prop)]))
    }, Object.keys(assertion.styleGreaterThan))
    for (const [property, threshold] of Object.entries(assertion.styleGreaterThan)) {
      const actual = String(measured[property] ?? '')
      const thresholdLength = lengthOf(threshold)
      const actualLength = lengthOf(actual)
      const greater = !('raw' in thresholdLength) && !('raw' in actualLength)
        && thresholdLength.unit === actualLength.unit
        && actualLength.value > thresholdLength.value + (assertion.tolerance ?? 0.5)
      if (!greater) ok = false
      expectedParts.push(`${property}>${threshold}`)
      measuredParts.push(`${property}=${actual}`)
    }
  }
  if (assertion.text !== undefined) {
    const text = (await locator.textContent())?.trim() ?? ''
    if (text !== assertion.text) ok = false
    expectedParts.push(`text=${assertion.text}`)
    measuredParts.push(`text=${text}`)
  }
  if (assertion.attr !== undefined) {
    const value = await locator.getAttribute(assertion.attr.name)
    if (value !== assertion.attr.value) ok = false
    expectedParts.push(`${assertion.attr.name}=${assertion.attr.value}`)
    measuredParts.push(`${assertion.attr.name}=${value ?? ''}`)
  }
  if (assertion.attrPattern !== undefined) {
    const value = await locator.getAttribute(assertion.attrPattern.name) ?? ''
    const pattern = regexpOf(assertion.attrPattern.pattern)
    if (pattern === undefined || !pattern.test(value)) ok = false
    expectedParts.push(`${assertion.attrPattern.name} matches /${assertion.attrPattern.pattern}/u`)
    measuredParts.push(`${assertion.attrPattern.name}=${value}`)
  }
  if (assertion.accessibleName !== undefined) {
    const name = await accessibleNameOf(locator)
    if (name !== assertion.accessibleName) ok = false
    expectedParts.push(`name=${assertion.accessibleName}`)
    measuredParts.push(`name=${name}`)
  }
  if (assertion.accessibleNamePattern !== undefined) {
    const name = await accessibleNameOf(locator)
    const pattern = regexpOf(assertion.accessibleNamePattern)
    if (pattern === undefined || !pattern.test(name)) ok = false
    expectedParts.push(`name matches /${assertion.accessibleNamePattern}/u`)
    measuredParts.push(`name=${name}`)
  }
  if (assertion.role !== undefined) {
    const role = await roleOf(locator)
    if (role !== assertion.role) ok = false
    expectedParts.push(`role=${assertion.role}`)
    measuredParts.push(`role=${role}`)
  }
  if (assertion.styleDiffersFrom !== undefined) {
    const other = page.locator(assertion.styleDiffersFrom.selector).first()
    if (await other.count() === 0) {
      ok = false
      expectedParts.push(`style differs from ${assertion.styleDiffersFrom.selector}`)
      measuredParts.push('comparison element missing')
    } else {
      const properties = assertion.styleDiffersFrom.properties
      const [current, comparison] = await Promise.all([
        locator.evaluate((element, props) => Object.fromEntries(props.map(prop => [prop, getComputedStyle(element).getPropertyValue(prop)])), properties),
        other.evaluate((element, props) => Object.fromEntries(props.map(prop => [prop, getComputedStyle(element).getPropertyValue(prop)])), properties),
      ])
      for (const property of properties) {
        const currentValue = String(current[property] ?? '')
        const comparisonValue = String(comparison[property] ?? '')
        if (currentValue === comparisonValue) ok = false
        expectedParts.push(`${property} differs from ${assertion.styleDiffersFrom.selector}`)
        measuredParts.push(`${property}=${currentValue} vs ${comparisonValue}`)
      }
    }
  }
  if (assertion.colorDominance !== undefined) {
    const value = await locator.evaluate((element, property) => getComputedStyle(element).getPropertyValue(property), assertion.colorDominance.property)
    const rgb = rgbOf(value)
    const channelIndex = { red: 0, green: 1, blue: 2 }[assertion.colorDominance.channel]
    const margin = assertion.colorDominance.margin ?? 20
    const dominant = rgb !== undefined && rgb[channelIndex]! >= Math.max(...rgb.filter((_part, index) => index !== channelIndex)) + margin
    if (!dominant) ok = false
    expectedParts.push(`${assertion.colorDominance.property} is ${assertion.colorDominance.channel}-dominant by ${margin}`)
    measuredParts.push(`${assertion.colorDominance.property}=${value}`)
  }
  if (assertion.boxShadow !== undefined) {
    const value = await locator.evaluate(element => getComputedStyle(element).boxShadow)
    const shadows = value === 'none'
      ? []
      : value.split(/,(?![^()]*\))/u)
    const extents = shadows.map(shadow => {
      const lengths = [...shadow.matchAll(/(-?\d+(?:\.\d+)?)px/gu)].map(match => Number.parseFloat(match[1]!))
      return Math.abs(lengths[0] ?? 0) + Math.abs(lengths[1] ?? 0) + Math.max(0, lengths[2] ?? 0) + Math.max(0, lengths[3] ?? 0)
    })
    const extent = Math.max(0, ...extents)
    let colorOk = true
    if (assertion.boxShadow.colorDominance !== undefined) {
      const channelIndex = { red: 0, green: 1, blue: 2 }[assertion.boxShadow.colorDominance]
      const margin = assertion.boxShadow.margin ?? 20
      const colors = [...value.matchAll(/rgba?\(([^)]+)\)/giu)]
        .map(match => rgbOf(`rgb(${match[1]!.split(',').slice(0, 3).join(',')})`))
        .filter((color): color is [number, number, number] => color !== undefined)
      colorOk = colors.some(color => color[channelIndex]! >= Math.max(...color.filter((_part, index) => index !== channelIndex)) + margin)
    }
    if (extent < assertion.boxShadow.minExtentPx || !colorOk) ok = false
    expectedParts.push(`box-shadow extent>=${assertion.boxShadow.minExtentPx}px${assertion.boxShadow.colorDominance === undefined ? '' : ` and ${assertion.boxShadow.colorDominance}-dominant`}`)
    measuredParts.push(`box-shadow=${value}; extent=${extent}px`)
  }
  if (assertion.horizontalCoverage !== undefined) {
    const geometry = await locator.evaluate((element, requirement) => {
      const parent = element.getBoundingClientRect()
      const children = [...element.querySelectorAll(requirement.childSelector)].map(child => child.getBoundingClientRect())
      if (children.length < 2 || parent.width <= 0) return { count: children.length, ratio: 0, topDelta: Number.POSITIVE_INFINITY }
      const left = Math.min(...children.map(child => child.left))
      const right = Math.max(...children.map(child => child.right))
      const tops = children.map(child => child.top)
      return { count: children.length, ratio: (right - left) / parent.width, topDelta: Math.max(...tops) - Math.min(...tops) }
    }, assertion.horizontalCoverage)
    const aligned = geometry.topDelta <= (assertion.horizontalCoverage.maxTopDeltaPx ?? 2)
    if (geometry.ratio < assertion.horizontalCoverage.minRatio || !aligned) ok = false
    expectedParts.push(`${assertion.horizontalCoverage.childSelector} horizontal coverage>=${assertion.horizontalCoverage.minRatio}; top delta<=${assertion.horizontalCoverage.maxTopDeltaPx ?? 2}px`)
    measuredParts.push(`children=${geometry.count}; coverage=${geometry.ratio.toFixed(3)}; top delta=${geometry.topDelta}px`)
  }
  if (assertion.leftAccentColor !== undefined) {
    const evidence = await locator.evaluate((element) => {
      const style = getComputedStyle(element)
      const before = getComputedStyle(element, '::before')
      return {
        borderColor: style.borderLeftColor,
        borderWidth: style.borderLeftWidth,
        boxShadow: style.boxShadow,
        beforeColor: before.backgroundColor,
        beforeWidth: before.width,
        beforeContent: before.content,
      }
    })
    const expectedRgb = rgbOf(assertion.leftAccentColor)
    const sameColor = (value: string): boolean => {
      const actual = rgbOf(value)
      return expectedRgb !== undefined && actual !== undefined
        && expectedRgb.every((part, index) => Math.abs(part - actual[index]!) <= COLOR_TOLERANCE)
    }
    const border = sameColor(evidence.borderColor) && Number.parseFloat(evidence.borderWidth) >= 2
    const shadow = expectedRgb !== undefined
      && evidence.boxShadow.includes(expectedRgb.join(', '))
      && /inset/iu.test(evidence.boxShadow)
    const pseudo = evidence.beforeContent !== 'none'
      && sameColor(evidence.beforeColor)
      && Number.parseFloat(evidence.beforeWidth) >= 2
    if (!border && !shadow && !pseudo) ok = false
    expectedParts.push(`left accent color=${assertion.leftAccentColor}`)
    measuredParts.push(`border=${evidence.borderWidth} ${evidence.borderColor}; shadow=${evidence.boxShadow}; ::before=${evidence.beforeWidth} ${evidence.beforeColor}`)
  }
  if (expectedParts.length === 0) return { ok: true, expected: '(presence)', measured: '(present)' }
  return { ok, expected: expectedParts.join('; '), measured: measuredParts.join('; ') }
}

function runCodeAssertion(workspaceDir: string, assertion: CodeAssertion): { ok: boolean; expected: string; measured: string } {
  const path = join(workspaceDir, assertion.file)
  if (!existsSync(path)) return { ok: false, expected: `${assertion.file} contains ${assertion.contains.join(' | ')}`, measured: 'file missing' }
  const content = readFileSync(path, 'utf8')
  const missing = assertion.contains.filter(needle => !content.includes(needle))
  return {
    ok: missing.length === 0,
    expected: `${assertion.file} contains ${assertion.contains.join(' | ')}`,
    measured: missing.length === 0 ? 'all present' : `missing: ${missing.join(' | ')}`,
  }
}

function checkNegative(workspaceDir: string, negatives: string[]): { ok: boolean; expected: string; measured: string } | undefined {
  const found: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      if (entry === 'node_modules' || entry === '.git') continue
      const stat = statSync(path)
      if (stat.isDirectory()) {
        walk(path)
        continue
      }
      if (/\.(png|jpg|jpeg|gif|svg|ico|woff2?)$/iu.test(entry)) continue
      const content = readFileSync(path, 'utf8')
      for (const negative of negatives) {
        if (content.includes(negative)) found.push(`${relative(workspaceDir, path)}: ${negative}`)
      }
    }
  }
  walk(workspaceDir)
  return found.length === 0 ? undefined : { ok: false, expected: `none of: ${negatives.join(' | ')}`, measured: found.join('; ') }
}

/**
 * Grade a served variant. `workspaceDir` carries the code under test for
 * code assertions; `evidenceDir` receives the failure screenshot.
 */
export async function grade(
  task: LoadedEvalTask,
  servedUrl: string,
  workspaceDir: string,
  evidenceDir: string,
): Promise<GraderOutcome> {
  const browser: Browser = await chromium.launch()
  const page: Page = await browser.newPage({ viewport: DEFAULT_VIEWPORT, locale: 'en-US' })
  const results: GraderOutcome['results'] = []
  let pass = true
  try {
    for (const assertion of task.grader.pass) {
      const outcome = assertion.kind === 'dom'
        ? await runDomAssertion(page, assertion, servedUrl)
         : runCodeAssertion(workspaceDir, assertion)
      results.push({ assertion, ok: outcome.ok, expected: outcome.expected, measured: outcome.measured })
      if (!outcome.ok) pass = false
    }
    if (task.grader.noRegression !== undefined) {
      for (const assertion of task.grader.noRegression) {
        const outcome = assertion.kind === 'dom'
          ? await runDomAssertion(page, assertion, servedUrl)
           : runCodeAssertion(workspaceDir, assertion)
        results.push({ assertion, ok: outcome.ok, expected: `(no-regression) ${outcome.expected}`, measured: outcome.measured })
        if (!outcome.ok) pass = false
      }
    }
    if (task.grader.negative !== undefined && task.grader.negative.length > 0) {
      const outcome = checkNegative(workspaceDir, task.grader.negative)
      if (outcome !== undefined) {
        results.push({ assertion: { kind: 'negative' }, ok: false, expected: outcome.expected, measured: outcome.measured })
        pass = false
      }
    }
    let screenshot: string | undefined
    if (!pass) {
      mkdirSync(evidenceDir, { recursive: true })
      screenshot = join(evidenceDir, 'grader-failure.png')
      try {
        await page.goto(servedUrl, { waitUntil: 'load' })
        await page.screenshot({ path: screenshot, fullPage: true })
      } catch {
        screenshot = undefined
      }
    }
    return { pass, attribution: pass ? 'unknown' : 'wrong-value', results, ...(screenshot === undefined ? {} : { screenshot }) }
  } finally {
    await browser.close()
  }
}

/** Convenience: prepare, serve, grade, and clean up one variant. */
export async function gradeVariant(
  task: LoadedEvalTask,
  variant: 'baseline' | 'golden',
  evidenceDir: string,
): Promise<GraderOutcome & { variantDir: string }> {
  const variantDir = prepareVariant(task, variant)
  const served = await serveFixtureDir(task, variantDir)
  try {
    const outcome = await grade(task, served.url, variantDir, evidenceDir)
    return { ...outcome, variantDir }
  } finally {
    await served.stop()
    if (task.fixtureKind !== 'static') {
      rmSync(variantDir, { recursive: true, force: true })
    }
  }
}

export { probeFreePort }
