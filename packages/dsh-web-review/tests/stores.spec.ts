/**
 * Store factory suite: the write set and state invariants.
 */
import { describe, expect, it } from 'vitest'
import { createWebviewStore } from '../src/client/stores.ts'
import type { PickItem } from '../src/client/contract.ts'

function pick(id: string): PickItem {
  return {
    id,
    snapshot: {
      tagName: 'div', id: '', className: '', cssPath: 'div', fullPath: 'html > body > div:nth-of-type(1)',
      label: '', role: '', stableClasses: [], anchor: null,
      outerHTML: '<div></div>', textContent: '',
      rect: { x: 0, y: 0, width: 0, height: 0 },
      computed: {
        display: '', position: '', fontSize: '', color: '', backgroundColor: '',
        margin: '', padding: '', width: '', height: '',
      },
    },
    comment: '',
  }
}

describe('createWebviewStore', () => {
  it('seeds the initial state', () => {
    const store = createWebviewStore().create()
    expect(store.getSnapshot()).toMatchObject({
      url: '', urlDraft: '', title: '', pickMode: false, picks: [], error: null, focusPickId: null,
      annotationSync: 'idle', annotationSyncError: null,
    })
  })

  it('setUrl updates the navigation draft', () => {
    const store = createWebviewStore().create()
    store.actions.setUrl('http://localhost:5173/')
    expect(store.getSnapshot()).toMatchObject({
      url: 'http://localhost:5173/', urlDraft: 'http://localhost:5173/',
    })
    store.actions.setUrlDraft('http://localhost:3000/')
    expect(store.getSnapshot()).toMatchObject({
      url: 'http://localhost:5173/', urlDraft: 'http://localhost:3000/',
    })
    store.actions.setTitle('Example')
    expect(store.getSnapshot().title).toBe('Example')
  })

  it('pick lifecycle: add, comment, remove, clear; mode toggles', () => {
    const store = createWebviewStore().create()
    store.actions.togglePickMode()
    expect(store.getSnapshot().pickMode).toBe(true)
    store.actions.addPick(pick('a'))
    // Committing keeps pick mode armed (the user annotates the next element).
    expect(store.getSnapshot().pickMode).toBe(true)
    store.actions.updateComment('a', 'comment')
    expect(store.getSnapshot().picks[0]?.comment).toBe('comment')
    store.actions.removePick('a')
    expect(store.getSnapshot().picks).toEqual([])
    store.actions.addPick(pick('b'))
    store.actions.clearPicks()
    expect(store.getSnapshot().picks).toEqual([])
  })

  it('togglePickMode exits pick mode', () => {
    const store = createWebviewStore().create()
    store.actions.togglePickMode()
    expect(store.getSnapshot().pickMode).toBe(true)
    store.actions.togglePickMode()
    expect(store.getSnapshot().pickMode).toBe(false)
  })

  it('focusPickId tracks the dock focus signal without clamping', () => {
    const store = createWebviewStore().create()
    expect(store.getSnapshot().focusPickId).toBeNull()
    store.actions.setFocusPickId('p1')
    expect(store.getSnapshot().focusPickId).toBe('p1')
    store.actions.setFocusPickId(null)
    expect(store.getSnapshot().focusPickId).toBeNull()
  })

  it('error transitions', () => {
    const store = createWebviewStore().create()
    store.actions.setError('boom')
    expect(store.getSnapshot().error).toBe('boom')
    store.actions.setError(null)
    expect(store.getSnapshot().error).toBeNull()
    store.actions.setAnnotationSync('error', 'sync failed')
    expect(store.getSnapshot()).toMatchObject({ annotationSync: 'error', annotationSyncError: 'sync failed' })
    store.actions.setAnnotationSync('synced')
    expect(store.getSnapshot()).toMatchObject({ annotationSync: 'synced', annotationSyncError: null })
  })
})
