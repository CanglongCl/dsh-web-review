/** Pure validation + durable archival tests for the page snapshot store. */
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Agent, AgentRegistry } from '@deepseek-ai/dsh-agent'
import { Session, SessionId, type SessionId as SessionIdType } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MAX_SNAPSHOT_HTML,
  SNAPSHOT_HTML_TRUNCATION_MARKER,
  SNAPSHOT_LATEST,
  SNAPSHOT_MANIFEST,
  SNAPSHOT_RETENTION,
  type PageSnapshotPayload,
  type SnapshotArchiveState,
  type SnapshotLatestPointer,
  type SnapshotManifest,
} from '../src/snapshot-contract.ts'
import {
  forgetAgentSnapshots,
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

function harness(rawId = 'session-1'): {
  agent: Agent
  agents: Pick<AgentRegistry, 'get'>
} {
  const agent = {
    id: SessionId(rawId),
    session: Session.create(SessionId(rawId)),
  } as unknown as Agent
  const agents: Pick<AgentRegistry, 'get'> = {
    get: (id: SessionIdType) => id === agent.id ? agent : undefined,
  }
  return { agent, agents }
}

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

async function latestOf(baseDir: string): Promise<SnapshotLatestPointer> {
  return JSON.parse(await readFile(join(baseDir, SNAPSHOT_LATEST), 'utf8')) as SnapshotLatestPointer
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
  it('archives HTML, PNG and manifest, updates latest and the per-agent record', async () => {
    const baseDir = await tempBaseDir()
    const { agent, agents } = harness()
    const state: SnapshotArchiveState = new Map()
    const result = await storePageSnapshot(agents, payload(), baseDir, state)
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
    expect((await latestOf(baseDir)).dir).toBe(result.dir.split('/').pop())
    expect(state.get(agent.id)?.dir).toBe(result.dir)
  })

  it('records a screenshot error instead of writing an invalid PNG', async () => {
    const baseDir = await tempBaseDir()
    const { agents } = harness()
    const state: SnapshotArchiveState = new Map()
    const result = await storePageSnapshot(agents, payload({
      screenshot: { dataUrl: 'data:image/png;base64,AAAA', width: 1, height: 1, truncated: false },
    }), baseDir, state)
    expect(result.kind).toBe('saved')
    if (result.kind !== 'saved') return
    expect((await manifestOf(result.dir)).screenshot).toEqual({ error: 'invalid PNG payload' })
    await expect(readFile(join(result.dir, 'page.png'))).rejects.toThrow()
  })

  it('keeps the capture error when the frame supplied no screenshot', async () => {
    const baseDir = await tempBaseDir()
    const { agents } = harness()
    const result = await storePageSnapshot(agents, payload({
      screenshot: null,
      screenshotError: 'screenshot canvas tainted by cross-origin content',
    }), baseDir, new Map())
    expect(result.kind).toBe('saved')
    if (result.kind !== 'saved') return
    expect((await manifestOf(result.dir)).screenshot)
      .toEqual({ error: 'screenshot canvas tainted by cross-origin content' })
  })

  it('marks HTML truncation from the bridge marker', async () => {
    const baseDir = await tempBaseDir()
    const { agents } = harness()
    const html = 'a'.repeat(64) + '\n' + SNAPSHOT_HTML_TRUNCATION_MARKER + ' 128 bytes -->'
    const result = await storePageSnapshot(agents, payload({ html }), baseDir, new Map())
    expect(result.kind).toBe('saved')
    if (result.kind !== 'saved') return
    expect((await manifestOf(result.dir)).html.truncated).toBe(true)
  })

  it('refuses to archive for an unknown live agent without touching disk', async () => {
    const baseDir = await tempBaseDir()
    const { agents } = harness()
    const result = await storePageSnapshot(agents, payload({ sessionId: 'missing' }), baseDir, new Map())
    expect(result.kind).toBe('agent-not-found')
    expect(await readdir(baseDir)).toEqual([])
  })

  it('retains only the newest snapshot directories', async () => {
    const baseDir = await tempBaseDir()
    const { agents } = harness()
    for (let index = 0; index < SNAPSHOT_RETENTION + 3; index += 1) {
      const result = await storePageSnapshot(agents, payload(), baseDir, new Map())
      expect(result.kind).toBe('saved')
    }
    const entries = await readdir(baseDir, { withFileTypes: true })
    const directories = entries.filter(entry => entry.isDirectory())
    expect(directories).toHaveLength(SNAPSHOT_RETENTION)
    expect(entries.some(entry => entry.name === SNAPSHOT_LATEST)).toBe(true)
  })

  it('releases per-agent state when the agent leaves', async () => {
    const baseDir = await tempBaseDir()
    const { agent, agents } = harness()
    const state: SnapshotArchiveState = new Map()
    await storePageSnapshot(agents, payload(), baseDir, state)
    expect(state.get(agent.id)).toBeDefined()
    forgetAgentSnapshots(state, agent)
    expect(state.get(agent.id)).toBeUndefined()
  })
})
