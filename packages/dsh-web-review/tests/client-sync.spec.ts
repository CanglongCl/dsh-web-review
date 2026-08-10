/** Client transport ordering and acknowledgement tests (no timer/coalescing). */
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AnnotationDraft } from '../src/annotation-contract.ts'
import { makeSyncAnnotations } from '../src/client/index.ts'

function draft(comment: string): AnnotationDraft {
  return {
    page: { url: 'https://example.com/', title: 'Example Domain' },
    comments: [{
      id: 'p1', comment, tagName: 'h1', role: 'heading', label: 'Example Domain',
      cssPath: 'h1', fullPath: 'html > body > h1', stableClasses: [], anchor: null,
    }],
  }
}

function deferredResponse(): { promise: Promise<Response>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<Response>((done) => {
    resolve = () => { done(new Response(null, { status: 204 })) }
  })
  return { promise, resolve }
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('makeSyncAnnotations', () => {
  it('serializes changes, includes the bound session and waits for each response', async () => {
    const first = deferredResponse()
    const second = deferredResponse()
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    vi.stubGlobal('fetch', fetchMock)
    const sync = makeSyncAnnotations('session-1' as SessionId)
    const a = sync(draft('first'))
    const b = sync(draft('second'))
    await vi.waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(1) })
    first.resolve()
    await a
    await vi.waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(2) })
    second.resolve()
    await b
    const request = fetchMock.mock.calls[1]?.[1] as RequestInit
    expect(JSON.parse(String(request.body))).toMatchObject({
      sessionId: 'session-1',
      comments: [{ comment: 'second' }],
    })
  })

  it('deduplicates queued and acknowledged snapshots', async () => {
    const pending = deferredResponse()
    const fetchMock = vi.fn(() => pending.promise)
    vi.stubGlobal('fetch', fetchMock)
    const sync = makeSyncAnnotations('session-1' as SessionId)
    const first = sync(draft('same'))
    const duplicate = sync(draft('same'))
    expect(duplicate).toBe(first)
    pending.resolve()
    await first
    await sync(draft('same'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('preserves a reverted A → B → A sequence instead of deduplicating the final A early', async () => {
    const responses = [deferredResponse(), deferredResponse(), deferredResponse()]
    const fetchMock = vi.fn()
    for (const response of responses) fetchMock.mockImplementationOnce(() => response.promise)
    vi.stubGlobal('fetch', fetchMock)
    const sync = makeSyncAnnotations('session-1' as SessionId)
    const first = sync(draft('A'))
    const second = sync(draft('B'))
    const reverted = sync(draft('A'))
    responses[0]!.resolve()
    await first
    await vi.waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(2) })
    responses[1]!.resolve()
    await second
    await vi.waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(3) })
    responses[2]!.resolve()
    await reverted
    const bodies = fetchMock.mock.calls.map(call => JSON.parse(String((call[1] as RequestInit).body)) as {
      comments: Array<{ comment: string }>
    })
    expect(bodies.map(body => body.comments[0]?.comment)).toEqual(['A', 'B', 'A'])
  })

  it('rejects non-2xx responses and allows an explicit retry', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const sync = makeSyncAnnotations('session-1' as SessionId)
    await expect(sync(draft('retry'))).rejects.toThrow('annotation context sync failed (404)')
    await expect(sync(draft('retry'))).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
