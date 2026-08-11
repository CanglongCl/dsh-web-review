// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  discardEditorTransaction,
  rollbackEditorTransaction,
} from '../src/client/editor-transaction.ts'
import { applyCommitted, createLivePatch, previewStyle, previewText } from '../src/client/live-patch.ts'

describe('editor DOM transactions', () => {
  it('rolls a preview back to the committed pick baseline', () => {
    document.body.innerHTML = '<h1 style="font-size: 16px">Original</h1>'
    const element = document.querySelector('h1') as HTMLElement
    const patch = createLivePatch(element)
    const changes = [{ property: 'font-size' as const, before: '16px', after: '20px' }]
    const textChange = { before: 'Original', after: 'Committed' }
    applyCommitted(patch, changes, textChange)
    previewStyle(patch, 'font-size', '30px')
    previewText(patch, 'Preview')

    rollbackEditorTransaction({ current: patch, committed: { patch, changes, textChange } })
    expect(element.style.fontSize).toBe('20px')
    expect(element.textContent).toBe('Committed')
  })

  it('discards the committed original and a re-anchored temporary preview together', () => {
    document.body.innerHTML = '<h1 style="font-size: 16px">Original</h1><p style="font-size: 12px">Other</p>'
    const original = document.querySelector('h1') as HTMLElement
    const target = document.querySelector('p') as HTMLElement
    const committed = createLivePatch(original)
    const changes = [{ property: 'font-size' as const, before: '16px', after: '20px' }]
    applyCommitted(committed, changes, null)
    const current = createLivePatch(target)
    previewStyle(current, 'font-size', '30px')

    discardEditorTransaction({ current, committed: { patch: committed, changes, textChange: null } })
    expect(original.style.fontSize).toBe('16px')
    expect(target.style.fontSize).toBe('12px')
  })
})
