/** Durable, presentation-only data for the Browser Comments Context row. */
import type {} from '@deepseek-ai/dsh-llm/message'
import {
  ANNOTATION_LIMITS,
  MAX_ANNOTATION_CHANGES,
  MAX_ANNOTATIONS,
  type AnnotationAnchor,
  type AnnotationSnapshot,
  AnnotationSnapshotId,
  type AnnotationSnapshotId as AnnotationSnapshotIdType,
  type AnnotationStyleChange,
  type AnnotationTextChange,
} from './annotation-contract.ts'
import { isEditableStyleProperty, isSafeAnnotationStyleValue } from './annotation-properties.ts'
import { isPreviewableUrl } from './proxy-url.ts'

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

/** Exact durable source shape selected by the specialized Context renderer. */
export interface BrowserCommentsContextSource {
  readonly kind: 'plugin'
  readonly plugin: 'dsh-web-review'
  readonly form: 'browser-comments'
  readonly snapshotId: AnnotationSnapshotIdType
  readonly presentation: BrowserCommentsPresentation
}

declare module '@deepseek-ai/dsh-llm/message' {
  interface ContextFormMap {
    /** A full ordered browser-annotation snapshot with plugin-owned presentation data. */
    'browser-comments': {
      readonly snapshotId: AnnotationSnapshotIdType
      readonly presentation: BrowserCommentsPresentation
    }
  }
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

function anchorOf(value: unknown): AnnotationAnchor | null | undefined {
  if (value === null) return null
  const record = exactRecord(value, ['framework', 'component', 'file'], ['line'])
  if (record === undefined) return undefined
  if (record.framework !== 'react' && record.framework !== 'vue' && record.framework !== 'svelte') return undefined
  const component = boundedString(record.component, ANNOTATION_LIMITS.anchorComponent)
  const file = boundedString(record.file, ANNOTATION_LIMITS.anchorFile, false)
  if (component === undefined || file === undefined) return undefined
  if (record.line !== undefined && (!Number.isSafeInteger(record.line) || (record.line as number) < 1)) return undefined
  return {
    framework: record.framework,
    component,
    file,
    ...(record.line === undefined ? {} : { line: record.line as number }),
  }
}

function changesOf(value: unknown): readonly AnnotationStyleChange[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_ANNOTATION_CHANGES) return undefined
  const changes: AnnotationStyleChange[] = []
  const properties = new Set<string>()
  for (const item of value) {
    const record = exactRecord(item, ['property', 'before', 'after'])
    if (record === undefined) return undefined
    const property = boundedString(record.property, 64, false)
    const before = boundedString(record.before, ANNOTATION_LIMITS.styleValue)
    const after = boundedString(record.after, ANNOTATION_LIMITS.styleValue)
    if (
      property === undefined || !isEditableStyleProperty(property) || properties.has(property)
      || before === undefined || after === undefined || before === after
      || !isSafeAnnotationStyleValue(before) || !isSafeAnnotationStyleValue(after)
    ) return undefined
    properties.add(property)
    changes.push({ property, before, after })
  }
  return changes
}

function textChangeOf(value: unknown): AnnotationTextChange | null | undefined {
  if (value === null) return null
  const record = exactRecord(value, ['before', 'after'])
  if (record === undefined) return undefined
  const before = boundedString(record.before, ANNOTATION_LIMITS.textValue)
  const after = boundedString(record.after, ANNOTATION_LIMITS.textValue)
  return before === undefined || after === undefined || before === after ? undefined : { before, after }
}

function presentationCommentOf(value: unknown): BrowserCommentsPresentationComment | undefined {
  const record = exactRecord(value, [
    'id', 'comment', 'tagName', 'role', 'label', 'textContent', 'anchor', 'changes', 'textChange',
  ])
  if (record === undefined) return undefined
  const id = boundedString(record.id, ANNOTATION_LIMITS.id, false)
  const comment = boundedString(record.comment, ANNOTATION_LIMITS.comment)
  const tagName = boundedString(record.tagName, ANNOTATION_LIMITS.tagName, false)
  const role = boundedString(record.role, ANNOTATION_LIMITS.role)
  const label = boundedString(record.label, ANNOTATION_LIMITS.label)
  const textContent = boundedString(record.textContent, ANNOTATION_LIMITS.textContent)
  const anchor = anchorOf(record.anchor)
  const changes = changesOf(record.changes)
  const textChange = textChangeOf(record.textChange)
  if (
    id === undefined || comment === undefined || tagName === undefined || role === undefined
    || label === undefined || textContent === undefined || anchor === undefined
    || changes === undefined || textChange === undefined
  ) return undefined
  if (comment.trim() === '' && changes.length === 0 && textChange === null) return undefined
  return { id, comment, tagName, role, label, textContent, anchor, changes, textChange }
}

/** Strict selector decoder; malformed or foreign Context sources decline to the generic renderer. */
export function browserCommentsContextSourceOf(value: unknown): BrowserCommentsContextSource | undefined {
  const source = exactRecord(value, ['kind', 'plugin', 'form', 'snapshotId', 'presentation'])
  if (
    source === undefined || source.kind !== 'plugin' || source.plugin !== 'dsh-web-review'
    || source.form !== 'browser-comments'
  ) return undefined
  const snapshotId = boundedString(source.snapshotId, ANNOTATION_LIMITS.snapshotId, false)
  const presentation = exactRecord(source.presentation, ['page', 'comments'])
  const page = exactRecord(presentation?.page, ['url', 'title'])
  if (snapshotId === undefined || presentation === undefined || page === undefined || !Array.isArray(presentation.comments)) {
    return undefined
  }
  const url = boundedString(page.url, ANNOTATION_LIMITS.pageUrl, false)
  const title = boundedString(page.title, ANNOTATION_LIMITS.pageTitle)
  if (url === undefined || title === undefined || !isPreviewableUrl(url)
    || presentation.comments.length < 1 || presentation.comments.length > MAX_ANNOTATIONS) return undefined
  const comments: BrowserCommentsPresentationComment[] = []
  const ids = new Set<string>()
  for (const value of presentation.comments) {
    const comment = presentationCommentOf(value)
    if (comment === undefined || ids.has(comment.id)) return undefined
    ids.add(comment.id)
    comments.push(comment)
  }
  return {
    kind: 'plugin',
    plugin: 'dsh-web-review',
    form: 'browser-comments',
    snapshotId: AnnotationSnapshotId(snapshotId),
    presentation: { page: { url, title }, comments },
  }
}
