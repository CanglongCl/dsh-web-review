/** Snapshot-arm staging helpers: frozen naming and the production manifest. */
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { frozenStem } from '../../../eval/tasks/frozen.ts'
import { frozenPagePath, snapshotManifestOf } from '../../../eval/snapshot-stage.ts'
import type { EvalRound } from '../../../eval/types.ts'

function round(): EvalRound {
  return {
    prompt: '请根据页面批注修改前端实现。',
    capture: [],
    snapshot: {
      sessionId: 'session-eval',
      selectedSkills: [],
      page: { url: 'http://127.0.0.1:5173/', title: 'Untrusted title' },
      comments: [],
    },
    captureMeta: undefined,
  }
}

/** Minimal 24-byte PNG header with a 640x320 IHDR. */
function png(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0)
  buffer.writeUInt32BE(width, 16)
  buffer.writeUInt32BE(height, 20)
  return buffer
}

describe('eval snapshot staging', () => {
  it('names frozen artifacts with the shared round stem', () => {
    expect(frozenStem('react-todo-01', 1)).toBe('react-todo-01')
    expect(frozenStem('react-todo-01', 2)).toBe('react-todo-01.round-2')
    expect(frozenPagePath('react-todo-01', 1, 'page.html')).toContain(
      join('eval', 'tasks', 'frozen', 'react-todo-01.page.html'),
    )
  })

  it('builds the production-shape manifest with real page evidence and PNG dimensions', () => {
    const manifest = JSON.parse(snapshotManifestOf(round(), 1234, png(640, 320), 'snap-1', '2026-08-16T12:00:00.000Z')) as {
      format: string
      page: { url: string; title: string }
      viewport: { width: number; height: number }
      html: { file: string; bytes: number; truncated: boolean }
      screenshot: { file: string; width: number; height: number; truncated: boolean }
    }
    expect(manifest.format).toBe('dsh-web-review-page-snapshot')
    expect(manifest.page).toEqual({ url: 'http://127.0.0.1:5173/', title: 'Untrusted title' })
    expect(manifest.viewport).toEqual({ width: 1680, height: 1000 })
    expect(manifest.html).toEqual({ file: 'page.html', bytes: 1234, truncated: false })
    expect(manifest.screenshot).toEqual({ file: 'page.png', width: 640, height: 320, truncated: false })
  })

  it('rejects buffers without the PNG signature', () => {
    expect(() => snapshotManifestOf(round(), 10, Buffer.alloc(24), 'snap-2', 'now')).toThrow('not a valid PNG')
  })
})
