/**
 * REAL-composition test for the node half (upstream testing rule): a
 * test-only cordis.yml booted through the real Loader + Include mounts the
 * webserver and this package; a local fixture http server stands in for the
 * target; assertions observe the user-visible HTTP surface of the running
 * proxy route (rewritten HTML, stripped headers, pass-through, POST, error
 * containment). Module importing is stubbed via the Loader's internal seam
 * (the harness's own webserver suite pattern); everything else — fibers,
 * injects, routes, the HTTP stack — is real.
 */
import { createServer, type Server } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import Loader from '@cordisjs/plugin-loader'
import Include from '@cordisjs/plugin-include'
import HttpServer from '@deepseek-ai/dsh-host-webserver'
import * as plugin from '../src/index.ts'
import { PROXY_PREFIX } from '../src/index.ts'
import { MAX_ANNOTATION_BODY } from '../src/prompt-inject.ts'

const TARGET_HTML = `<!doctype html>
<html><head>
  <meta charset="utf-8">
  <title>fixture</title>
  <link rel="stylesheet" href="style.css">
</head><body>
  <a href="http://target.test/page2.html">absolute</a>
  <a href="/rooted.html">rooted</a>
  <img src="img.png">
  <form action="http://target.test/submit" method="post"></form>
</body></html>`

let fixture: Server
let fixtureUrl = ''
let context: Context | undefined
let root: string | undefined
let port = 0

beforeAll(async () => {
  fixture = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://target.test')
    res.setHeader('x-frame-options', 'DENY')
    res.setHeader('content-security-policy', "default-src 'none'")
    if (req.method === 'POST') {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.end(`posted:${body}`)
      })
      return
    }
    if (url.pathname === '/app.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
      res.end('export const x = 1;\n')
      return
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(TARGET_HTML)
  })
  await new Promise<void>((resolve) => { fixture.listen(0, '127.0.0.1', resolve) })
  const address = fixture.address()
  if (address === null || typeof address === 'string') throw new Error('fixture failed to bind')
  fixtureUrl = `http://127.0.0.1:${address.port}`
})

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    fixture.close((error) => (error === undefined ? resolve() : reject(error)))
  })
})

/** Boot a test cordis.yml (webserver + ui-webview) through the real Loader. */
async function loadComposition(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'ui-webview-loader-'))
  const dist = join(root, 'dist')
  await mkdir(dist)
  const distIndex = join(dist, 'index.html')
  await writeFile(distIndex, '<head></head><body>shell</body>')
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-host-webserver'",
    '  config:',
    "    host: '127.0.0.1'",
    '    port: 0',
    `    distIndex: '${distIndex}'`,
    '',
    "- name: 'ui-webview-test'",
    '',
  ].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-host-webserver', HttpServer],
    ['ui-webview-test', plugin],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  const httpServer = context.httpServer
  port = httpServer.port
  expect(port).toBeGreaterThan(0)
  return context
}

function proxyPath(target: string): string {
  return `${PROXY_PREFIX}/${encodeURIComponent(target).replace(/%2F/g, '/')}`
}

describe('/webview-proxy (real Loader + webserver composition)', () => {
  it('serves rewritten HTML with base injection and stripped framing headers', async () => {
    await loadComposition()
    const fixturePort = String(new URL(fixtureUrl).port)
    const response = await fetch(`http://127.0.0.1:${port}${proxyPath(fixtureUrl + '/')}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    expect(response.headers.get('x-frame-options')).toBeNull()
    expect(response.headers.get('content-security-policy')).toBeNull()
    const body = await response.text()
    expect(body).toContain(`<base href="${PROXY_PREFIX}/http%3A//127.0.0.1%3A${fixturePort}/">`)
    // Absolute + root-relative attribute URLs rewritten; relative left to <base>.
    expect(body).toContain(`href="${PROXY_PREFIX}/http%3A//target.test/page2.html"`)
    expect(body).toContain(`href="${PROXY_PREFIX}/http%3A//127.0.0.1%3A${fixturePort}/rooted.html"`)
    expect(body).toContain(`src="${PROXY_PREFIX}/http%3A//127.0.0.1%3A${fixturePort}/img.png"`)
    expect(body).toContain(`action="${PROXY_PREFIX}/http%3A//target.test/submit"`)
  })

  it('passes non-HTML through unchanged', async () => {
    await loadComposition()
    const response = await fetch(`http://127.0.0.1:${port}${proxyPath(fixtureUrl + '/app.js')}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/javascript')
    expect(await response.text()).toBe('export const x = 1;\n')
  })

  it('forwards POST bodies (rewritten form actions)', async () => {
    await loadComposition()
    const response = await fetch(`http://127.0.0.1:${port}${proxyPath(fixtureUrl + '/submit')}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'a=1&b=2',
    })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('posted:a=1&b=2')
  })

  it('rejects malformed targets with 400', async () => {
    await loadComposition()
    for (const path of [`${PROXY_PREFIX}/`, `${PROXY_PREFIX}/not%20a%20url`, `${PROXY_PREFIX}/file%3A//etc/passwd`]) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`)
      expect(response.status).toBe(400)
    }
  })

  it('returns 502 for unreachable targets and rejects unsupported methods', async () => {
    await loadComposition()
    const response = await fetch(`http://127.0.0.1:${port}${proxyPath('http://127.0.0.1:1/')}`)
    expect(response.status).toBe(502)
    const put = await fetch(`http://127.0.0.1:${port}${proxyPath(fixtureUrl + '/')}`, { method: 'PUT' })
    expect(put.status).toBe(405)
  })
})

describe('/webview-annotations (real Loader + webserver composition)', () => {
  it('accepts a valid POST body with 204', async () => {
    await loadComposition()
    const response = await fetch(`http://127.0.0.1:${port}/webview-annotations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'session-1', xml: '<annotation hint="x"/>' }),
    })
    expect(response.status).toBe(204)
  })

  it('accepts an empty xml (annotation cleared) with 204', async () => {
    await loadComposition()
    const response = await fetch(`http://127.0.0.1:${port}/webview-annotations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'session-1', xml: '' }),
    })
    expect(response.status).toBe(204)
  })

  it('rejects malformed bodies and empty sessionId with 400', async () => {
    await loadComposition()
    const bad = await fetch(`http://127.0.0.1:${port}/webview-annotations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    })
    expect(bad.status).toBe(400)
    const empty = await fetch(`http://127.0.0.1:${port}/webview-annotations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: '', xml: '<annotation/>' }),
    })
    expect(empty.status).toBe(400)
  })

  it('rejects oversized bodies with 413', async () => {
    await loadComposition()
    const response = await fetch(`http://127.0.0.1:${port}/webview-annotations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'session-1', xml: 'x'.repeat(MAX_ANNOTATION_BODY) }),
    })
    expect(response.status).toBe(413)
  })

  it('rejects non-POST methods with 405', async () => {
    await loadComposition()
    const response = await fetch(`http://127.0.0.1:${port}/webview-annotations`)
    expect(response.status).toBe(405)
  })
})
