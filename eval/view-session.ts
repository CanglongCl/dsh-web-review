/**
 * Open one harvested eval session in the published DSH Web conversation UI.
 *
 * The eval runner keeps a portable raw transcript rather than registering its
 * temporary DSH_HOME with the user's ordinary session catalog. This command
 * rebuilds the current JSONL storage layout in a disposable root, starts Web
 * against that root, selects the session through DSH's persisted client
 * selection contract, and removes the disposable copy when the window closes.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { chromium } from 'playwright'

interface SessionHeader {
  type: 'session'
  version: number
  id: string
  createdAt: number
  cwd?: string
  delegationDepth: number
}

function encodeSegment(raw: string): string {
  if (raw.length === 0) throw new Error('session id must not be empty')
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (let index = 0; index < raw.length; index++) {
    const code = raw.charCodeAt(index)
    const char = String.fromCharCode(code)
    out += char !== '~' && /^[A-Za-z0-9._-]$/.test(char)
      ? char
      : `~${code.toString(16).toUpperCase().padStart(4, '0')}`
  }
  return out
}

function projectKey(cwd: string): string {
  if (cwd.length === 0) throw new Error('session cwd must not be empty')
  let readable = ''
  let separatorRun = false
  for (let index = 0; index < cwd.length; index++) {
    const code = cwd.charCodeAt(index)
    const char = String.fromCharCode(code)
    if (char === '/' || char === '\\' || char === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (char !== '~' && /^[A-Za-z0-9._-]$/.test(char)) {
      readable += char
      separatorRun = false
    } else {
      readable += `~${code.toString(16).toUpperCase().padStart(4, '0')}`
      separatorRun = false
    }
  }
  const slug = readable.replace(/^-+/, '') || 'root'
  return `--${slug.slice(0, 251)}--`
}

function resolveLog(input: string): string {
  const path = resolve(input)
  if (!existsSync(path)) throw new Error(`eval session path does not exist: ${path}`)
  const log = statSync(path).isDirectory() ? join(path, 'session.jsonl') : path
  if (!existsSync(log)) throw new Error(`eval run has no session.jsonl: ${path}`)
  return log
}

function readHeader(log: string): SessionHeader {
  const firstLine = readFileSync(log, 'utf8').split('\n', 1)[0]
  if (firstLine === undefined || firstLine === '') throw new Error(`empty session log: ${log}`)
  let value: unknown
  try {
    value = JSON.parse(firstLine)
  } catch (error) {
    throw new Error(`invalid session header in ${log}`, { cause: error })
  }
  if (typeof value !== 'object' || value === null
    || (value as { type?: unknown }).type !== 'session'
    || typeof (value as { id?: unknown }).id !== 'string'
    || typeof (value as { version?: unknown }).version !== 'number'
    || typeof (value as { createdAt?: unknown }).createdAt !== 'number'
    || typeof (value as { delegationDepth?: unknown }).delegationDepth !== 'number'
    || ((value as { cwd?: unknown }).cwd !== undefined && typeof (value as { cwd?: unknown }).cwd !== 'string')) {
    throw new Error(`unsupported session header in ${log}`)
  }
  return value as SessionHeader
}

function yamlString(value: string): string {
  return JSON.stringify(value)
}

function waitForWeb(child: ChildProcess): Promise<string> {
  return new Promise((resolveUrl, reject) => {
    let output = ''
    const inspect = (chunk: Buffer): void => {
      const text = chunk.toString('utf8')
      output += text
      process.stdout.write(text)
      const match = output.match(/dsh web: (http:\/\/[^\s]+)/)
      if (match?.[1] !== undefined) resolveUrl(match[1].replace('0.0.0.0', '127.0.0.1'))
    }
    child.stdout?.on('data', inspect)
    child.stderr?.on('data', (chunk: Buffer) => { process.stderr.write(chunk) })
    child.once('error', reject)
    child.once('exit', code => { reject(new Error(`dsh web exited before readiness (code ${String(code)})`)) })
  })
}

async function main(): Promise<void> {
  const argument = process.argv[2]
  if (argument === undefined || argument === '') {
    console.error('usage: pnpm eval:view <run-directory-or-session.jsonl> [--headless]')
    process.exitCode = 2
    return
  }
  const log = resolveLog(argument)
  const header = readHeader(log)
  const temporary = mkdtempSync(join(tmpdir(), 'dsh-eval-viewer-'))
  const sessionsRoot = join(temporary, 'sessions')
  const dshHome = join(temporary, 'dsh-home')
  const project = header.cwd === undefined ? '_no-cwd' : projectKey(header.cwd)
  const stagedLog = join(sessionsRoot, project, encodeSegment(header.id), 'session.jsonl')
  mkdirSync(dirname(stagedLog), { recursive: true })
  copyFileSync(log, stagedLog)
  const overlay = join(temporary, 'viewer.cordis.yml')
  writeFileSync(overlay, [
    '- id: session-persistence-jsonl',
    '  config:',
    `    root: ${yamlString(sessionsRoot)}`,
    '    packChunks: false',
    '    compression: none',
    '- id: telemetry-otel',
    '  disabled: true',
    '',
  ].join('\n'))

  const configuredCli = process.env.EVAL_DSH_CLI?.trim()
  const cli = configuredCli === undefined || configuredCli === '' ? 'dsh' : configuredCli
  const isJavaScriptEntry = cli.endsWith('.js')
  const child = spawn(isJavaScriptEntry ? process.execPath : cli, [
    ...(isJavaScriptEntry ? [cli] : []),
    '--profile', 'web', '--patch', overlay, '--host', '127.0.0.1', '--port', '0',
  ], {
    cwd: header.cwd !== undefined && existsSync(header.cwd) ? header.cwd : dirname(log),
    env: { ...process.env, DSH_HOME: dshHome, DSH_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  const stop = (): void => {
    if (child.exitCode === null) child.kill('SIGTERM')
    rmSync(temporary, { recursive: true, force: true })
  }
  process.once('SIGINT', () => { void browser?.close().finally(stop) })
  process.once('SIGTERM', () => { void browser?.close().finally(stop) })
  try {
    const url = await waitForWeb(child)
    browser = await chromium.launch({ headless: process.argv.includes('--headless') })
    const page = await browser.newPage()
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await page.evaluate((sessionId) => {
      localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId }))
    }, header.id)
    const historyLoaded = page.waitForResponse(response => response.url().endsWith('/api/session.history'), { timeout: 30_000 })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await historyLoaded
    console.log(`已在正式版 DSH 中打开 ${basename(dirname(log))} / ${header.id}`)
    if (process.argv.includes('--headless')) {
      await browser.close()
    } else {
      await new Promise<void>(resolveClose => { browser?.once('disconnected', () => { resolveClose() }) })
    }
  } finally {
    stop()
  }
}

await main()
