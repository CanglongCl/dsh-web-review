/** Client transport ordering and acknowledgement tests (no timer/coalescing). */
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AnnotationDraft } from '../src/annotation-contract.ts'
import { makeSyncAnnotations } from '../src/client/index.ts'

function draft(comment: string): AnnotationDraft {
  return {
    page: { url: 'http://localhost:5173/', title: 'Example Domain' },
    selectedSkills: [],
    comments: [{
      id: 'p1', comment, tagName: 'h1', role: 'heading', label: 'Example Domain',
      cssPath: 'h1', fullPath: 'html > body > h1', stableClasses: [], textContent: 'Example Domain',
      inToolChrome: false, anchor: null,
      changes: [], textChange: null, viewport: { width: 1280, height: 720 },
    }],
  }
}

function emptyDraft(): AnnotationDraft {
  return { page: { url: '', title: '' }, selectedSkills: [], comments: [] }
}

function response(snapshotId: string): Response {
  return Response.json({ kind: 'ready', snapshotId })
}

function deferredResponse(snapshotId: string): { promise: Promise<Response>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<Response>((done) => {
    resolve = () => { done(response(snapshotId)) }
  })
  return { promise, resolve }
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('makeSyncAnnotations', () => {
  it('serializes changes, includes the bound session and waits for each response', async () => {
    const first = deferredResponse('snapshot-1')
    const second = deferredResponse('snapshot-2')
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
    const pending = deferredResponse('snapshot-same')
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
    const responses = [deferredResponse('snapshot-a1'), deferredResponse('snapshot-b'), deferredResponse('snapshot-a2')]
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
      .mockResolvedValueOnce(response('snapshot-retry'))
    vi.stubGlobal('fetch', fetchMock)
    const sync = makeSyncAnnotations('session-1' as SessionId)
    await expect(sync(draft('retry'))).rejects.toThrow('annotation context sync failed (404)')
    await expect(sync(draft('retry'))).resolves.toMatchObject({ kind: 'ready', snapshotId: 'snapshot-retry' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('treats clearing an absent live agent as already satisfied', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)
    const sync = makeSyncAnnotations('historical-session' as SessionId)
    await expect(sync(emptyDraft())).resolves.toEqual({ kind: 'empty' })
    await expect(sync(emptyDraft())).resolves.toEqual({ kind: 'empty' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    null,
    { kind: 'ready', snapshotId: '' },
    { kind: 'ready', snapshotId: 'ok', extra: true },
    { kind: 'empty', snapshotId: 'unexpected' },
  ])('rejects malformed acknowledgement %j', async (receipt) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(receipt)))
    const sync = makeSyncAnnotations('session-1' as SessionId)
    await expect(sync(draft('invalid receipt'))).rejects.toThrow('invalid receipt')
  })
})
