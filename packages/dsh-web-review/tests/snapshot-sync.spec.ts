// @vitest-environment jsdom
/** Serialized snapshot upload queue: receipts, latch, failure propagation. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import {
  PAGE_SNAPSHOTS_PATH,
  type PageSnapshotDraft,
} from '../src/snapshot-contract.ts'
import { makeUploadSnapshot } from '../src/client/snapshot-sync.ts'

const sessionId = 'session-1' as unknown as SessionId

function draft(): PageSnapshotDraft {
  return {
    page: { url: 'http://localhost:5173/', title: 'Example Domain' },
    viewport: { width: 1280, height: 720 },
    scroll: { x: 0, y: 0 },
    html: '<!doctype html><html><body>Example</body></html>',
    screenshot: { dataUrl: 'data:image/png;base64,iVBORw0KGgo=', width: 1280, height: 720, truncated: false },
    screenshotError: null,
  }
}

function jsonResponse(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('makeUploadSnapshot', () => {
  it('posts the payload with the client header and decodes the saved receipt', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, {
      kind: 'saved', snapshotId: 'snap-1', dir: '/tmp/dsh-web-review/snapshots/20260816-1200000000-abcd',
    }))
    vi.stubGlobal('fetch', fetchMock)
    const upload = makeUploadSnapshot(sessionId)
    const receipt = await upload(draft())
    expect(receipt).toEqual({
      kind: 'saved', snapshotId: 'snap-1', dir: '/tmp/dsh-web-review/snapshots/20260816-1200000000-abcd',
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(path).toBe(PAGE_SNAPSHOTS_PATH)
    expect((init.headers as Record<string, string>)['x-dsh-web-review-client']).toBe('1')
    expect(init.body).toContain('session-1')
    expect(init.body).toContain('Example Domain')
  })

  it('latches off after a disabled receipt without further requests', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { kind: 'disabled' }))
    vi.stubGlobal('fetch', fetchMock)
    const upload = makeUploadSnapshot(sessionId)
    expect(await upload(draft())).toEqual({ kind: 'disabled' })
    expect(await upload(draft())).toEqual({ kind: 'disabled' })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('propagates HTTP failures and invalid receipts', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(500, { kind: 'saved' }))
    vi.stubGlobal('fetch', fetchMock)
    const upload = makeUploadSnapshot(sessionId)
    await expect(upload(draft())).rejects.toThrow('page snapshot archive failed (500)')
    fetchMock.mockResolvedValue(jsonResponse(200, { kind: 'nonsense' }))
    await expect(upload(draft())).rejects.toThrow('invalid receipt')
  })

  it('serializes queued uploads in change order', async () => {
    let resolveFirst!: (value: Response) => void
    const first = new Promise<Response>((resolve) => { resolveFirst = resolve })
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(async () => jsonResponse(200, {
        kind: 'saved', snapshotId: 'snap-2', dir: '/tmp/dsh-web-review/snapshots/20260816-1200000000-ef01',
      }))
    vi.stubGlobal('fetch', fetchMock)
    const upload = makeUploadSnapshot(sessionId)
    const second = upload({ ...draft(), scroll: { x: 0, y: 1 } })
    const third = upload({ ...draft(), scroll: { x: 0, y: 2 } })
    resolveFirst(jsonResponse(200, {
      kind: 'saved', snapshotId: 'snap-1', dir: '/tmp/dsh-web-review/snapshots/20260816-1200000000-abcd',
    }))
    await expect(second).resolves.toMatchObject({ kind: 'saved', snapshotId: 'snap-1' })
    await expect(third).resolves.toMatchObject({ kind: 'saved', snapshotId: 'snap-2' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
