/**
 * dsh-web-review node half: the host-side `/webview-proxy` route that makes
 * iframe content same-origin so the browser half's picker can reach the DOM,
 * plus the `/webview-annotations` route that prepares browser-comment state
 * for one live agent and the pre-step listener that appends it as a
 * separate plugin context without rewriting the user's message.
 *
 * The node artifact remains self-contained: tsdown inlines the small DSH
 * message/session helpers used by the annotation route, so loading the built
 * external package does not require a local node_modules.
 *
 * The proxy route is a thin shell over the pure functions in rewrite.ts:
 * parse the path-encoded local target, follow local redirects server-side
 * (timeout, streaming body cap, no cookies), sanitize headers, rewrite HTML, pass
 * everything else through. POST forwards the body (rewritten form actions).
 * Annotation validation, stable formatting, pending state and admission live in
 * annotation-context.ts; this route remains a transport shell.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from 'cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { MAX_ANNOTATION_BODY } from './annotation-contract.ts'
import {
  acknowledgeAnnotationEvent,
  attachPendingAnnotationContext,
  forgetAgent,
  parseAnnotationBody,
  readRequestBody,
  storeAnnotationSnapshot,
  type AnnotationCommitState,
} from './annotation-context.ts'
import {
  rewriteHtml,
} from './rewrite.ts'
import { PROXY_PREFIX, decodeTarget, isLocalPreviewUrl } from './proxy-url.ts'
import { PREVIEW_GUIDANCE } from './preview-guidance.ts'
import {
  BodyLimitError,
  decodeHtml,
  fetchLocalResponse,
  isHtmlContentType,
  readRequestBytes,
  readResponseBytes,
  sanitizedResponseHeaders,
} from './proxy-transport.ts'
export { PROXY_PREFIX } from './proxy-url.ts'
export { PREVIEW_GUIDANCE } from './preview-guidance.ts'

/** Plugin identity for diagnostics and the client-modules scan. */
export const name = 'dsh-web-review'
/** Services required before the routes register. */
export const inject = ['httpServer', 'agents', 'systemPrompt']

/** Server-side fetch timeout in ms. */
export const TIMEOUT_MS = 15_000
/** Response body cap in bytes (HTML rewrite buffer). */
export const MAX_BODY = 10 * 1024 * 1024
/** `/webview-annotations` exact route path (annotation state sync). */
export const ANNOTATIONS_PREFIX = '/webview-annotations'
/** Request headers forwarded to the target (deliberately no cookies). */
const FORWARD_HEADERS = ['accept', 'accept-language', 'content-type']
/** Route prefix with trailing slash — the path-encoded target follows it. */
const TARGET_PREFIX = `${PROXY_PREFIX}/`

/** Allowed methods: GET/HEAD browse, POST form submission. */
type ProxyMethod = 'GET' | 'HEAD' | 'POST'
const ALLOWED_METHODS = new Set<ProxyMethod>(['GET', 'HEAD', 'POST'])

function proxyMethod(value: string): ProxyMethod | undefined {
  return ALLOWED_METHODS.has(value as ProxyMethod) ? value as ProxyMethod : undefined
}

/**
 * Plugin body: register proxy/pending routes and send-time context admission.
 * @param ctx - root context carrying the httpServer and live-agent services.
 */
export function apply(ctx: Context): void {
  const annotations: AnnotationCommitState = new Map()
  ctx.systemPrompt.section({
    name: 'plugin:dsh-web-review-preview',
    order: -97,
    text: PREVIEW_GUIDANCE,
  })
  ctx.effect(
    () => ctx.httpServer.register({ kind: 'prefix', path: PROXY_PREFIX, handler: proxyHandler }),
    'dsh-web-review: /webview-proxy route',
  )
  ctx.effect(
    () => ctx.httpServer.register({
      kind: 'exact',
      path: ANNOTATIONS_PREFIX,
      handler: annotationsHandler(ctx, annotations),
    }),
    'dsh-web-review: /webview-annotations route',
  )
  ctx.on('agent/pre-step', ({ agent }, next) =>
    attachPendingAnnotationContext(annotations, agent, next))
  ctx.on('session/event', (session, event) => {
    acknowledgeAnnotationEvent(annotations, session.id, event)
  })
  ctx.on('agent/disposed', ({ agent }) => { forgetAgent(annotations, agent) })
}

/**
 * Resolve the path-encoded target URL from the request pathname.
 * @param req - the incoming request.
 * @returns the absolute http(s) target URL, or undefined when malformed.
 */
function targetOf(req: IncomingMessage): string | undefined {
  let requestUrl: URL
  try {
    requestUrl = new URL(req.url ?? '/', 'http://dsh.internal')
  } catch {
    return undefined
  }
  const { pathname } = requestUrl
  if (!pathname.startsWith(TARGET_PREFIX)) return undefined
  let target: string
  try {
    target = decodeTarget(pathname.slice(TARGET_PREFIX.length))
  } catch {
    return undefined
  }
  if (!isLocalPreviewUrl(target)) return undefined
  const resolved = new URL(target)
  // A query-only relative reference resolves against the injected proxy base
  // as an outer query; promote it back into the encoded target URL.
  if (requestUrl.search !== '') resolved.search = requestUrl.search
  return resolved.href
}

/** Forwarded request headers (existing values only). */
function forwardHeaders(req: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const name of FORWARD_HEADERS) {
    const value = req.headers[name]
    if (typeof value === 'string') headers[name] = value
  }
  return headers
}

/** Route handler: fetch the target and serve the rewritten/pass-through response. */
async function proxyHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = proxyMethod(req.method ?? 'GET')
  if (method === undefined) {
    res.writeHead(405, { allow: 'GET, HEAD, POST' })
    res.end()
    return
  }
  const target = targetOf(req)
  if (target === undefined) {
    res.writeHead(400)
    res.end('bad request')
    return
  }
  let body: Buffer | undefined
  if (method === 'POST') {
    try {
      body = await readRequestBytes(req, MAX_BODY)
    } catch (error) {
      res.writeHead(413)
      res.end(error instanceof Error ? error.message : 'body too large')
      return
    }
  }
  const clientAbort = new AbortController()
  const abortClient = (): void => { clientAbort.abort(new Error('proxy client disconnected')) }
  req.once('aborted', abortClient)
  res.once('close', abortClient)
  try {
    const upstream = await fetchLocalResponse(target, {
      method,
      signal: AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), clientAbort.signal]),
      headers: forwardHeaders(req),
      ...(body === undefined ? {} : { body: new Uint8Array(body) }),
    })
    const headers = sanitizedResponseHeaders(upstream.headers)
    const contentType = upstream.headers.get('content-type') ?? ''
    const isHtml = isHtmlContentType(contentType)
    if (method === 'HEAD') {
      res.writeHead(upstream.status, headers)
      res.end()
      return
    }
    const payload = await readResponseBytes(upstream, MAX_BODY)
    res.writeHead(upstream.status, {
      ...headers,
      ...(isHtml ? { 'content-type': 'text/html; charset=utf-8' } : {}),
    })
    res.end(isHtml ? rewriteHtml(decodeHtml(payload, contentType), upstream.url || target) : payload)
  } catch (error) {
    if (res.destroyed || res.writableEnded) return
    res.writeHead(502)
    res.end(error instanceof BodyLimitError ? error.message : 'upstream fetch failed')
  } finally {
    req.off('aborted', abortClient)
    res.off('close', abortClient)
  }
}

/**
 * Route handler for `/webview-annotations`: validate the POST body
 * structured snapshot and inject its node-owned rendering into the live agent.
 * @param ctx - context carrying the live-agent registry.
 * @param state - per-session dedupe state.
 * @returns the route handler owning this store.
 */
function annotationsHandler(
  ctx: Context,
  state: AnnotationCommitState,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    if ((req.method ?? 'GET') !== 'POST') {
      res.writeHead(405, { allow: 'POST' })
      res.end()
      return
    }
    if (!(req.headers['content-type'] ?? '').toString().toLowerCase().startsWith('application/json')) {
      res.writeHead(415)
      res.end('application/json required')
      return
    }
    let body: string | undefined
    try {
      body = await readRequestBody(req, MAX_ANNOTATION_BODY)
    } catch (error) {
      res.writeHead(413)
      res.end(error instanceof Error ? error.message : 'body too large')
      return
    }
    const parsed = body === undefined ? undefined : parseAnnotationBody(body)
    if (parsed === undefined) {
      res.writeHead(400)
      res.end('bad request')
      return
    }
    let result: ReturnType<typeof storeAnnotationSnapshot>
    try {
      result = storeAnnotationSnapshot(ctx.agents, state, parsed)
    } catch (error) {
      ctx.logger.warn(`annotation injection failed for session "${parsed.sessionId}": ${String(error)}`)
      res.writeHead(409)
      res.end('agent unavailable')
      return
    }
    if (result.kind === 'agent-not-found') {
      res.writeHead(404)
      res.end('session not found')
      return
    }
    if (result.kind === 'context-too-large') {
      res.writeHead(413)
      res.end('annotation context too large')
      return
    }
    const receipt = 'pending' in result
      ? { kind: 'ready' as const, snapshotId: result.pending.snapshotId }
      : { kind: 'empty' as const }
    res.writeHead(200, {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      'x-webview-annotation-result': result.kind,
    })
    res.end(JSON.stringify(receipt))
  }
}
