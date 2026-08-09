/**
 * ui-webview node half: the host-side `/webview-proxy` route that makes
 * iframe content same-origin so the browser half's picker can reach the DOM,
 * plus the `/webview-annotations` route that commits a separately logged,
 * plugin-sourced browser-comment context to one live agent.
 *
 * The node artifact remains self-contained: tsdown inlines the small DSH
 * message/session helpers used by the annotation route, so loading the built
 * external package does not require a local node_modules.
 *
 * The proxy route is a thin shell over the pure functions in rewrite.ts:
 * parse the path-encoded target, fetch it server-side (redirect-follow,
 * timeout, body cap, no cookies), strip CSP/XFO, rewrite HTML, pass
 * everything else through. POST forwards the body (rewritten form actions).
 * Annotation validation, stable formatting, dedupe and injection live in
 * annotation-context.ts; this route remains a transport shell.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from 'cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { MAX_ANNOTATION_BODY } from './annotation-contract.ts'
import {
  commitAnnotationSnapshot,
  forgetAgent,
  parseAnnotationBody,
  readRequestBody,
  type AnnotationCommitState,
} from './annotation-context.ts'
import {
  PROXY_PREFIX,
  decodeTarget,
  isHttpUrl,
  rewriteHtml,
} from './rewrite.ts'
export { PROXY_PREFIX } from './rewrite.ts'

/** Plugin identity for diagnostics and the client-modules scan. */
export const name = 'ui-webview'
/** Services required before the routes register. */
export const inject = ['httpServer', 'agents']

/** Server-side fetch timeout in ms. */
export const TIMEOUT_MS = 15_000
/** Response body cap in bytes (HTML rewrite buffer). */
export const MAX_BODY = 10 * 1024 * 1024
/** `/webview-annotations` exact route path (annotation state sync). */
export const ANNOTATIONS_PREFIX = '/webview-annotations'
/** Request headers forwarded to the target (deliberately no cookies). */
const FORWARD_HEADERS = ['accept', 'accept-language', 'content-type']
/** Response headers stripped on every proxied response. */
const STRIP_HEADERS = [
  'content-security-policy',
  'content-security-policy-report-only',
  'x-frame-options',
  'content-encoding',
  'content-length',
]
/** Route prefix with trailing slash — the path-encoded target follows it. */
const TARGET_PREFIX = `${PROXY_PREFIX}/`

/** Allowed methods: GET/HEAD browse, POST form submission. */
const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST'])

/**
 * Plugin body: register the proxy and model-visible annotation context route.
 * @param ctx - root context carrying the httpServer and live-agent services.
 */
export function apply(ctx: Context): void {
  const annotations: AnnotationCommitState = new Map()
  ctx.effect(
    () => ctx.httpServer.register({ kind: 'prefix', path: PROXY_PREFIX, handler: proxyHandler }),
    'ui-webview: /webview-proxy route',
  )
  ctx.effect(
    () => ctx.httpServer.register({
      kind: 'exact',
      path: ANNOTATIONS_PREFIX,
      handler: annotationsHandler(ctx, annotations),
    }),
    'ui-webview: /webview-annotations route',
  )
  ctx.on('agent/disposed', (agent: Agent) => { forgetAgent(annotations, agent) })
}

/**
 * Resolve the path-encoded target URL from the request pathname.
 * @param req - the incoming request.
 * @returns the absolute http(s) target URL, or undefined when malformed.
 */
function targetOf(req: IncomingMessage): string | undefined {
  let pathname: string
  try {
    pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
  } catch {
    return undefined
  }
  if (!pathname.startsWith(TARGET_PREFIX)) return undefined
  let target: string
  try {
    target = decodeTarget(pathname.slice(TARGET_PREFIX.length))
  } catch {
    return undefined
  }
  return isHttpUrl(target) ? new URL(target).href : undefined
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
  if (!ALLOWED_METHODS.has(req.method ?? 'GET')) {
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
  let body: string | undefined
  if (req.method === 'POST') {
    try {
      body = await readRequestBody(req, MAX_BODY)
    } catch (error) {
      res.writeHead(413)
      res.end(error instanceof Error ? error.message : 'body too large')
      return
    }
  }
  try {
    const rawMethod = req.method ?? 'GET'
    const upstream = await fetch(target, {
      method: rawMethod === 'HEAD' ? 'GET' : rawMethod,
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: forwardHeaders(req),
      ...(body !== undefined ? { body } : {}),
    })
    const headers = new Headers(upstream.headers)
    for (const name of STRIP_HEADERS) headers.delete(name)
    const contentType = headers.get('content-type') ?? ''
    const isHtml = contentType.startsWith('text/html')
    let payload: Buffer
    try {
      payload = Buffer.from(await upstream.arrayBuffer())
    } catch {
      res.writeHead(502)
      res.end('upstream read failed')
      return
    }
    if (payload.length > MAX_BODY) {
      res.writeHead(502)
      res.end('upstream body exceeds cap')
      return
    }
    res.writeHead(upstream.status, {
      ...Object.fromEntries(headers.entries()),
      ...(isHtml ? { 'content-type': 'text/html; charset=utf-8' } : {}),
    })
    if (req.method !== 'HEAD') {
      res.end(isHtml ? rewriteHtml(payload.toString('utf8'), target) : payload)
    } else {
      res.end()
    }
  } catch (error) {
    res.writeHead(502)
    res.end(error instanceof Error ? error.message : 'upstream fetch failed')
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
    let result: ReturnType<typeof commitAnnotationSnapshot>
    try {
      result = commitAnnotationSnapshot(ctx.agents, state, parsed)
    } catch (error) {
      ctx.logger.warn(`annotation injection failed for session "${parsed.sessionId}": ${String(error)}`)
      res.writeHead(409)
      res.end('agent unavailable')
      return
    }
    if (result === 'agent-not-found') {
      res.writeHead(404)
      res.end('session not found')
      return
    }
    if (result === 'context-too-large') {
      res.writeHead(413)
      res.end('annotation context too large')
      return
    }
    res.writeHead(204, { 'x-webview-annotation-result': result })
    res.end()
  }
}
