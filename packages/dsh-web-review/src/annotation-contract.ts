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
} as const

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
