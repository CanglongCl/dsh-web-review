/** Durable Browser Comments context data plus the harness `snapshot`-form source shape. */
import type { ContextSnapshotSection } from '@deepseek-ai/dsh-llm/message'
import {
  ANNOTATION_LIMITS,
  MAX_ANNOTATION_CONTEXT,
  MAX_ANNOTATIONS,
  type AnnotationAnchor,
  type AnnotationSnapshot,
  AnnotationSnapshotId,
  type AnnotationSnapshotId as AnnotationSnapshotIdType,
  type AnnotationStyleChange,
  type AnnotationTextChange,
} from './annotation-contract.ts'

/** Compact evidence needed by the native Browser Comments presentation. */
export interface BrowserCommentsPresentation {
  readonly page: {
    readonly url: string
    readonly title: string
  }
  readonly comments: readonly BrowserCommentsPresentationComment[]
}

/** One ordered annotation, without implementation-only selector and viewport data. */
export interface BrowserCommentsPresentationComment {
  readonly id: string
  readonly comment: string
  readonly tagName: string
  readonly role: string
  readonly label: string
  readonly textContent: string
  readonly anchor: AnnotationAnchor | null
  readonly changes: readonly AnnotationStyleChange[]
  readonly textChange: AnnotationTextChange | null
}

/**
 * Durable source shape presented by the harness's standard `snapshot`
 * context form: the expanded row body renders one named section per
 * contribution, in the exact order the model read them.
 */
export interface BrowserCommentsContextSource {
  readonly kind: 'plugin'
  readonly plugin: 'dsh-web-review'
  readonly form: 'snapshot'
  readonly snapshotId: AnnotationSnapshotIdType
  readonly sections: readonly ContextSnapshotSection[]
}

/** Select the user-relevant presentation fields from one validated browser snapshot. */
export function browserCommentsPresentationOf(snapshot: AnnotationSnapshot): BrowserCommentsPresentation {
  return {
    page: { ...snapshot.page },
    comments: snapshot.comments.map(comment => ({
      id: comment.id,
      comment: comment.comment,
      tagName: comment.tagName,
      role: comment.role,
      label: comment.label,
      textContent: comment.textContent,
      anchor: comment.anchor === null ? null : { ...comment.anchor },
      changes: comment.changes.map(change => ({ ...change })),
      textChange: comment.textChange === null ? null : { ...comment.textChange },
    })),
  }
}

type UnknownRecord = Record<string, unknown>

function recordOf(value: unknown): UnknownRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined
}

function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): UnknownRecord | undefined {
  const record = recordOf(value)
  if (record === undefined) return undefined
  const allowed = new Set([...required, ...optional])
  return required.every(key => Object.hasOwn(record, key))
    && Object.keys(record).every(key => allowed.has(key)) ? record : undefined
}

function boundedString(value: unknown, cap: number, allowEmpty = true): string | undefined {
  if (typeof value !== 'string' || value.length > cap || (!allowEmpty && value.length === 0)) return undefined
  return value
}

export function browserCommentsContextSourceOf(value: unknown): BrowserCommentsContextSource | undefined {
  const source = exactRecord(value, ['kind', 'plugin', 'form', 'snapshotId', 'sections'])
  if (
    source === undefined || source.kind !== 'plugin' || source.plugin !== 'dsh-web-review'
    || source.form !== 'snapshot'
  ) return undefined
  const snapshotId = boundedString(source.snapshotId, ANNOTATION_LIMITS.snapshotId, false)
  if (snapshotId === undefined || !Array.isArray(source.sections) || source.sections.length < 1
    || source.sections.length > MAX_ANNOTATIONS + 1) return undefined
  const sections: ContextSnapshotSection[] = []
  for (const item of source.sections) {
    const record = exactRecord(item, ['name', 'text'])
    const name = record === undefined ? undefined : boundedString(record.name, 256, false)
    const text = record === undefined ? undefined : boundedString(record.text, MAX_ANNOTATION_CONTEXT)
    if (name === undefined || text === undefined) return undefined
    sections.push({ name, text })
  }
  return {
    kind: 'plugin',
    plugin: 'dsh-web-review',
    form: 'snapshot',
    snapshotId: AnnotationSnapshotId(snapshotId),
    sections,
  }
}


