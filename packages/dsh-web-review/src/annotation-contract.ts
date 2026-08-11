/**
 * Browser-to-host annotation snapshot contract.
 *
 * This file is safe to bundle into either face. The browser sends structured
 * evidence; only the node face is allowed to turn it into model-facing text.
 */

/** Maximum encoded request body accepted by `/webview-annotations`. */
export const MAX_ANNOTATION_BODY = 64 * 1024
/** Maximum annotations carried by one full snapshot. */
export const MAX_ANNOTATIONS = 20
/** Maximum style fields on one element annotation. */
export const MAX_ANNOTATION_CHANGES = 48
/** Maximum style fields across one full snapshot. */
export const MAX_TOTAL_ANNOTATION_CHANGES = 200
/** Maximum rendered model context. */
export const MAX_ANNOTATION_CONTEXT = 60 * 1024

export const ANNOTATION_LIMITS = {
  sessionId: 512,
  pageUrl: 4_096,
  pageTitle: 500,
  id: 128,
  comment: 4_000,
  tagName: 64,
  role: 100,
  label: 500,
  cssPath: 2_000,
  fullPath: 4_000,
  stableClass: 100,
  stableClasses: 20,
  anchorFile: 1_000,
  anchorComponent: 500,
  styleValue: 500,
  textValue: 2_000,
  viewportDimension: 100_000,
  snapshotId: 64,
} as const

declare const annotationSnapshotIdBrand: unique symbol

/** Opaque identity assigned by the node face to one acknowledged full snapshot. */
export type AnnotationSnapshotId = string & { readonly [annotationSnapshotIdBrand]: true }

/** Narrow a node-generated value to the cross-face snapshot identity. */
export function AnnotationSnapshotId(value: string): AnnotationSnapshotId {
  return value as AnnotationSnapshotId
}

/** Browser-visible acknowledgement returned only after node pending state is durable. */
export type AnnotationSyncReceipt =
  | { kind: 'ready'; snapshotId: AnnotationSnapshotId }
  | { kind: 'empty' }

/** Strictly decode the node acknowledgement at the browser trust boundary. */
export function annotationSyncReceiptOf(value: unknown): AnnotationSyncReceipt | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  if (record.kind === 'empty') return keys.length === 1 && keys[0] === 'kind' ? { kind: 'empty' } : undefined
  if (
    record.kind !== 'ready' || keys.length !== 2 || !keys.includes('kind') || !keys.includes('snapshotId')
    || typeof record.snapshotId !== 'string' || record.snapshotId.length < 1
    || record.snapshotId.length > ANNOTATION_LIMITS.snapshotId
  ) return undefined
  return { kind: 'ready', snapshotId: AnnotationSnapshotId(record.snapshotId) }
}

/** Read this plugin's durable snapshot identity from an opaque message source. */
export function annotationSnapshotIdOfSource(source: unknown): AnnotationSnapshotId | undefined {
  if (typeof source !== 'object' || source === null || Array.isArray(source)) return undefined
  const record = source as Record<string, unknown>
  const snapshotId = record.snapshotId
  if (
    record.kind !== 'plugin' || record.plugin !== 'dsh-web-review'
    || typeof snapshotId !== 'string' || snapshotId.length < 1
    || snapshotId.length > ANNOTATION_LIMITS.snapshotId
  ) return undefined
  return AnnotationSnapshotId(snapshotId)
}

export interface AnnotationStyleChange {
  property: import('./annotation-properties.ts').EditableStyleProperty
  before: string
  after: string
}

export interface AnnotationTextChange {
  before: string
  after: string
}

export interface AnnotationViewport {
  width: number
  height: number
}

/** Framework source evidence captured from development metadata. */
export interface AnnotationAnchor {
  framework: 'react' | 'vue' | 'svelte'
  component: string
  file: string
  line?: number
}

/** One browser target and the user's comment attached to it. */
export interface AnnotationComment {
  id: string
  comment: string
  tagName: string
  role: string
  label: string
  cssPath: string
  fullPath: string
  stableClasses: string[]
  anchor: AnnotationAnchor | null
  changes: AnnotationStyleChange[]
  textChange: AnnotationTextChange | null
  viewport: AnnotationViewport
}

/** Full current annotation state for one live conversation session. */
export interface AnnotationSnapshot {
  sessionId: string
  page: {
    url: string
    title: string
  }
  comments: AnnotationComment[]
}

/** Session-independent browser state accepted by the client sync face. */
export type AnnotationDraft = Omit<AnnotationSnapshot, 'sessionId'>
