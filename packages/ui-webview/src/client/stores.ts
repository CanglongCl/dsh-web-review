/**
 * Webview store: the shared viewing/interaction state for the preview tab and
 * the annotation dock. Business data (sessions, the conversation) lives in the
 * object layer; this store carries the navigation draft, pick mode, the
 * annotation picks shared by both registrations, and the focus signal the dock
 * sends to the preview tab (detail-row click → locate the element in the iframe).
 */
import { defineStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { PickItem } from './contract.ts'

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
  /** Last user-visible error, cleared on the next gesture. */
  error: string | null
  /** One-shot focus signal: a dock detail row selected this pick id. */
  focusPickId: string | null
  /** Browser → host context commit state shown by the composer capsule. */
  annotationSync: 'idle' | 'syncing' | 'synced' | 'error'
  /** Last annotation commit failure, separate from preview/navigation errors. */
  annotationSyncError: string | null
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
      error: null,
      focusPickId: null,
      annotationSync: 'idle',
      annotationSyncError: null,
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
      removePick: (d, id: string) => { d.picks = d.picks.filter((p) => p.id !== id) },
      clearPicks: (d) => { d.picks = [] },
      setError: (d, error: string | null) => { d.error = error },
      setFocusPickId: (d, id: string | null) => { d.focusPickId = id },
      setAnnotationSync: (
        d,
        status: WebviewState['annotationSync'],
        error: string | null = null,
      ) => {
        d.annotationSync = status
        d.annotationSyncError = error
      },
    },
  })
}

export type WebviewStore = ReturnType<typeof createWebviewStore>
