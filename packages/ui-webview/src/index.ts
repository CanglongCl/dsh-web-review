/**
 * ui-webview node half: the host-side `/webview-proxy` route that makes
 * iframe content same-origin so the browser half's picker can reach the DOM,
 * plus the `/webview-annotations` state-sync route (session → annotation XML)
 * and the `agent/prompt-submit` waterfall listener that rewrites the user's
 * send to carry the annotation XML as a user-content prefix.
 *
 * Deliberately runtime-dependency-free (type-only imports only; fetch is a
 * Node builtin): the Loader imports this package from its own directory
 * outside the harness, which must not require a local node_modules. Any new
 * runtime dependency is a load-order regression — justify it (AGENTS.md).
 *
 * The proxy route is a thin shell over the pure functions in rewrite.ts:
 * parse the path-encoded target, fetch it server-side (redirect-follow,
 * timeout, body cap, no cookies), strip CSP/XFO, rewrite HTML, pass
 * everything else through. POST forwards the body (rewritten form actions).
 * The annotations route and the prompt-submit rewrite are thin shells over
 * the pure functions in prompt-inject.ts (plan §2.3, §6 step 1).
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from 'cordis'
import type { Agent, PromptDecision } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-host-webserver'
import {
  PROXY_PREFIX,
  decodeTarget,
  isHttpUrl,
  rewriteHtml,
} from './rewrite.ts'
import type { TextBlocks } from './prompt-inject.ts'
import {
  MAX_ANNOTATION_BODY,
  injectDecision,
  parseAnnotationBody,
  readRequestBody,
  setAnnotation,
} from './prompt-inject.ts'

export { PROXY_PREFIX } from './rewrite.ts'

/** Plugin identity for diagnostics and the client-modules scan. */
export const name = 'ui-webview'
/** Services required before the routes register. */
export const inject = ['httpServer']

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
 * Plugin body: register the proxy and annotations routes, plus the
 * `agent/prompt-submit` send-injection listener.
 * @param ctx - root context carrying the httpServer service.
 */
export function apply(ctx: Context): void {
  const annotations = new Map<string, string>()
  ctx.effect(
    () => ctx.httpServer.register({ kind: 'prefix', path: PROXY_PREFIX, handler: proxyHandler }),
    'ui-webview: /webview-proxy route',
  )
  ctx.effect(
    () => ctx.httpServer.register({ kind: 'exact', path: ANNOTATIONS_PREFIX, handler: annotationsHandler(annotations) }),
    'ui-webview: /webview-annotations route',
  )
  ctx.on('agent/prompt-submit', promptSubmitListener(annotations))
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
 * (`{ sessionId, xml }`) and store the session → annotation XML mapping.
 * Thin shell over the pure functions in prompt-inject.ts.
 * @param map - the session → annotation XML store (per plugin instance).
 * @returns the route handler owning this store.
 */
function annotationsHandler(
  map: Map<string, string>,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    if ((req.method ?? 'GET') !== 'POST') {
      res.writeHead(405, { allow: 'POST' })
      res.end()
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
    setAnnotation(map, parsed.sessionId, parsed.xml)
    res.writeHead(204)
    res.end()
  }
}

/**
 * `agent/prompt-submit` waterfall listener (plan §2.3): when the claiming
 * session has a non-blank annotation XML, return an `allow` whose content is
 * the annotation XML plus the user's own text; agent-loop rewrites the prompt
 * via `freezeMessage({ ...message, content })`, keeping the message
 * identity/source so the annotation lands as part of one ordinary user
 * message. No/blank annotation → `next()` passes through unchanged, zero
 * overhead.
 * @param map - the session → annotation XML store (per plugin instance).
 * @returns the waterfall listener owning this store.
 */
function promptSubmitListener(
  map: ReadonlyMap<string, string>,
): (agent: Agent, message: TextBlocks, _signal: AbortSignal, next: () => Promise<PromptDecision>) => Promise<PromptDecision> {
  return async (agent, message, _signal, next) => {
    const decision = injectDecision(map, agent.id, message)
    return decision === undefined ? next() : decision
  }
}
