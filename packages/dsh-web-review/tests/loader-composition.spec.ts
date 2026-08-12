/**
 * REAL-composition test for the node half (upstream testing rule): a
 * test-only cordis.yml booted through the real Loader + Include mounts the
 * webserver and this package; a local fixture http server stands in for the
 * target; assertions observe the user-visible HTTP surface of the running
 * isolated Preview Origin (rewritten HTML, redirects, stripped headers, byte-safe POST,
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
import { Context } from 'cordis'
import Loader from '@cordisjs/plugin-loader'
import Include from '@cordisjs/plugin-include'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import HttpServer from '@deepseek-ai/dsh-host-webserver'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import SkillService from '@deepseek-ai/dsh-skill'
import * as plugin from '../src/index.ts'
import { PREVIEW_GUIDANCE } from '../src/index.ts'
import { MAX_ANNOTATION_BODY, type AnnotationSnapshot } from '../src/annotation-contract.ts'
import {
  PREVIEW_CLIENT_HEADER,
  PREVIEW_CLIENT_HEADER_VALUE,
  PREVIEW_NAVIGATE_PREFIX,
  PREVIEW_PROXY_PREFIX,
  PREVIEW_SESSIONS_PATH,
  previewSessionDescriptorOf,
  type PreviewSessionDescriptor,
} from '../src/preview-contract.ts'

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
    if (url.pathname === '/style.css') {
      res.writeHead(200, { 'content-type': 'text/css; charset=utf-8' })
      res.end('body { color: rebeccapurple; }\n')
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
    "- name: '@deepseek-ai/dsh-skill'",
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
    ['@deepseek-ai/dsh-skill', SkillService],
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

async function createPreview(target: string): Promise<PreviewSessionDescriptor> {
  const hostOrigin = `http://127.0.0.1:${String(port)}`
  const response = await fetch(`${hostOrigin}${PREVIEW_SESSIONS_PATH}`, {
    method: 'POST',
    headers: {
      origin: hostOrigin,
      'content-type': 'application/json',
      [PREVIEW_CLIENT_HEADER]: PREVIEW_CLIENT_HEADER_VALUE,
    },
    body: JSON.stringify({ target }),
  })
  expect(response.status).toBe(201)
  const descriptor = previewSessionDescriptorOf(await response.json() as unknown)
  if (descriptor === undefined) throw new Error('invalid preview descriptor')
  return descriptor
}

function annotationSnapshot(sessionId = 'session-1', comments = 1): AnnotationSnapshot {
  return {
    sessionId,
    selectedSkills: [],
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

describe('isolated preview Origin (real Loader + webserver composition)', () => {
  it('registers the reviewed Preview capability guidance', async () => {
    const loaded = await loadComposition()
    const section = (await loaded.systemPrompt.assemble()).sections
      .find(candidate => candidate.name === 'plugin:dsh-web-review-preview')
    expect(section?.text).toBe(PREVIEW_GUIDANCE)
  })

  it('creates a distinct random Origin and injects the bridge before page scripts', async () => {
    await loadComposition()
    const descriptor = await createPreview(fixtureUrl + '/')
    expect(descriptor.frameOrigin).not.toBe(`http://127.0.0.1:${String(port)}`)
    expect(new URL(descriptor.frameOrigin).hostname).toMatch(/^[a-f\d]{32}\.localhost$/u)
    const response = await fetch(descriptor.frameUrl)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    expect(response.headers.get('x-frame-options')).toBeNull()
    expect(response.headers.get('content-security-policy'))
      .toBe(`frame-ancestors http://127.0.0.1:${String(port)}`)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('clear-site-data')).toBeNull()
    const body = await response.text()
    const baseHref = `${PREVIEW_PROXY_PREFIX}http%3A//127.0.0.1%3A${new URL(fixtureUrl).port}/`
    const base = `<base href="${baseHref}">`
    expect(body).toContain(base)
    expect(body.indexOf('data-dsh-web-review="config"')).toBeLessThan(body.indexOf('<link'))
    expect(body.indexOf('data-dsh-web-review="bridge"')).toBeLessThan(body.indexOf('<link'))
    expect(body).toContain(`href="${PREVIEW_NAVIGATE_PREFIX}http%3A//target.test/page2.html"`)
    expect(body).toContain(`href="${PREVIEW_PROXY_PREFIX}http%3A//127.0.0.1%3A${new URL(fixtureUrl).port}/rooted.html"`)
    expect(body).toContain('src="img.png"')
    expect(body).toContain(`action="${PREVIEW_NAVIGATE_PREFIX}http%3A//target.test/submit"`)
    const stylesheet = await fetch(new URL('style.css', new URL(baseHref, descriptor.frameOrigin)))
    expect(stylesheet.status).toBe(200)
    expect(await stylesheet.text()).toBe('body { color: rebeccapurple; }\n')
  })

  it('passes non-HTML through unchanged', async () => {
    await loadComposition()
    const response = await fetch((await createPreview(fixtureUrl + '/app.js')).frameUrl)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/javascript')
    expect(await response.text()).toBe('export const x = 1;\n')
  })

  it('forwards POST bodies (rewritten form actions)', async () => {
    await loadComposition()
    const response = await fetch((await createPreview(fixtureUrl + '/submit')).frameUrl, {
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
    const response = await fetch((await createPreview(fixtureUrl + '/binary')).frameUrl, {
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
    const response = await fetch((await createPreview(fixtureUrl + '/redirect')).frameUrl)
    const body = await response.text()
    expect(body).toContain(
      `<base href="${PREVIEW_PROXY_PREFIX}http%3A//127.0.0.1%3A${fixturePort}/nested/page.html">`,
    )
    expect(body).toContain('src="asset.png"')
  })

  it('matches Fetch POST redirect semantics for 303 and 307', async () => {
    await loadComposition()
    const converted = await fetch((await createPreview(fixtureUrl + '/post-303')).frameUrl, {
      method: 'POST', body: 'discarded', headers: { 'content-type': 'text/plain' },
    })
    expect(converted.headers.get('x-seen-method')).toBe('GET')
    expect(await converted.text()).toBe('?redirected=yes')

    const bytes = Uint8Array.from([0, 255, 7])
    const preserved = await fetch((await createPreview(fixtureUrl + '/post-307')).frameUrl, {
      method: 'POST', body: bytes, headers: { 'content-type': 'application/octet-stream' },
    })
    expect(new Uint8Array(await preserved.arrayBuffer())).toEqual(bytes)
  })

  it('promotes query-only proxy references into the encoded target URL', async () => {
    await loadComposition()
    const response = await fetch(
      `${(await createPreview(fixtureUrl + '/query?old=1')).frameUrl}?new=2&next=yes`,
    )
    expect(await response.text()).toBe('?new=2&next=yes')
  })

  it('forwards HEAD as HEAD and returns no response body', async () => {
    await loadComposition()
    const response = await fetch((await createPreview(fixtureUrl + '/query')).frameUrl, {
      method: 'HEAD',
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('x-seen-method')).toBe('HEAD')
    expect(await response.text()).toBe('')
  })

  it('requires the same-origin JSON control request and rejects malformed targets', async () => {
    await loadComposition()
    const hostOrigin = `http://127.0.0.1:${String(port)}`
    const missingHeader = await fetch(`${hostOrigin}${PREVIEW_SESSIONS_PATH}`, {
      method: 'POST', headers: { origin: hostOrigin, 'content-type': 'application/json' }, body: '{}',
    })
    expect(missingHeader.status).toBe(415)
    const invalid = await fetch(`${hostOrigin}${PREVIEW_SESSIONS_PATH}`, {
      method: 'POST',
      headers: { origin: hostOrigin, 'content-type': 'application/json', [PREVIEW_CLIENT_HEADER]: PREVIEW_CLIENT_HEADER_VALUE },
      body: JSON.stringify({ target: 'file:///etc/passwd' }),
    })
    expect(invalid.status).toBe(400)
    const foreignOrigin = await fetch(`${hostOrigin}${PREVIEW_SESSIONS_PATH}`, {
      method: 'POST',
      headers: {
        origin: 'https://attacker.example',
        'content-type': 'application/json',
        [PREVIEW_CLIENT_HEADER]: PREVIEW_CLIENT_HEADER_VALUE,
      },
      body: JSON.stringify({ target: fixtureUrl }),
    })
    expect(foreignOrigin.status).toBe(403)
  })

  it('returns 502 for unreachable targets and rejects unsupported frame methods', async () => {
    await loadComposition()
    const descriptor = await createPreview('http://127.0.0.1:1/')
    const response = await fetch(descriptor.frameUrl)
    expect(response.status).toBe(502)
    const put = await fetch((await createPreview(fixtureUrl + '/')).frameUrl, { method: 'PUT' })
    expect(put.status).toBe(405)
  })

  it('accepts arbitrary HTTP(S) targets and isolates cross-origin redirects with a handoff document', async () => {
    await loadComposition()
    const remote = await createPreview('https://example.com/')
    expect(remote.frameUrl).toContain('/.dsh-web-review/entry/https%3A//example.com/')
    const redirected = await fetch((await createPreview(fixtureUrl + '/remote-redirect')).frameUrl)
    expect(redirected.status).toBe(200)
    const handoff = await redirected.text()
    expect(handoff).toContain('"name":"handoff"')
    expect(handoff).toContain('example.com')

    const source = await createPreview(fixtureUrl + '/')
    const getFormHandoff = await fetch(
      `${source.frameOrigin}${PREVIEW_NAVIGATE_PREFIX}https%3A//example.com/search?q=review`,
    )
    expect(await getFormHandoff.text()).toContain('search%3Fq%3Dreview')
  })

  it('mints unique Origins and revokes a completed navigation chain', async () => {
    await loadComposition()
    const first = await createPreview(fixtureUrl + '/')
    const second = await createPreview(fixtureUrl + '/')
    expect(first.frameOrigin).not.toBe(second.frameOrigin)
    const hostOrigin = `http://127.0.0.1:${String(port)}`
    const released = await fetch(`${hostOrigin}${PREVIEW_SESSIONS_PATH}`, {
      method: 'DELETE',
      headers: {
        origin: hostOrigin,
        'content-type': 'application/json',
        [PREVIEW_CLIENT_HEADER]: PREVIEW_CLIENT_HEADER_VALUE,
      },
      body: JSON.stringify({ sessionIds: [first.sessionId] }),
    })
    expect(released.status).toBe(204)
    expect((await fetch(first.frameUrl)).status).toBe(404)
    expect((await fetch(second.frameUrl)).status).toBe(200)
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
