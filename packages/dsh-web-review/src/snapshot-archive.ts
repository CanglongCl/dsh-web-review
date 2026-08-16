/**
 * Node-owned page snapshot validation and durable archival. Browser payloads
 * are untrusted page evidence; the node face alone decides what reaches disk.
 * Files land under the OS temp archive root, the manifest is written last as
 * the commit marker, and only the newest snapshots are retained.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Agent, AgentRegistry } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  MAX_SNAPSHOT_HTML,
  MAX_SNAPSHOT_PNG,
  PageSnapshotId,
  SNAPSHOT_HTML_TRUNCATION_MARKER,
  SNAPSHOT_LATEST,
  SNAPSHOT_LIMITS,
  SNAPSHOT_MANIFEST,
  SNAPSHOT_RETENTION,
  type PageSnapshotPayload,
  type PageSnapshotScreenshot,
  type SnapshotArchiveState,
  type SnapshotLatestPointer,
  type SnapshotManifest,
} from './snapshot-contract.ts'
import { isPreviewableUrl } from './proxy-url.ts'

export type SnapshotArchiveResult =
  | { kind: 'saved'; snapshotId: ReturnType<typeof PageSnapshotId>; dir: string }
  | { kind: 'agent-not-found' }
  | { kind: 'write-failed' }

type UnknownRecord = Record<string, unknown>

function recordOf(value: unknown): UnknownRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined
}

function exactKeys(
  record: UnknownRecord,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional])
  return required.every(key => Object.hasOwn(record, key))
    && Object.keys(record).every(key => allowed.has(key))
}

function boundedString(value: unknown, cap: number, allowEmpty = true): string | undefined {
  if (typeof value !== 'string' || value.length > cap) return undefined
  if (!allowEmpty && value.length === 0) return undefined
  return value
}

function boundedDimension(value: unknown, cap: number, minimum = 0): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= cap
    ? value as number
    : undefined
}

function parseScreenshot(value: unknown): PageSnapshotScreenshot | null | undefined {
  if (value === null) return null
  const record = recordOf(value)
  if (record === undefined) return undefined
  if (!exactKeys(record, ['dataUrl', 'width', 'height', 'truncated']) || typeof record.truncated !== 'boolean') {
    return undefined
  }
  const dataUrl = boundedString(record.dataUrl, SNAPSHOT_LIMITS.dataUrl, false)
  const width = boundedDimension(record.width, SNAPSHOT_LIMITS.dimension, 1)
  const height = boundedDimension(record.height, SNAPSHOT_LIMITS.dimension, 1)
  if (
    dataUrl === undefined || !dataUrl.startsWith('data:image/png;base64,')
    || width === undefined || height === undefined
  ) return undefined
  return { dataUrl, width, height, truncated: record.truncated }
}

/** Parse and strictly validate one structured page snapshot request. */
export function parseSnapshotBody(body: string): PageSnapshotPayload | undefined {
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    return undefined
  }
  const record = recordOf(value)
  const page = recordOf(record?.page)
  const viewport = recordOf(record?.viewport)
  const scroll = recordOf(record?.scroll)
  if (
    record === undefined || page === undefined || viewport === undefined || scroll === undefined
    || !exactKeys(record, ['sessionId', 'page', 'viewport', 'scroll', 'html', 'screenshot', 'screenshotError'])
    || !exactKeys(page, ['url', 'title']) || !exactKeys(viewport, ['width', 'height'])
    || !exactKeys(scroll, ['x', 'y'])
  ) return undefined
  const sessionId = boundedString(record.sessionId, SNAPSHOT_LIMITS.sessionId, false)
  const url = boundedString(page.url, SNAPSHOT_LIMITS.pageUrl, false)
  const title = boundedString(page.title, SNAPSHOT_LIMITS.pageTitle)
  const html = boundedString(record.html, MAX_SNAPSHOT_HTML, false)
  const width = boundedDimension(viewport.width, SNAPSHOT_LIMITS.dimension)
  const height = boundedDimension(viewport.height, SNAPSHOT_LIMITS.dimension)
  const x = boundedDimension(scroll.x, SNAPSHOT_LIMITS.scroll)
  const y = boundedDimension(scroll.y, SNAPSHOT_LIMITS.scroll)
  const screenshot = parseScreenshot(record.screenshot)
  const screenshotError = record.screenshotError === null
    ? null
    : boundedString(record.screenshotError, SNAPSHOT_LIMITS.screenshotError, false)
  if (
    sessionId === undefined || url === undefined || !isPreviewableUrl(url) || title === undefined
    || html === undefined || width === undefined || height === undefined
    || x === undefined || y === undefined || screenshot === undefined || screenshotError === undefined
    || (screenshot === null) === (screenshotError === null)
  ) return undefined
  return {
    sessionId,
    page: { url, title },
    viewport: { width, height },
    scroll: { x, y },
    html,
    screenshot,
    screenshotError,
  }
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Decode a bounded data URL into PNG bytes; undefined when not a valid PNG. */
function decodePng(dataUrl: string): Buffer | undefined {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) return undefined
  const bytes = Buffer.from(dataUrl.slice(comma + 1), 'base64')
  if (bytes.length === 0 || bytes.length > MAX_SNAPSHOT_PNG) return undefined
  return bytes.subarray(0, 8).equals(PNG_SIGNATURE) ? bytes : undefined
}

/** Directory name: local timestamp plus a random suffix (sortable, unique). */
function dirNameOf(now: number): string {
  const date = new Date(now)
  const pad = (value: number, length: number): string => String(value).padStart(length, '0')
  const stamp = String(date.getFullYear())
    + pad(date.getMonth() + 1, 2) + pad(date.getDate(), 2) + '-'
    + pad(date.getHours(), 2) + pad(date.getMinutes(), 2) + pad(date.getSeconds(), 2)
    + pad(date.getMilliseconds(), 3)
  return stamp + '-' + randomBytes(2).toString('hex')
}

/** Retain only the newest snapshot directories under the archive root. */
async function pruneSnapshots(baseDir: string): Promise<void> {
  const entries = await readdir(baseDir, { withFileTypes: true })
  const directories = entries
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
    .reverse()
  for (const name of directories.slice(SNAPSHOT_RETENTION)) {
    await rm(join(baseDir, name), { recursive: true, force: true })
  }
}

/**
 * Archive one validated snapshot under the temp root. The agent lookup runs
 * first so the route cannot act as a session-state oracle; the manifest is
 * written last as the commit marker, and any failure removes the residue.
 */
export async function storePageSnapshot(
  agents: Pick<AgentRegistry, 'get'>,
  body: PageSnapshotPayload,
  baseDir: string,
  state: SnapshotArchiveState,
): Promise<SnapshotArchiveResult> {
  const agent = agents.get(SessionId(body.sessionId))
  if (agent === undefined) return { kind: 'agent-not-found' }
  const snapshotId = PageSnapshotId(randomUUID())
  const capturedAt = Date.now()
  const dirName = dirNameOf(capturedAt)
  const dir = join(baseDir, dirName)
  try {
    await mkdir(baseDir, { recursive: true, mode: 0o700 })
    await mkdir(dir, { recursive: true, mode: 0o700 })
    await writeFile(join(dir, 'page.html'), body.html, 'utf8')
    let screenshotEntry: SnapshotManifest['screenshot']
    if (body.screenshot === null) {
      screenshotEntry = { error: body.screenshotError ?? 'screenshot unavailable' }
    } else {
      const png = decodePng(body.screenshot.dataUrl)
      if (png === undefined) {
        screenshotEntry = { error: 'invalid PNG payload' }
      } else {
        await writeFile(join(dir, 'page.png'), png)
        screenshotEntry = {
          file: 'page.png',
          width: body.screenshot.width,
          height: body.screenshot.height,
          truncated: body.screenshot.truncated,
        }
      }
    }
    const manifest: SnapshotManifest = {
      format: 'dsh-web-review-page-snapshot',
      version: 1,
      snapshotId,
      capturedAt: new Date(capturedAt).toISOString(),
      page: { url: body.page.url, title: body.page.title },
      viewport: body.viewport,
      scroll: body.scroll,
      html: {
        file: 'page.html',
        bytes: Buffer.byteLength(body.html, 'utf8'),
        truncated: body.html.includes(SNAPSHOT_HTML_TRUNCATION_MARKER),
      },
      screenshot: screenshotEntry,
    }
    await writeFile(join(dir, SNAPSHOT_MANIFEST), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
    const pointer: SnapshotLatestPointer = {
      dir: dirName,
      capturedAt: manifest.capturedAt,
      page: { url: body.page.url, title: body.page.title },
    }
    await writeFile(join(baseDir, SNAPSHOT_LATEST), JSON.stringify(pointer, null, 2) + '\n', 'utf8')
    await pruneSnapshots(baseDir)
    state.set(agent.id, { snapshotId, dir, capturedAt })
    return { kind: 'saved', snapshotId, dir }
  } catch (error) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    return { kind: 'write-failed' }
  }
}

/** Release per-agent snapshot state when the exact live agent leaves. */
export function forgetAgentSnapshots(state: SnapshotArchiveState, agent: Pick<Agent, 'id'>): void {
  state.delete(agent.id)
}
