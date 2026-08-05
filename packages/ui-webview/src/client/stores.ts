/**
 * Webview store: the panel's shared viewing/interaction state. Business data
 * (sessions, the conversation) lives in the object layer; this store carries
 * panel geometry, navigation drafts, and the annotation picks per session.
 */
import { defineStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { PickItem, WebviewMode } from './contract.ts'

export interface WebviewState {
  /** Panel visibility (floating overlay on the right edge). */
  open: boolean
  /** Panel width in px (drag-resized). */
  width: number
  /** Current URL input (and loaded URL for direct mode). */
  url: string
  /** Iframe loading mode: proxy (same-origin, picker) or direct (cross-origin). */
  mode: WebviewMode
  /** Element picker active inside the iframe. */
  pickMode: boolean
  /** Annotation entries, each with its own comment draft. */
  picks: PickItem[]
  /** Vertical split (0..1): preview iframe share of the body height. */
  split: number
  /** A send is in flight. */
  sending: boolean
  /** Last user-visible error (navigation or send), cleared on next gesture. */
  error: string | null
}

/** Width clamp range for the floating panel. */
export const PANEL_WIDTH_MIN = 320
export const PANEL_WIDTH_MAX = 960
export const PANEL_WIDTH_DEFAULT = 440

/** Preview/annotations split clamp range (share of the body height). */
export const SPLIT_MIN = 0.25
export const SPLIT_MAX = 0.75
export const SPLIT_DEFAULT = 0.55

/**
 * Store factory: state + the complete write set. Components write only
 * through the baked actions; production code never calls create() outside
 * apply (the framework owns instance lifecycle).
 */
export function createWebviewStore() {
  return defineStore({
    init: (): WebviewState => ({
      open: false,
      width: PANEL_WIDTH_DEFAULT,
      url: '',
      mode: 'proxy',
      pickMode: false,
      picks: [],
      split: SPLIT_DEFAULT,
      sending: false,
      error: null,
    }),
    actions: {
      open: (d, url?: string) => {
        d.open = true
        if (url !== undefined && url !== '') {
          d.url = url
          // A new page invalidates the previous annotation picks.
          d.picks = []
          d.pickMode = false
        }
      },
      close: (d) => { d.open = false; d.pickMode = false },
      setUrl: (d, url: string) => { d.url = url },
      setMode: (d, mode: WebviewMode) => { d.mode = mode; d.pickMode = false },
      setWidth: (d, width: number) => {
        d.width = Math.min(PANEL_WIDTH_MAX, Math.max(PANEL_WIDTH_MIN, Math.round(width)))
      },
      setSplit: (d, split: number) => {
        d.split = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, split))
      },
      togglePickMode: (d) => { d.pickMode = !d.pickMode },
      addPick: (d, pick: PickItem) => { d.picks = [...d.picks, pick]; d.pickMode = false },
      updateComment: (d, id: string, comment: string) => {
        d.picks = d.picks.map((p) => (p.id === id ? { ...p, comment } : p))
      },
      removePick: (d, id: string) => { d.picks = d.picks.filter((p) => p.id !== id) },
      clearPicks: (d) => { d.picks = [] },
      setSending: (d, sending: boolean) => { d.sending = sending },
      setError: (d, error: string | null) => { d.error = error },
    },
  })
}

export type WebviewStore = ReturnType<typeof createWebviewStore>
