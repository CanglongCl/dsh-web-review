/** Pure validation + durable archival tests for the page snapshot store. */
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MAX_SNAPSHOT_HTML,
  SNAPSHOT_HTML_TRUNCATION_MARKER,
  SNAPSHOT_MANIFEST,
  SNAPSHOT_RETENTION,
  type PageSnapshotPayload,
  type SnapshotManifest,
} from '../src/snapshot-contract.ts'
import {
  formatSnapshotGuide,
  parseSnapshotBody,
  storePageSnapshot,
} from '../src/snapshot-archive.ts'

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgo='

const tempRoots: string[] = []

async function tempBaseDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-web-review-snapshots-'))
  tempRoots.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

function payload(overrides: Partial<PageSnapshotPayload> = {}): PageSnapshotPayload {
  return {
    sessionId: 'session-1',
    page: { url: 'http://localhost:5173/', title: 'Example Domain' },
    viewport: { width: 1280, height: 720 },
    scroll: { x: 0, y: 120 },
    html: '<!doctype html><html><body><h1>Example</h1></body></html>',
    screenshot: { dataUrl: PNG_DATA_URL, width: 1280, height: 720, truncated: false },
    screenshotError: null,
    ...overrides,
  }
}

async function manifestOf(dir: string): Promise<SnapshotManifest> {
  return JSON.parse(await readFile(join(dir, SNAPSHOT_MANIFEST), 'utf8')) as SnapshotManifest
}

describe('parseSnapshotBody', () => {
  it('accepts a valid payload and preserves every field', () => {
    const parsed = parseSnapshotBody(JSON.stringify(payload()))
    expect(parsed).toEqual(payload())
  })

  it('rejects oversized HTML beyond the wire cap', () => {
    const oversized = payload({ html: 'a'.repeat(MAX_SNAPSHOT_HTML + 1) })
    expect(parseSnapshotBody(JSON.stringify(oversized))).toBeUndefined()
  })

  it('rejects non-PNG data URLs and mutually exclusive screenshot fields', () => {
    expect(parseSnapshotBody(JSON.stringify(payload({
      screenshot: { dataUrl: 'data:image/jpeg;base64,AA==', width: 1, height: 1, truncated: false },
    })))).toBeUndefined()
    expect(parseSnapshotBody(JSON.stringify(payload({
      screenshot: null,
      screenshotError: null,
    })))).toBeUndefined()
    expect(parseSnapshotBody(JSON.stringify(payload({
      screenshotError: 'tainted',
    })))).toBeUndefined()
  })

  it('rejects non-previewable pages, missing keys and malformed JSON', () => {
    expect(parseSnapshotBody(JSON.stringify(payload({
      page: { url: 'ftp://example.com/', title: 'x' },
    })))).toBeUndefined()
    const missing = payload() as unknown as Record<string, unknown>
    delete missing.scroll
    expect(parseSnapshotBody(JSON.stringify(missing))).toBeUndefined()
    expect(parseSnapshotBody('{nope')).toBeUndefined()
    expect(parseSnapshotBody('')).toBeUndefined()
  })
})

describe('storePageSnapshot', () => {
  it('archives HTML, PNG and manifest for the resolved agent', async () => {
    const baseDir = await tempBaseDir()
    const result = await storePageSnapshot(payload(), baseDir)
    expect(result.kind).toBe('saved')
    if (result.kind !== 'saved') return
    const manifest = await manifestOf(result.dir)
    expect(manifest.format).toBe('dsh-web-review-page-snapshot')
    expect(manifest.page).toEqual({ url: 'http://localhost:5173/', title: 'Example Domain' })
    expect(manifest.viewport).toEqual({ width: 1280, height: 720 })
    expect(manifest.scroll).toEqual({ x: 0, y: 120 })
    expect(manifest.html).toEqual({
      file: 'page.html', bytes: Buffer.byteLength(payload().html, 'utf8'), truncated: false,
    })
    expect(manifest.screenshot).toEqual({
      file: 'page.png', width: 1280, height: 720, truncated: false,
    })
    expect(await readFile(join(result.dir, 'page.html'), 'utf8')).toBe(payload().html)
    expect((await stat(result.dir)).mode & 0o777).toBe(0o700)
    expect(result.dir.startsWith(baseDir)).toBe(true)
  })

  it('records a screenshot error instead of writing an invalid PNG', async () => {
    const baseDir = await tempBaseDir()
    const result = await storePageSnapshot(payload({
      screenshot: { dataUrl: 'data:image/png;base64,AAAA', width: 1, height: 1, truncated: false },
    }), baseDir)
    expect(result.kind).toBe('saved')
    if (result.kind !== 'saved') return
    expect((await manifestOf(result.dir)).screenshot).toEqual({ error: 'invalid PNG payload' })
    await expect(readFile(join(result.dir, 'page.png'))).rejects.toThrow()
  })

  it('keeps the capture error when the frame supplied no screenshot', async () => {
    const baseDir = await tempBaseDir()
    const result = await storePageSnapshot(payload({
      screenshot: null,
      screenshotError: 'screenshot canvas tainted by cross-origin content',
    }), baseDir)
    expect(result.kind).toBe('saved')
    if (result.kind !== 'saved') return
    expect((await manifestOf(result.dir)).screenshot)
      .toEqual({ error: 'screenshot canvas tainted by cross-origin content' })
  })

  it('marks HTML truncation from the bridge marker', async () => {
    const baseDir = await tempBaseDir()
    const html = 'a'.repeat(64) + '\n' + SNAPSHOT_HTML_TRUNCATION_MARKER + ' 128 bytes -->'
    const result = await storePageSnapshot(payload({ html }), baseDir)
    expect(result.kind).toBe('saved')
    if (result.kind !== 'saved') return
    expect((await manifestOf(result.dir)).html.truncated).toBe(true)
  })

  it('retains only the newest snapshot directories', async () => {
    const baseDir = await tempBaseDir()
    for (let index = 0; index < SNAPSHOT_RETENTION + 3; index += 1) {
      const result = await storePageSnapshot(payload(), baseDir)
      expect(result.kind).toBe('saved')
    }
    const entries = await readdir(baseDir, { withFileTypes: true })
    expect(entries.filter(entry => entry.isDirectory())).toHaveLength(SNAPSHOT_RETENTION)
  })
})

describe('formatSnapshotGuide', () => {
  it('names the exact directory and the direct file paths', () => {
    const dir = '/tmp/dsh-web-review/snapshots/20260816-1200000000-abcd'
    const guide = formatSnapshotGuide(dir)
    expect(guide).toContain('## Page snapshot')
    expect(guide).toContain('Snapshot directory: ' + dir)
    expect(guide).toContain('- HTML tree: ' + dir + '/page.html')
    expect(guide).toContain('- Screenshot: ' + dir + '/page.png')
    expect(guide).toContain('- Metadata: ' + dir + '/manifest.json')
    expect(guide).not.toContain('latest.json')
  })
})
