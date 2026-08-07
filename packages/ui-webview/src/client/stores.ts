/**
 * Webview store: the shared viewing/interaction state for the preview tab and
 * the annotation dock. Business data (sessions, the conversation) lives in the
 * object layer; this store carries the navigation draft, pick mode, the
 * annotation picks shared by both registrations, and the focus signal the dock
 * sends to the preview tab (chip click → locate the element in the iframe).
 */
import { defineStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { PickItem } from './contract.ts'

export interface WebviewState {
  /** Current URL input (and loaded URL). */
  url: string
  /** Element picker active inside the iframe. */
  pickMode: boolean
  /** Annotation entries, each with its own comment. */
  picks: PickItem[]
  /** Last user-visible error, cleared on the next gesture. */
  error: string | null
  /** One-shot focus signal: a dock chip clicked this pick id; the preview tab locates it (no clamping). */
  focusPickId: string | null
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
      pickMode: false,
      picks: [],
      error: null,
      focusPickId: null,
    }),
    actions: {
      setUrl: (d, url: string) => { d.url = url },
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
    },
  })
}

export type WebviewStore = ReturnType<typeof createWebviewStore>
