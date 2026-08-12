/**
 * dsh-web-review node half: a small same-origin control endpoint plus an
 * independent loopback preview server. Every page session receives a random
 * `*.localhost` Origin, so arbitrary page scripts never share the DSH host
 * Origin. The frame and host communicate only through the versioned bridge.
 */
import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-skill'
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
import { PREVIEW_GUIDANCE } from './preview-guidance.ts'
import {
  PREVIEW_CLIENT_HEADER,
  PREVIEW_CLIENT_HEADER_VALUE,
  PREVIEW_SESSIONS_PATH,
  type PreviewSessionId,
} from './preview-contract.ts'
import { startIsolatedPreviewServer, type IsolatedPreviewServer } from './preview-server.ts'
import {
  readRequestBytes,
} from './proxy-transport.ts'
import { isPreviewableUrl } from './proxy-url.ts'
import { registerUiSkillProvider, type Config as PluginConfig } from './skill-provider.ts'
export { Config } from './skill-provider.ts'
export { PREVIEW_SESSIONS_PATH } from './preview-contract.ts'
export { PREVIEW_GUIDANCE } from './preview-guidance.ts'

/** Plugin identity for diagnostics and the client-modules scan. */
export const name = 'dsh-web-review'
/** Services required before the routes register. */
export const inject = ['httpServer', 'agents', 'systemPrompt', 'skills']

/** `/webview-annotations` exact route path (annotation state sync). */
export const ANNOTATIONS_PREFIX = '/webview-annotations'
const MAX_PREVIEW_CONTROL_BODY = 16 * 1024

/**
 * Plugin body: register proxy/pending routes and send-time context admission.
 * @param ctx - root context carrying the httpServer and live-agent services.
 */
export async function apply(ctx: Context, config: PluginConfig): Promise<void> {
  const annotations: AnnotationCommitState = new Map()
  registerUiSkillProvider(ctx, config)
  let previewServer: IsolatedPreviewServer | undefined
  await ctx.effect(async () => {
    const bridgeSource = await readBridgeSource()
    previewServer = await startIsolatedPreviewServer(bridgeSource)
    ctx.logger.info(`isolated preview server listening on 127.0.0.1:${String(previewServer.port)}`)
    return async () => { await previewServer?.close() }
  }, 'dsh-web-review: isolated preview server')
  if (previewServer === undefined) throw new Error('dsh-web-review: preview server failed to start')
  ctx.systemPrompt.section({
    name: 'plugin:dsh-web-review-preview',
    order: -97,
    text: PREVIEW_GUIDANCE,
  })
  const livePreviewServer = previewServer
  ctx.effect(() => ctx.httpServer.register({
    kind: 'exact',
    path: PREVIEW_SESSIONS_PATH,
    handler: previewSessionsHandler(livePreviewServer),
  }), 'dsh-web-review: preview-session control route')
  ctx.effect(
    () => ctx.httpServer.register({
      kind: 'exact',
      path: ANNOTATIONS_PREFIX,
      handler: annotationsHandler(ctx, annotations),
    }),
    'dsh-web-review: /webview-annotations route',
  )
  ctx.on('agent/pre-step', ({ agent, messages, signal }, next) =>
    attachPendingAnnotationContext(annotations, agent, ctx.skills, signal, messages, next))
  ctx.on('session/event', (session, event) => {
    acknowledgeAnnotationEvent(annotations, session.id, event)
  })
  ctx.on('agent/disposed', ({ agent }) => { forgetAgent(annotations, agent) })
}

async function readBridgeSource(): Promise<string> {
  const candidates = [
    new URL('./bridge.js', import.meta.url),
    new URL('../lib/bridge.js', import.meta.url),
  ]
  let failure: unknown
  for (const candidate of candidates) {
    try {
      return await readFile(candidate, 'utf8')
    } catch (error) {
      failure = error
    }
  }
  throw new Error('dsh-web-review: lib/bridge.js is missing; run the package build', { cause: failure })
}

function requestOrigin(req: IncomingMessage): string | undefined {
  const value = req.headers.origin
  const host = req.headers.host
  if (typeof value !== 'string' || typeof host !== 'string') return undefined
  try {
    const url = new URL(value)
    const requestHost = new URL(`http://${host}`).host
    return url.origin === value && url.host === requestHost
      && (url.protocol === 'http:' || url.protocol === 'https:')
      ? value
      : undefined
  } catch {
    return undefined
  }
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  return Object.keys(record).length === keys.length && keys.every(key => Object.hasOwn(record, key))
    ? record
    : undefined
}

async function jsonBody(req: IncomingMessage): Promise<unknown> {
  const bytes = await readRequestBytes(req, MAX_PREVIEW_CONTROL_BODY)
  if (bytes === undefined) return undefined
  try {
    return JSON.parse(bytes.toString('utf8')) as unknown
  } catch {
    return undefined
  }
}

function previewSessionsHandler(
  server: IsolatedPreviewServer,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    if (req.headers[PREVIEW_CLIENT_HEADER] !== PREVIEW_CLIENT_HEADER_VALUE
      || !(req.headers['content-type'] ?? '').toString().toLowerCase().startsWith('application/json')) {
      res.writeHead(415, { 'cache-control': 'no-store' })
      res.end('preview client JSON required')
      return
    }
    const origin = requestOrigin(req)
    if (origin === undefined) {
      res.writeHead(403, { 'cache-control': 'no-store' })
      res.end('same-origin browser request required')
      return
    }
    let value: unknown
    try {
      value = await jsonBody(req)
    } catch (error) {
      res.writeHead(413, { 'cache-control': 'no-store' })
      res.end(error instanceof Error ? error.message : 'request too large')
      return
    }
    if (req.method === 'POST') {
      const record = exactRecord(value, ['target'])
      if (record === undefined || typeof record.target !== 'string' || record.target.length > 4_096
        || !isPreviewableUrl(record.target)) {
        res.writeHead(400, { 'cache-control': 'no-store' })
        res.end('invalid preview target')
        return
      }
      try {
        const descriptor = server.createSession(record.target, origin)
        res.writeHead(201, {
          'cache-control': 'no-store',
          'content-type': 'application/json; charset=utf-8',
        })
        res.end(JSON.stringify(descriptor))
      } catch {
        res.writeHead(503, { 'cache-control': 'no-store' })
        res.end('preview session unavailable')
      }
      return
    }
    if (req.method === 'DELETE') {
      const record = exactRecord(value, ['sessionIds'])
      if (record === undefined || !Array.isArray(record.sessionIds) || record.sessionIds.length > 64
        || record.sessionIds.some(id => typeof id !== 'string' || !/^[a-f\d]{32}$/u.test(id))) {
        res.writeHead(400, { 'cache-control': 'no-store' })
        res.end('invalid preview session ids')
        return
      }
      server.releaseSessions(record.sessionIds as PreviewSessionId[])
      res.writeHead(204, { 'cache-control': 'no-store' })
      res.end()
      return
    }
    res.writeHead(405, { allow: 'POST, DELETE', 'cache-control': 'no-store' })
    res.end()
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
