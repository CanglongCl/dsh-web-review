// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  applyCommitted,
  createLivePatch,
  editableTextNode,
  previewStyle,
  previewText,
  restoreAll,
  restoreStyle,
} from '../src/client/live-patch.ts'

describe('live annotation patches', () => {
  it('restores exact inline values and priorities after temporary preview writes', () => {
    document.body.innerHTML = '<h1 style="color: red !important; width: 20px">Hello</h1>'
    const element = document.querySelector('h1') as HTMLElement
    const patch = createLivePatch(element)
    previewStyle(patch, 'color', '#613838')
    previewStyle(patch, 'width', '120px')
    expect(element.style.getPropertyValue('color')).toBe('rgb(97, 56, 56)')
    expect(element.style.getPropertyPriority('color')).toBe('important')
    restoreStyle(patch, 'color')
    expect(element.style.getPropertyValue('color')).toBe('red')
    expect(element.style.getPropertyPriority('color')).toBe('important')
    restoreAll(patch)
    expect(element.style.getPropertyValue('width')).toBe('20px')
  })

  it('edits only one safe direct text node and restores it exactly', () => {
    document.body.innerHTML = '<h1>Hello</h1><button><span>Nested</span></button>'
    const heading = document.querySelector('h1') as HTMLElement
    const nested = document.querySelector('button') as HTMLElement
    expect(editableTextNode(heading)?.data).toBe('Hello')
    expect(editableTextNode(nested)).toBeNull()
    const patch = createLivePatch(heading)
    expect(previewText(patch, 'New heading')).toBe(true)
    expect(heading.textContent).toBe('New heading')
    restoreAll(patch)
    expect(heading.textContent).toBe('Hello')
  })

  it('replays committed changes on a freshly re-anchored element', () => {
    document.body.innerHTML = '<p>Original</p>'
    const element = document.querySelector('p') as HTMLElement
    const patch = createLivePatch(element)
    applyCommitted(
      patch,
      [{ property: 'font-size', before: '16px', after: '24px' }],
      { before: 'Original', after: 'Preview' },
    )
    expect(element.style.getPropertyValue('font-size')).toBe('24px')
    expect(element.textContent).toBe('Preview')
    restoreAll(patch)
    expect(element.style.getPropertyValue('font-size')).toBe('')
    expect(element.textContent).toBe('Original')
  })
})
