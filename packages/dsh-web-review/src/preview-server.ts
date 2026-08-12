/** Dedicated loopback server that isolates every preview session by Origin. */
import { randomBytes } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP, type LookupFunction, type Socket } from 'node:net'
import { Readable } from 'node:stream'
import {
  PREVIEW_BRIDGE_PATH,
  PREVIEW_BRIDGE_PROTOCOL,
  PREVIEW_BRIDGE_VERSION,
  PREVIEW_ENTRY_PREFIX,
  PREVIEW_NAVIGATE_PREFIX,
  PREVIEW_PROXY_PREFIX,
  type PreviewChannel,
  type PreviewSessionDescriptor,
  type PreviewSessionId,
} from './preview-contract.ts'
import { decodeTarget, encodeTarget, isPreviewableUrl } from './proxy-url.ts'
import {
  BodyLimitError,
  decodeHtml,
  isHtmlContentType,
  readRequestBytes,
  readResponseBytes,
  sanitizedResponseHeaders,
} from './proxy-transport.ts'
import { rewriteIsolatedHtml } from './rewrite.ts'

const SESSION_TTL_MS = 30 * 60 * 1_000
const MAX_SESSIONS = 128
const MAX_HANDOFFS_PER_SESSION = 32
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const FORWARD_HEADERS = ['accept', 'accept-language', 'content-type'] as const

interface PreviewSession {
  id: PreviewSessionId
  channel: PreviewChannel
  parentOrigin: string
  targetOrigin: string
  initialTarget: string
  touchedAt: number
  handoffs: number
  handoffDepth: number
  pinnedAddresses?: Array<{ address: string; family: 4 | 6 }>
}

type PreviewMethod = 'GET' | 'HEAD' | 'POST'

interface PreviewFetchResult {
  response?: Response
  target: string
  handoff?: string
}

export interface IsolatedPreviewServer {
  createSession: (target: string, parentOrigin: string) => PreviewSessionDescriptor
  releaseSessions: (ids: readonly PreviewSessionId[]) => void
  close: () => Promise<void>
  port: number
}

function opaqueId(): string {
  return randomBytes(16).toString('hex')
}

function methodOf(value: string): PreviewMethod | undefined {
  return value === 'GET' || value === 'HEAD' || value === 'POST' ? value : undefined
}

function parentOriginOf(value: string): string | undefined {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value
      ? value
      : undefined
  } catch {
    return undefined
  }
}

function requestHeaders(req: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const name of FORWARD_HEADERS) {
    const value = req.headers[name]
    if (typeof value === 'string') headers[name] = value
  }
  return headers
}

function sessionOrigin(id: PreviewSessionId, port: number): string {
  return `http://${id}.localhost:${String(port)}`
}

function descriptorOf(session: PreviewSession, port: number): PreviewSessionDescriptor {
  const frameOrigin = sessionOrigin(session.id, port)
  return {
    sessionId: session.id,
    frameOrigin,
    frameUrl: `${frameOrigin}${PREVIEW_ENTRY_PREFIX}${encodeTarget(session.initialTarget)}`,
    targetOrigin: session.targetOrigin,
    channel: session.channel,
  }
}

function handoffDocument(
  current: PreviewSession,
  next: PreviewSessionDescriptor,
): string {
  const message = JSON.stringify({
    protocol: PREVIEW_BRIDGE_PROTOCOL,
    version: PREVIEW_BRIDGE_VERSION,
    channel: current.channel,
    direction: 'frame-to-host',
    event: { name: 'handoff', payload: next },
  }).replaceAll('<', '\\u003c')
  const target = JSON.stringify(next.frameUrl).replaceAll('<', '\\u003c')
  const origin = JSON.stringify(current.parentOrigin).replaceAll('<', '\\u003c')
  return '<!doctype html><meta charset="utf-8"><title>Opening preview…</title>'
    + `<script>(function(){var m=${message};var p=${origin};`
    + 'parent.postMessage(m,p);'
    + `location.replace(${target});})();</script>`
}

function targetFromEncoded(pathname: string, prefix: string): string | undefined {
  if (!pathname.startsWith(prefix)) return undefined
  try {
    const target = decodeTarget(pathname.slice(prefix.length))
    return isPreviewableUrl(target) ? new URL(target).href : undefined
  } catch {
    return undefined
  }
}

async function fetchPreview(
  session: PreviewSession,
  target: string,
  options: {
    method: PreviewMethod
    body?: Uint8Array<ArrayBuffer>
    headers: Record<string, string>
    signal: AbortSignal
  },
): Promise<PreviewFetchResult> {
  let current = target
  let method = options.method
  let body = options.body
  let headers = new Headers(options.headers)
  const boundOrigin = new URL(target).origin
  for (let redirects = 0; ; redirects += 1) {
    const response = await pinnedRequest(session, current, {
      method,
      signal: options.signal,
      headers,
      ...(body === undefined ? {} : { body }),
    })
    const location = response.headers.get('location')
    if (!REDIRECT_STATUSES.has(response.status) || location === null) {
      return { response, target: current }
    }
    if (redirects >= 10) {
      await response.body?.cancel('too many redirects')
      throw new Error('too many redirects')
    }
    const next = new URL(location, current).href
    if (!isPreviewableUrl(next)) {
      await response.body?.cancel('invalid redirect')
      throw new Error('invalid redirect')
    }
    await response.body?.cancel('following redirect')
    if (new URL(next).origin !== boundOrigin) return { target: current, handoff: next }
    if (((response.status === 301 || response.status === 302) && method === 'POST')
      || (response.status === 303 && method !== 'HEAD')) {
      method = 'GET'
      body = undefined
      headers = new Headers(headers)
      headers.delete('content-type')
    }
    current = next
  }
}

async function addressesFor(session: PreviewSession, hostname: string): Promise<Array<{ address: string; family: 4 | 6 }>> {
  if (session.pinnedAddresses !== undefined) return session.pinnedAddresses
  const literalFamily = isIP(hostname)
  const addresses: Array<{ address: string; family: 4 | 6 }> = literalFamily === 4 || literalFamily === 6
    ? [{ address: hostname, family: literalFamily }]
    : (await lookup(hostname, { all: true, verbatim: true }))
        .map(result => ({ address: result.address, family: result.family === 6 ? 6 : 4 }))
  if (addresses.length === 0) throw new Error('preview target resolved no address')
  session.pinnedAddresses = addresses
  return addresses
}

async function requestWithAddress(
  target: string,
  address: { address: string; family: 4 | 6 },
  options: {
    method: PreviewMethod
    body?: Uint8Array<ArrayBuffer>
    headers: Headers
    signal: AbortSignal
  },
): Promise<Response> {
  const url = new URL(target)
  const pinnedLookup: LookupFunction = (_hostname, lookupOptions, callback) => {
    if (lookupOptions.all === true) callback(null, [address])
    else callback(null, address.address, address.family)
  }
  const headers = Object.fromEntries(options.headers.entries())
  return await new Promise<Response>((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      method: options.method,
      headers,
      lookup: pinnedLookup,
      signal: options.signal,
      ...(url.protocol === 'https:' ? { servername: url.hostname } : {}),
    }, (incoming) => {
      const responseHeaders = new Headers()
      for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
        const name = incoming.rawHeaders[index]
        const value = incoming.rawHeaders[index + 1]
        if (name !== undefined && value !== undefined) responseHeaders.append(name, value)
      }
      const noBody = options.method === 'HEAD' || incoming.statusCode === 204 || incoming.statusCode === 304
      const stream = noBody ? null : Readable.toWeb(incoming) as ReadableStream<Uint8Array<ArrayBuffer>>
      resolve(new Response(stream, {
        status: incoming.statusCode ?? 502,
        statusText: incoming.statusMessage ?? '',
        headers: responseHeaders,
      }))
    })
    request.once('error', reject)
    if (options.body !== undefined) request.write(options.body)
    request.end()
  })
}

async function pinnedRequest(
  session: PreviewSession,
  target: string,
  options: {
    method: PreviewMethod
    body?: Uint8Array<ArrayBuffer>
    headers: Headers
    signal: AbortSignal
  },
): Promise<Response> {
  const addresses = await addressesFor(session, new URL(target).hostname)
  let failure: unknown
  for (const address of addresses) {
    if (options.signal.aborted) throw options.signal.reason
    try {
      return await requestWithAddress(target, address, options)
    } catch (error) {
      failure = error
    }
  }
  throw new Error('preview target connection failed', { cause: failure })
}

function noStoreHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    ...extra,
  }
}

/** Start the independent loopback listener after the bridge artifact is built. */
export async function startIsolatedPreviewServer(bridgeSource: string): Promise<IsolatedPreviewServer> {
  const sessions = new Map<PreviewSessionId, PreviewSession>()
  const sockets = new Set<Socket>()
  let port = 0

  const createSession = (
    target: string,
    parentOrigin: string,
    handoffDepth = 0,
  ): PreviewSessionDescriptor => {
    if (!isPreviewableUrl(target)) throw new Error('invalid preview target')
    const normalizedParent = parentOriginOf(parentOrigin)
    if (normalizedParent === undefined) throw new Error('invalid parent origin')
    if (sessions.size >= MAX_SESSIONS) {
      const oldest = [...sessions.values()].sort((left, right) => left.touchedAt - right.touchedAt)[0]
      if (oldest !== undefined) sessions.delete(oldest.id)
    }
    const id = opaqueId() as PreviewSessionId
    const session: PreviewSession = {
      id,
      channel: opaqueId() as PreviewChannel,
      parentOrigin: normalizedParent,
      targetOrigin: new URL(target).origin,
      initialTarget: new URL(target).href,
      touchedAt: Date.now(),
      handoffs: 0,
      handoffDepth,
    }
    sessions.set(id, session)
    return descriptorOf(session, port)
  }

  const sessionFor = (req: IncomingMessage): PreviewSession | undefined => {
    const host = req.headers.host
    if (host === undefined) return undefined
    try {
      const url = new URL(`http://${host}`)
      if (Number(url.port || '80') !== port || !url.hostname.endsWith('.localhost')) return undefined
      const id = url.hostname.slice(0, -'.localhost'.length)
      if (!/^[a-f\d]{32}$/u.test(id)) return undefined
      const session = sessions.get(id as PreviewSessionId)
      if (session !== undefined) session.touchedAt = Date.now()
      return session
    } catch {
      return undefined
    }
  }

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const session = sessionFor(req)
    if (session === undefined) {
      res.writeHead(404, noStoreHeaders())
      res.end('preview session not found')
      return
    }
    let requestUrl: URL
    try {
      requestUrl = new URL(req.url ?? '/', sessionOrigin(session.id, port))
    } catch {
      res.writeHead(400, noStoreHeaders())
      res.end('bad request')
      return
    }
    if (requestUrl.pathname === PREVIEW_BRIDGE_PATH) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, noStoreHeaders({ allow: 'GET, HEAD' }))
        res.end()
        return
      }
      res.writeHead(200, noStoreHeaders({
        'content-type': 'text/javascript; charset=utf-8',
        'cross-origin-resource-policy': 'same-origin',
        'x-content-type-options': 'nosniff',
      }))
      res.end(req.method === 'HEAD' ? undefined : bridgeSource)
      return
    }

    let navigateTarget = targetFromEncoded(requestUrl.pathname, PREVIEW_NAVIGATE_PREFIX)
    if (navigateTarget !== undefined) {
      if (req.method !== 'GET' || session.handoffs >= MAX_HANDOFFS_PER_SESSION
        || session.handoffDepth >= MAX_HANDOFFS_PER_SESSION) {
        res.writeHead(req.method === 'GET' ? 429 : 405, noStoreHeaders({ allow: 'GET' }))
        res.end()
        return
      }
      if (requestUrl.search !== '') {
        const promoted = new URL(navigateTarget)
        promoted.search = requestUrl.search
        navigateTarget = promoted.href
      }
      session.handoffs += 1
      const next = createSession(navigateTarget, session.parentOrigin, session.handoffDepth + 1)
      res.writeHead(200, noStoreHeaders({
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': `default-src 'none'; script-src 'unsafe-inline'; frame-ancestors ${session.parentOrigin}`,
        'x-content-type-options': 'nosniff',
      }))
      res.end(handoffDocument(session, next))
      return
    }

    const method = methodOf(req.method ?? 'GET')
    if (method === undefined) {
      res.writeHead(405, noStoreHeaders({ allow: 'GET, HEAD, POST' }))
      res.end()
      return
    }
    const encodedTarget = targetFromEncoded(requestUrl.pathname, PREVIEW_ENTRY_PREFIX)
      ?? targetFromEncoded(requestUrl.pathname, PREVIEW_PROXY_PREFIX)
    let target = encodedTarget
    if (target === undefined && !requestUrl.pathname.startsWith('/.dsh-web-review/')) {
      target = new URL(`${requestUrl.pathname}${requestUrl.search}`, `${session.targetOrigin}/`).href
    }
    if (target === undefined || new URL(target).origin !== session.targetOrigin) {
      res.writeHead(400, noStoreHeaders())
      res.end('target outside preview session origin')
      return
    }
    if (encodedTarget !== undefined && requestUrl.search !== '') {
      const promoted = new URL(target)
      promoted.search = requestUrl.search
      target = promoted.href
    }
    let body: Buffer | undefined
    if (method === 'POST') {
      try {
        body = await readRequestBytes(req, 10 * 1024 * 1024)
      } catch (error) {
        res.writeHead(413, noStoreHeaders())
        res.end(error instanceof Error ? error.message : 'body too large')
        return
      }
    }
    const disconnected = new AbortController()
    const abort = (): void => { disconnected.abort(new Error('preview client disconnected')) }
    req.once('aborted', abort)
    res.once('close', abort)
    try {
      const result = await fetchPreview(session, target, {
        method,
        signal: AbortSignal.any([AbortSignal.timeout(15_000), disconnected.signal]),
        headers: requestHeaders(req),
        ...(body === undefined ? {} : { body: new Uint8Array(body) }),
      })
      if (result.handoff !== undefined) {
        if (session.handoffs >= MAX_HANDOFFS_PER_SESSION
          || session.handoffDepth >= MAX_HANDOFFS_PER_SESSION) {
          res.writeHead(508, noStoreHeaders())
          res.end('preview handoff limit reached')
          return
        }
        session.handoffs += 1
        const next = createSession(result.handoff, session.parentOrigin, session.handoffDepth + 1)
        res.writeHead(200, noStoreHeaders({
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': `default-src 'none'; script-src 'unsafe-inline'; frame-ancestors ${session.parentOrigin}`,
          'x-content-type-options': 'nosniff',
        }))
        res.end(handoffDocument(session, next))
        return
      }
      const upstream = result.response
      if (upstream === undefined) throw new Error('missing upstream response')
      const headers = sanitizedResponseHeaders(upstream.headers)
      const contentType = upstream.headers.get('content-type') ?? ''
      const html = isHtmlContentType(contentType)
      if (method === 'HEAD') {
        res.writeHead(upstream.status, noStoreHeaders({
          ...headers,
          ...(html ? {
            'content-security-policy': `frame-ancestors ${session.parentOrigin}`,
            'x-content-type-options': 'nosniff',
          } : {}),
        }))
        res.end()
        return
      }
      const payload = await readResponseBytes(upstream, 10 * 1024 * 1024)
      res.writeHead(upstream.status, noStoreHeaders({
        ...headers,
        ...(html ? {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': `frame-ancestors ${session.parentOrigin}`,
          'x-content-type-options': 'nosniff',
        } : {}),
      }))
      res.end(html
        ? rewriteIsolatedHtml(decodeHtml(payload, contentType), result.target, {
            proxyPrefix: PREVIEW_PROXY_PREFIX,
            navigatePrefix: PREVIEW_NAVIGATE_PREFIX,
            bridgePath: PREVIEW_BRIDGE_PATH,
            channel: session.channel,
            parentOrigin: session.parentOrigin,
          })
        : payload)
    } catch (error) {
      if (res.destroyed || res.writableEnded) return
      res.writeHead(error instanceof BodyLimitError ? 413 : 502, noStoreHeaders())
      res.end(error instanceof BodyLimitError ? error.message : 'upstream fetch failed')
    } finally {
      req.off('aborted', abort)
      res.off('close', abort)
    }
  }

  const server: Server = createServer((req, res) => { void handler(req, res) })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.once('close', () => { sockets.delete(socket) })
  })
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => { reject(error) }
    server.once('error', onError)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError)
      const address = server.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('isolated preview server has no TCP address'))
        return
      }
      port = address.port
      resolve()
    })
  })

  const expiry = setInterval(() => {
    const cutoff = Date.now() - SESSION_TTL_MS
    for (const session of sessions.values()) {
      if (session.touchedAt < cutoff) sessions.delete(session.id)
    }
  }, 60_000)
  expiry.unref()

  return {
    port,
    createSession,
    releaseSessions(ids) {
      ids.forEach(id => { sessions.delete(id) })
    },
    async close() {
      clearInterval(expiry)
      await new Promise<void>((resolve, reject) => {
        server.close(error => { if (error === undefined) resolve(); else reject(error) })
        server.closeAllConnections()
        for (const socket of sockets) socket.destroy()
      })
      sessions.clear()
    },
  }
}
