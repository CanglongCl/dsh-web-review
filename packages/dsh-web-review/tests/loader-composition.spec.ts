/**
 * REAL-composition test for the node half (upstream testing rule): a
 * test-only cordis.yml booted through the real Loader + Include mounts the
 * webserver and this package; a local fixture http server stands in for the
 * target; assertions observe the user-visible HTTP surface of the running
 * proxy route (rewritten HTML, redirects, stripped headers, byte-safe POST,
 * HEAD, query references and error containment). Module importing is stubbed
 * via the Loader's internal seam
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
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import HttpServer from '@deepseek-ai/dsh-host-webserver'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as plugin from '../src/index.ts'
import { PREVIEW_GUIDANCE, PROXY_PREFIX } from '../src/index.ts'
import { MAX_ANNOTATION_BODY, type AnnotationSnapshot } from '../src/annotation-contract.ts'

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
    res.setHeader('set-cookie', 'preview-secret=must-not-reach-host')
    res.setHeader('clear-site-data', '"cookies"')
    if (url.pathname === '/redirect') {
      res.writeHead(302, { location: '/nested/page.html' })
      res.end()
      return
    }
    if (url.pathname === '/remote-redirect') {
      res.writeHead(302, { location: 'https://example.com/' })
      res.end()
      return
    }
    if (url.pathname === '/post-303' && req.method === 'POST') {
      res.writeHead(303, { location: '/query?redirected=yes' })
      res.end()
      return
    }
    if (url.pathname === '/post-307' && req.method === 'POST') {
      res.writeHead(307, { location: '/binary' })
      res.end()
      return
    }
    if (url.pathname === '/nested/page.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<html><head></head><body><img src="asset.png"></body></html>')
      return
    }
    if (url.pathname === '/query') {
      res.writeHead(200, { 'content-type': 'text/plain', 'x-seen-method': req.method ?? '' })
      res.end(url.search)
      return
    }
    if (url.pathname === '/binary' && req.method === 'POST') {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer | string) => { chunks.push(Buffer.from(chunk)) })
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/octet-stream' })
        res.end(Buffer.concat(chunks))
      })
      return
    }
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

/** Boot a test cordis.yml (webserver + dsh-web-review) through the real Loader. */
async function loadComposition(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-web-review-loader-'))
  const dist = join(root, 'dist')
  await mkdir(dist)
  const distIndex = join(dist, 'index.html')
  await writeFile(distIndex, '<head></head><body>shell</body>')
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-agent'",
    '',
    "- name: '@deepseek-ai/dsh-system-prompt'",
    '',
    "- name: '@deepseek-ai/dsh-host-webserver'",
    '  config:',
    "    host: '127.0.0.1'",
    '    port: 0',
    `    distIndex: '${distIndex}'`,
    '',
    "- name: 'dsh-web-review-test'",
    '',
  ].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-host-webserver', HttpServer],
    ['dsh-web-review-test', plugin],
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

function annotationSnapshot(sessionId = 'session-1', comments = 1): AnnotationSnapshot {
  return {
    sessionId,
    page: { url: 'http://localhost:5173/', title: 'Example Domain' },
    comments: Array.from({ length: comments }, (_, index) => ({
      id: `pick-${index + 1}`,
      comment: 'Make this heading smaller.',
      tagName: 'h1',
      role: 'heading',
      label: 'Example Domain',
      cssPath: 'html > body > div > h1',
      fullPath: 'html > body > div > h1',
      stableClasses: [],
      anchor: null,
      changes: [],
      textChange: null,
      viewport: { width: 597, height: 835 },
    })),
  }
}

function registerStubAgent(rawId = 'session-1'): {
  dispose: () => void
} {
  if (context === undefined) throw new Error('composition is not loaded')
  const id = SessionId(rawId)
  const agent = {
    id,
    session: Session.create(id),
    ctx: new Context(),
  } as unknown as Agent
  return { dispose: context.agents.register(agent) }
}

describe('/webview-proxy (real Loader + webserver composition)', () => {
  it('registers the reviewed Preview capability guidance', async () => {
    const loaded = await loadComposition()
    const section = (await loaded.systemPrompt.assemble()).sections
      .find(candidate => candidate.name === 'plugin:dsh-web-review-preview')
    expect(section?.text).toBe(PREVIEW_GUIDANCE)
  })

  it('serves rewritten HTML with base injection and stripped framing headers', async () => {
    await loadComposition()
    const fixturePort = String(new URL(fixtureUrl).port)
    const response = await fetch(`http://127.0.0.1:${port}${proxyPath(fixtureUrl + '/')}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    expect(response.headers.get('x-frame-options')).toBeNull()
    expect(response.headers.get('content-security-policy')).toBeNull()
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('clear-site-data')).toBeNull()
    const body = await response.text()
    expect(body).toContain(`<base href="${PROXY_PREFIX}/http%3A//127.0.0.1%3A${fixturePort}/">`)
    // Local root-relative URLs are proxied; remote and plain-relative URLs
    // keep browser-native behavior and never become host-origin content.
    expect(body).toContain('href="http://target.test/page2.html"')
    expect(body).toContain(`href="${PROXY_PREFIX}/http%3A//127.0.0.1%3A${fixturePort}/rooted.html"`)
    expect(body).toContain('src="img.png"')
    expect(body).toContain('action="http://target.test/submit"')
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

  it('forwards binary POST bodies without text transcoding', async () => {
    await loadComposition()
    const bytes = Uint8Array.from([0, 255, 128, 13, 10, 1])
    const response = await fetch(`http://127.0.0.1:${port}${proxyPath(fixtureUrl + '/binary')}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: bytes,
    })
    expect(response.status).toBe(200)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes)
  })

  it('uses the final redirect URL as the document base', async () => {
    await loadComposition()
    const fixturePort = String(new URL(fixtureUrl).port)
    const response = await fetch(`http://127.0.0.1:${port}${proxyPath(fixtureUrl + '/redirect')}`)
    const body = await response.text()
    expect(body).toContain(
      `<base href="${PROXY_PREFIX}/http%3A//127.0.0.1%3A${fixturePort}/nested/page.html">`,
    )
    expect(body).toContain('src="asset.png"')
  })

  it('matches Fetch POST redirect semantics for 303 and 307', async () => {
    await loadComposition()
    const converted = await fetch(`http://127.0.0.1:${port}${proxyPath(fixtureUrl + '/post-303')}`, {
      method: 'POST', body: 'discarded', headers: { 'content-type': 'text/plain' },
    })
    expect(converted.headers.get('x-seen-method')).toBe('GET')
    expect(await converted.text()).toBe('?redirected=yes')

    const bytes = Uint8Array.from([0, 255, 7])
    const preserved = await fetch(`http://127.0.0.1:${port}${proxyPath(fixtureUrl + '/post-307')}`, {
      method: 'POST', body: bytes, headers: { 'content-type': 'application/octet-stream' },
    })
    expect(new Uint8Array(await preserved.arrayBuffer())).toEqual(bytes)
  })

  it('promotes query-only proxy references into the encoded target URL', async () => {
    await loadComposition()
    const response = await fetch(
      `http://127.0.0.1:${port}${proxyPath(fixtureUrl + '/query?old=1')}?new=2&next=yes`,
    )
    expect(await response.text()).toBe('?new=2&next=yes')
  })

  it('forwards HEAD as HEAD and returns no response body', async () => {
    await loadComposition()
    const response = await fetch(`http://127.0.0.1:${port}${proxyPath(fixtureUrl + '/query')}`, {
      method: 'HEAD',
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('x-seen-method')).toBe('HEAD')
    expect(await response.text()).toBe('')
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

  it('rejects direct remote targets and local-to-remote redirects', async () => {
    await loadComposition()
    const direct = await fetch(`http://127.0.0.1:${port}${proxyPath('https://example.com/')}`)
    expect(direct.status).toBe(400)
    const redirected = await fetch(
      `http://127.0.0.1:${port}${proxyPath(fixtureUrl + '/remote-redirect')}`,
    )
    expect(redirected.status).toBe(502)
  })
})

describe('/webview-annotations (real Loader + webserver composition)', () => {
  it('stores pending context for a live agent without injecting and deduplicates it', async () => {
    await loadComposition()
    registerStubAgent()
    const request = (): Promise<Response> => fetch(`http://127.0.0.1:${port}/webview-annotations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(annotationSnapshot()),
    })
    const response = await request()
    expect(response.status).toBe(200)
    expect(response.headers.get('x-webview-annotation-result')).toBe('pending')
    const receipt = await response.json() as { kind: string; snapshotId: string }
    expect(receipt).toMatchObject({ kind: 'ready', snapshotId: expect.any(String) })
    const duplicate = await request()
    expect(duplicate.headers.get('x-webview-annotation-result')).toBe('deduplicated')
    expect(await duplicate.json()).toEqual(receipt)
  })

  it('clears pending state without creating a model context', async () => {
    await loadComposition()
    registerStubAgent()
    const post = (body: AnnotationSnapshot): Promise<Response> => fetch(`http://127.0.0.1:${port}/webview-annotations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const initialEmpty = await post(annotationSnapshot('session-1', 0))
    expect(initialEmpty.headers.get('x-webview-annotation-result')).toBe('initial-empty')
    await post(annotationSnapshot())
    const cleared = await post(annotationSnapshot('session-1', 0))
    expect(cleared.headers.get('x-webview-annotation-result')).toBe('cleared')
  })

  it('requires a live session and releases dedupe state on agent disposal', async () => {
    await loadComposition()
    const body = JSON.stringify(annotationSnapshot())
    const post = (): Promise<Response> => fetch(`http://127.0.0.1:${port}/webview-annotations`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body,
    })
    expect((await post()).status).toBe(404)
    const first = registerStubAgent()
    expect((await post()).status).toBe(200)
    first.dispose()
    const replacement = registerStubAgent()
    expect((await post()).headers.get('x-webview-annotation-result')).toBe('pending')
    replacement.dispose()
  })

  it('rejects malformed/legacy bodies, missing content type and empty sessionId', async () => {
    await loadComposition()
    registerStubAgent()
    const bad = await fetch(`http://127.0.0.1:${port}/webview-annotations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    })
    expect(bad.status).toBe(400)
    const legacy = await fetch(`http://127.0.0.1:${port}/webview-annotations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: '', xml: '<annotation/>' }),
    })
    expect(legacy.status).toBe(400)
    const missingType = await fetch(`http://127.0.0.1:${port}/webview-annotations`, {
      method: 'POST', body: JSON.stringify(annotationSnapshot()),
    })
    expect(missingType.status).toBe(415)
  })

  it('rejects oversized bodies with 413', async () => {
    await loadComposition()
    const response = await fetch(`http://127.0.0.1:${port}/webview-annotations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'x'.repeat(MAX_ANNOTATION_BODY + 1),
    })
    expect(response.status).toBe(413)
  })

  it('rejects non-POST methods with 405', async () => {
    await loadComposition()
    const response = await fetch(`http://127.0.0.1:${port}/webview-annotations`)
    expect(response.status).toBe(405)
  })
})
