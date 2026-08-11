/** Bounded byte transport and response-header policy for the preview proxy. */
import type { IncomingMessage } from 'node:http'
import { isLocalPreviewUrl } from './proxy-url.ts'

export class BodyLimitError extends Error {}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

export interface LocalFetchOptions {
  method: 'GET' | 'HEAD' | 'POST'
  headers: Record<string, string>
  body?: Uint8Array<ArrayBuffer>
  signal: AbortSignal
  maxRedirects?: number
}

/** Follow only local redirects, preserving Fetch's POST redirect semantics. */
export async function fetchLocalResponse(target: string, options: LocalFetchOptions): Promise<Response> {
  const maxRedirects = options.maxRedirects ?? 10
  let current = target
  let method: LocalFetchOptions['method'] = options.method
  let body = options.body
  let headers = new Headers(options.headers)
  for (let redirects = 0; ; redirects += 1) {
    if (!isLocalPreviewUrl(current)) throw new Error('remote preview target rejected')
    const response = await fetch(current, {
      method,
      redirect: 'manual',
      signal: options.signal,
      headers,
      ...(body === undefined ? {} : { body }),
    })
    const location = response.headers.get('location')
    if (!REDIRECT_STATUSES.has(response.status) || location === null) return response
    if (redirects >= maxRedirects) {
      await response.body?.cancel('too many redirects')
      throw new Error('too many redirects')
    }
    const next = new URL(location, current).href
    if (!isLocalPreviewUrl(next)) {
      await response.body?.cancel('remote redirect rejected')
      throw new Error('remote redirect rejected')
    }
    await response.body?.cancel('following redirect')
    if (
      ((response.status === 301 || response.status === 302) && method === 'POST')
      || (response.status === 303 && method !== 'HEAD')
    ) {
      method = 'GET'
      body = undefined
      headers = new Headers(headers)
      headers.delete('content-type')
    }
    current = next
  }
}

/** Read an inbound request as bytes without corrupting multipart/binary forms. */
export async function readRequestBytes(req: IncomingMessage, maxBytes: number): Promise<Buffer | undefined> {
  const declared = Number(req.headers['content-length'])
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyLimitError(`body exceeds ${maxBytes} bytes`)
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > maxBytes) throw new BodyLimitError(`body exceeds ${maxBytes} bytes`)
    chunks.push(buffer)
  }
  return chunks.length === 0 ? undefined : Buffer.concat(chunks, total)
}

/** Read and cancel an upstream Web stream as soon as the response cap is crossed. */
export async function readResponseBytes(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel('response body exceeds cap')
    throw new BodyLimitError(`upstream body exceeds ${maxBytes} bytes`)
  }
  if (response.body === null) return Buffer.alloc(0)
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      const chunk = Buffer.from(result.value)
      total += chunk.length
      if (total > maxBytes) {
        await reader.cancel('response body exceeds cap')
        throw new BodyLimitError(`upstream body exceeds ${maxBytes} bytes`)
      }
      chunks.push(chunk)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, total)
}

const STRIPPED_RESPONSE_HEADERS = new Set([
  'alt-svc',
  'clear-site-data',
  'connection',
  'content-disposition',
  'content-encoding',
  'content-length',
  'content-security-policy',
  'content-security-policy-report-only',
  'cross-origin-embedder-policy',
  'cross-origin-opener-policy',
  'cross-origin-resource-policy',
  'keep-alive',
  'nel',
  'origin-agent-cluster',
  'permissions-policy',
  'proxy-authenticate',
  'proxy-authorization',
  'refresh',
  'reporting-endpoints',
  'set-cookie',
  'set-cookie2',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'x-frame-options',
])

/** Remove headers that can mutate or isolate the DSH host origin. */
export function sanitizedResponseHeaders(source: Headers): Record<string, string> {
  const output: Record<string, string> = {}
  source.forEach((value, rawName) => {
    const name = rawName.toLowerCase()
    if (!STRIPPED_RESPONSE_HEADERS.has(name)) output[name] = value
  })
  return output
}

export function isHtmlContentType(contentType: string): boolean {
  return contentType.split(';', 1)[0]?.trim().toLowerCase() === 'text/html'
}

/** Decode an HTML payload according to its declared charset, falling back to UTF-8. */
export function decodeHtml(payload: Buffer, contentType: string): string {
  const charset = /(?:^|;)\s*charset\s*=\s*["']?([^;"'\s]+)/i.exec(contentType)?.[1] ?? 'utf-8'
  try {
    return new TextDecoder(charset).decode(payload)
  } catch {
    return new TextDecoder('utf-8').decode(payload)
  }
}
