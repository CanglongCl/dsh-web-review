/**
 * Webview store: the shared viewing/interaction state for the preview tab and
 * the annotation dock. Business data (sessions, the conversation) lives in the
 * object layer; this store carries the navigation draft, pick mode, the
 * annotation picks shared by both registrations, and the focus signal the dock
 * sends to the preview tab (detail-row click → locate the element in the iframe).
 */
import { defineStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { AnnotationSnapshotId } from '../annotation-contract.ts'
import type { PickItem } from './contract.ts'

export type AnnotationSyncState =
  | { status: 'idle' }
  | { status: 'syncing' }
  | { status: 'ready'; snapshotId: AnnotationSnapshotId }
  | { status: 'error'; message: string }

export interface WebviewState {
  /** Current loaded URL used by the iframe and annotation evidence. */
  url: string
  /** Editable address-bar draft; only Enter promotes it to `url`. */
  urlDraft: string
  /** Current loaded page title, captured after iframe load. */
  title: string
  /** Element picker active inside the iframe. */
  pickMode: boolean
  /** Annotation entries, each with its own comment. */
  picks: PickItem[]
  /** Monotonic explicit reset signal; also discards an uncommitted editor. */
  pickResetRevision: number
  /** Last user-visible error, cleared on the next gesture. */
  error: string | null
  /** One-shot focus signal: a dock detail row selected this pick id. */
  focusPickId: string | null
  /** Browser → host context commit state shown by the composer capsule. */
  annotationSync: AnnotationSyncState
}

/**
 * Store factory: state + the complete write set. Components write only
 * through the baked actions; production code never calls create() outside
 * apply (the framework owns instance lifecycle).
 */
export function createWebviewStore() {
  return defineStore({
    init: (): WebviewState => ({
      url: '',
      urlDraft: '',
      title: '',
      pickMode: false,
      picks: [],
      pickResetRevision: 0,
      error: null,
      focusPickId: null,
      annotationSync: { status: 'idle' },
    }),
    actions: {
      setUrl: (d, url: string) => {
        d.url = url
        d.urlDraft = url
      },
      setUrlDraft: (d, url: string) => { d.urlDraft = url },
      setTitle: (d, title: string) => { d.title = title },
      togglePickMode: (d) => { d.pickMode = !d.pickMode },
      // Commit keeps pick mode armed so the user can annotate the next
      // element without re-clicking the pick button (Esc exits).
      addPick: (d, pick: PickItem) => { d.picks = [...d.picks, pick] },
      updateComment: (d, id: string, comment: string) => {
        d.picks = d.picks.map((p) => (p.id === id ? { ...p, comment } : p))
      },
      updatePick: (d, id: string, pick: PickItem) => {
        d.picks = d.picks.map(current => current.id === id ? pick : current)
      },
      removePick: (d, id: string) => { d.picks = d.picks.filter((p) => p.id !== id) },
      clearPicks: (d) => {
        d.picks = []
        d.pickResetRevision += 1
      },
      setError: (d, error: string | null) => { d.error = error },
      setFocusPickId: (d, id: string | null) => { d.focusPickId = id },
      setAnnotationSync: (d, state: AnnotationSyncState) => { d.annotationSync = state },
    },
  })
}

export type WebviewStore = ReturnType<typeof createWebviewStore>
