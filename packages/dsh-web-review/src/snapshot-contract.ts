/**
 * Browser-to-host page-snapshot contract.
 *
 * This file is safe to bundle into any face. The browser sends structured,
 * bounded page evidence; only the node face may turn it into durable files
 * and model-facing text. Page URL/title and snapshot contents are untrusted
 * page evidence, exactly like annotation metadata.
 */

/** Exact host route that receives archived page snapshots. */
export const PAGE_SNAPSHOTS_PATH = '/webview-snapshots'
/** Maximum encoded request body accepted by the snapshot route. */
export const MAX_SNAPSHOT_BODY = 8 * 1024 * 1024
/** Maximum serialized HTML tree accepted from the frame. */
export const MAX_SNAPSHOT_HTML = 4 * 1024 * 1024
/** Maximum decoded PNG screenshot bytes persisted per snapshot. */
export const MAX_SNAPSHOT_PNG = 2 * 1024 * 1024
/** Number of newest snapshot directories retained under the archive root. */
export const SNAPSHOT_RETENTION = 20
/** Name of the pointer file naming the newest snapshot directory. */
export const SNAPSHOT_LATEST = 'latest.json'
/** Manifest commit marker (written last; presence = complete archive). */
export const SNAPSHOT_MANIFEST = 'manifest.json'
/** Marker appended by the frame when the HTML tree exceeded the cap. */
export const SNAPSHOT_HTML_TRUNCATION_MARKER = '<!-- dsh-web-review: html truncated at'
/** Freshness window deciding exact-directory vs latest-pointer guide text. */
export const SNAPSHOT_FRESH_WINDOW_MS = 15_000

export const SNAPSHOT_LIMITS = {
  sessionId: 512,
  pageUrl: 4_096,
  pageTitle: 500,
  html: MAX_SNAPSHOT_HTML,
  dataUrl: 3 * 1024 * 1024,
  screenshotError: 500,
  dimension: 100_000,
  scroll: 1_000_000,
  snapshotId: 64,
} as const

declare const pageSnapshotIdBrand: unique symbol

/** Opaque identity assigned by the node face to one archived snapshot. */
export type PageSnapshotId = string & { readonly [pageSnapshotIdBrand]: true }

/** Narrow a node-generated value to the cross-face snapshot identity. */
export function PageSnapshotId(value: string): PageSnapshotId {
  return value as PageSnapshotId
}

/** One PNG screenshot captured inside the isolated frame. */
export interface PageSnapshotScreenshot {
  /** 'data:image/png;base64,...' */
  dataUrl: string
  width: number
  height: number
  /** True when the capture fell back to the viewport or was downscaled. */
  truncated: boolean
}

/** Browser-to-host wire shape for one archived page snapshot. */
export interface PageSnapshotPayload {
  sessionId: string
  page: {
    url: string
    title: string
  }
  viewport: { width: number; height: number }
  scroll: { x: number; y: number }
  html: string
  screenshot: PageSnapshotScreenshot | null
  /** Non-null exactly when the screenshot could not be captured. */
  screenshotError: string | null
}

/** Session-independent payload accepted by the client upload face. */
export type PageSnapshotDraft = Omit<PageSnapshotPayload, 'sessionId'>

/** Browser-visible acknowledgement returned only after durable archival. */
export type PageSnapshotReceipt =
  | { kind: 'saved'; snapshotId: PageSnapshotId; dir: string }
  | { kind: 'disabled' }

/** Strictly decode the node acknowledgement at the browser trust boundary. */
export function pageSnapshotReceiptOf(value: unknown): PageSnapshotReceipt | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  if (record.kind === 'disabled') {
    return keys.length === 1 && keys[0] === 'kind' ? { kind: 'disabled' } : undefined
  }
  if (
    record.kind !== 'saved' || keys.length !== 3 || !keys.includes('kind')
    || !keys.includes('snapshotId') || !keys.includes('dir')
    || typeof record.snapshotId !== 'string' || record.snapshotId.length < 1
    || record.snapshotId.length > SNAPSHOT_LIMITS.snapshotId
    || typeof record.dir !== 'string' || record.dir.length < 1 || record.dir.length > 4_096
  ) return undefined
  return { kind: 'saved', snapshotId: PageSnapshotId(record.snapshotId), dir: record.dir }
}

/** Durable manifest.json shape describing one archived snapshot. */
export interface SnapshotManifest {
  format: 'dsh-web-review-page-snapshot'
  version: 1
  snapshotId: string
  capturedAt: string
  page: { url: string; title: string }
  viewport: { width: number; height: number }
  scroll: { x: number; y: number }
  html: { file: string; bytes: number; truncated: boolean }
  screenshot:
    | { file: string; width: number; height: number; truncated: boolean }
    | { error: string }
}

/** Durable latest.json pointer shape naming the newest archived directory. */
export interface SnapshotLatestPointer {
  dir: string
  capturedAt: string
  page: { url: string; title: string }
}

/** Per-agent in-memory record of the newest durable snapshot. */
export interface SnapshotArchiveRecord {
  snapshotId: PageSnapshotId
  dir: string
  capturedAt: number
}

/** Per-agent map consumed by the annotation pre-step guide block. */
export type SnapshotArchiveState = Map<import('@deepseek-ai/dsh-session/types').SessionId, SnapshotArchiveRecord>
