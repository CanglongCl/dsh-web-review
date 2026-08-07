/**
 * Pure-function suite for the annotation send-injection surface (node half,
 * plan §2.3 / §6 step 1): the `/webview-annotations` body parsing, the
 * session → annotation XML store operations, the user-text concatenation,
 * the `agent/prompt-submit` rewrite decision, and the shared body reader.
 */
import { describe, expect, it } from 'vitest'
import type { IncomingMessage } from 'node:http'
import {
  MAX_ANNOTATION_BODY,
  concatUserText,
  getAnnotation,
  injectDecision,
  parseAnnotationBody,
  readRequestBody,
  setAnnotation,
  type TextBlockLike,
} from '../src/prompt-inject.ts'

const ANNOTATION = '<annotation hint="annotations">\n  <element text="button 提交"/>\n</annotation>'

/** One content block of a claimed user message. */
function text(value: string): TextBlockLike {
  return { type: 'text', text: value }
}

describe('parseAnnotationBody', () => {
  it('parses a valid { sessionId, xml } body', () => {
    expect(parseAnnotationBody(JSON.stringify({ sessionId: 'session-1', xml: ANNOTATION }))).toEqual({
      sessionId: 'session-1',
      xml: ANNOTATION,
    })
  })

  it('accepts an empty xml string (annotation cleared → pass through)', () => {
    expect(parseAnnotationBody(JSON.stringify({ sessionId: 'session-1', xml: '' }))).toEqual({
      sessionId: 'session-1',
      xml: '',
    })
  })

  it('rejects a missing or empty sessionId', () => {
    expect(parseAnnotationBody(JSON.stringify({ xml: ANNOTATION }))).toBeUndefined()
    expect(parseAnnotationBody(JSON.stringify({ sessionId: '', xml: ANNOTATION }))).toBeUndefined()
  })

  it('rejects a non-string sessionId or xml', () => {
    expect(parseAnnotationBody(JSON.stringify({ sessionId: 42, xml: ANNOTATION }))).toBeUndefined()
    expect(parseAnnotationBody(JSON.stringify({ sessionId: 's', xml: null }))).toBeUndefined()
    expect(parseAnnotationBody(JSON.stringify({ sessionId: 's', xml: 1 }))).toBeUndefined()
  })

  it('rejects malformed JSON and non-object payloads', () => {
    expect(parseAnnotationBody('not json')).toBeUndefined()
    expect(parseAnnotationBody('"string"')).toBeUndefined()
    expect(parseAnnotationBody('42')).toBeUndefined()
    expect(parseAnnotationBody('null')).toBeUndefined()
    expect(parseAnnotationBody('[]')).toBeUndefined()
  })
})

describe('annotation store (setAnnotation / getAnnotation)', () => {
  it('stores and reads one session', () => {
    const map = new Map<string, string>()
    setAnnotation(map, 'session-1', ANNOTATION)
    expect(getAnnotation(map, 'session-1')).toBe(ANNOTATION)
  })

  it('overwrites on repeat sync and keeps sessions independent', () => {
    const map = new Map<string, string>()
    setAnnotation(map, 'session-1', 'first')
    setAnnotation(map, 'session-1', 'second')
    setAnnotation(map, 'session-2', 'other')
    expect(getAnnotation(map, 'session-1')).toBe('second')
    expect(getAnnotation(map, 'session-2')).toBe('other')
  })

  it('returns undefined for a session that never synced', () => {
    expect(getAnnotation(new Map<string, string>(), 'session-1')).toBeUndefined()
  })
})

describe('concatUserText', () => {
  it('joins text blocks and trims', () => {
    expect(concatUserText([text('  hello '), text(' world  ')])).toBe('hello  world')
  })

  it('ignores non-text blocks', () => {
    const blocks: TextBlockLike[] = [
      { type: 'reasoning', text: 'hidden' },
      text('visible'),
      { type: 'tool-call', id: 'c1', name: 'tool', arguments: '{}' },
    ]
    expect(concatUserText(blocks)).toBe('visible')
  })

  it('yields an empty string for no text or blank text', () => {
    expect(concatUserText([])).toBe('')
    expect(concatUserText([text('   '), { type: 'reasoning', text: 'x' }])).toBe('')
  })
})

describe('injectDecision', () => {
  it('passes through (undefined) when the session has no annotation', () => {
    const map = new Map<string, string>()
    expect(injectDecision(map, 'session-1', { content: [text('hi')] })).toBeUndefined()
  })

  it('passes through (undefined) for an empty or blank annotation', () => {
    const map = new Map<string, string>()
    setAnnotation(map, 'session-1', '')
    setAnnotation(map, 'session-2', '   \n  ')
    expect(injectDecision(map, 'session-1', { content: [text('hi')] })).toBeUndefined()
    expect(injectDecision(map, 'session-2', { content: [text('hi')] })).toBeUndefined()
  })

  it('rewrites to allow with the annotation XML prefixed onto the user text', () => {
    const map = new Map<string, string>()
    setAnnotation(map, 'session-1', ANNOTATION)
    const decision = injectDecision(map, 'session-1', { content: [text('please fix it')] })
    expect(decision).toEqual({
      kind: 'allow',
      content: [{ type: 'text', text: `${ANNOTATION}\nplease fix it` }],
    })
  })

  it('joins multiple text blocks and trims before prefixing', () => {
    const map = new Map<string, string>()
    setAnnotation(map, 'session-1', ANNOTATION)
    const decision = injectDecision(map, 'session-1', {
      content: [text('  first '), { type: 'reasoning', text: 'ignored' }, text(' second  ')],
    })
    expect(decision).toEqual({
      kind: 'allow',
      content: [{ type: 'text', text: `${ANNOTATION}\nfirst  second` }],
    })
  })

  it('keys by session so other sessions stay untouched', () => {
    const map = new Map<string, string>()
    setAnnotation(map, 'session-1', ANNOTATION)
    expect(injectDecision(map, 'session-2', { content: [text('hi')] })).toBeUndefined()
  })
})

describe('readRequestBody', () => {
  /** A request-like async iterable yielding the given chunks. */
  function request(chunks: Array<string | Buffer>): IncomingMessage {
    return {
      [Symbol.asyncIterator]: async function* () {
        for (const chunk of chunks) yield chunk
      },
    } as unknown as IncomingMessage
  }

  it('reads and concatenates the body chunks', async () => {
    await expect(readRequestBody(request(['ab', Buffer.from('cd'), 'ef']), 1024)).resolves.toBe('abcdef')
  })

  it('returns undefined for an empty body', async () => {
    await expect(readRequestBody(request([]), 1024)).resolves.toBeUndefined()
  })

  it('rejects when the body exceeds the cap', async () => {
    await expect(readRequestBody(request(['x'.repeat(MAX_ANNOTATION_BODY + 1)]), MAX_ANNOTATION_BODY)).rejects.toThrow(
      `body exceeds ${MAX_ANNOTATION_BODY} bytes`,
    )
  })
})
