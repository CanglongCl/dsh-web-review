/**
 * Store factory suite: the write set and state invariants.
 */
import { describe, expect, it } from 'vitest'
import { PANEL_WIDTH_DEFAULT, SPLIT_DEFAULT, createWebviewStore } from '../src/client/stores.ts'
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
      open: false, width: PANEL_WIDTH_DEFAULT, url: '',
      pickMode: false, picks: [], split: SPLIT_DEFAULT, sending: false, error: null,
    })
  })

  it('open with a URL sets it and clears stale picks; open without keeps them', () => {
    const store = createWebviewStore().create()
    store.actions.addPick(pick('a'))
    store.actions.open('http://new/')
    expect(store.getSnapshot().url).toBe('http://new/')
    expect(store.getSnapshot().picks).toEqual([])
    store.actions.addPick(pick('b'))
    store.actions.open()
    expect(store.getSnapshot().picks).toHaveLength(1)
  })

  it('clamps the panel width', () => {
    const store = createWebviewStore().create()
    store.actions.setWidth(10)
    expect(store.getSnapshot().width).toBe(320)
    store.actions.setWidth(5000)
    expect(store.getSnapshot().width).toBe(960)
  })

  it('clamps the preview/annotations split', () => {
    const store = createWebviewStore().create()
    store.actions.setSplit(0)
    expect(store.getSnapshot().split).toBe(0.25)
    store.actions.setSplit(1)
    expect(store.getSnapshot().split).toBe(0.75)
    store.actions.setSplit(0.5)
    expect(store.getSnapshot().split).toBe(0.5)
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
  })

  it('togglePickMode exits pick mode', () => {
    const store = createWebviewStore().create()
    store.actions.togglePickMode()
    expect(store.getSnapshot().pickMode).toBe(true)
    store.actions.togglePickMode()
    expect(store.getSnapshot().pickMode).toBe(false)
  })

  it('sending and error transitions', () => {
    const store = createWebviewStore().create()
    store.actions.setSending(true)
    store.actions.setError('boom')
    expect(store.getSnapshot()).toMatchObject({ sending: true, error: 'boom' })
  })
})
