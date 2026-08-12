import type { IncomingMessage } from 'node:http'
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import {
  BodyLimitError,
  decodeHtml,
  isHtmlContentType,
  readRequestBytes,
  readResponseBytes,
  sanitizedResponseHeaders,
} from '../src/proxy-transport.ts'

function request(chunks: Array<Buffer | string>, headers: IncomingMessage['headers'] = {}): IncomingMessage {
  const stream = Readable.from(chunks) as unknown as IncomingMessage
  Object.defineProperty(stream, 'headers', { value: headers })
  return stream
}

describe('proxy byte transport', () => {
  it('preserves arbitrary request bytes', async () => {
    const bytes = Buffer.from([0, 255, 128, 13, 10])
    await expect(readRequestBytes(request([bytes]), 32)).resolves.toEqual(bytes)
  })

  it('rejects request bodies from both declared and observed size', async () => {
    await expect(readRequestBytes(request([], { 'content-length': '9' }), 8))
      .rejects.toBeInstanceOf(BodyLimitError)
    await expect(readRequestBytes(request([Buffer.alloc(5), Buffer.alloc(5)]), 8))
      .rejects.toBeInstanceOf(BodyLimitError)
  })

  it('cancels a streaming upstream body immediately after crossing the cap', async () => {
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from([1, 2, 3, 4]))
        controller.enqueue(Uint8Array.from([5, 6, 7, 8]))
      },
      cancel() { cancelled = true },
    })
    await expect(readResponseBytes(new Response(stream), 6)).rejects.toBeInstanceOf(BodyLimitError)
    expect(cancelled).toBe(true)
  })

  it('preflights a declared upstream size and cancels without reading', async () => {
    let cancelled = false
    const response = new Response(new ReadableStream<Uint8Array>({
      cancel() { cancelled = true },
    }), { headers: { 'content-length': '100' } })
    await expect(readResponseBytes(response, 10)).rejects.toBeInstanceOf(BodyLimitError)
    expect(cancelled).toBe(true)
  })
})

describe('proxy response policy', () => {
  it('strips host-mutating, framing and hop-by-hop headers', () => {
    const headers = sanitizedResponseHeaders(new Headers({
      'cache-control': 'max-age=30',
      'clear-site-data': '"cookies"',
      connection: 'close',
      'content-security-policy': "default-src 'none'",
      'content-type': 'text/html',
      refresh: '0; url=https://example.com/',
      'set-cookie': 'secret=yes',
      'x-frame-options': 'deny',
    }))
    expect(headers).toEqual({
      'cache-control': 'max-age=30',
      'content-type': 'text/html',
    })
  })

  it('recognizes HTML case-insensitively without treating XHTML as HTML', () => {
    expect(isHtmlContentType('TEXT/HTML; Charset=UTF-8')).toBe(true)
    expect(isHtmlContentType('application/xhtml+xml')).toBe(false)
  })

  it('decodes HTML with the declared charset and falls back for unknown labels', () => {
    expect(decodeHtml(Buffer.from([0xe9]), 'text/html; charset=iso-8859-1')).toBe('é')
    expect(decodeHtml(Buffer.from('hello'), 'text/html; charset=not-real')).toBe('hello')
  })
})
