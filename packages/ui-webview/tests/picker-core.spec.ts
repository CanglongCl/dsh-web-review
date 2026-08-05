// @vitest-environment jsdom
/**
 * Picker-core suite: cssPath generation (delegated to css-selector-generator
 * — assertions pin its shortest-unique behavior for our priority config) and
 * snapshot caps (jsdom).
 */
import { describe, expect, it } from 'vitest'
import { OUTER_HTML_CAP, TEXT_CAP, cssPath, snapshotOf, truncate } from '../src/client/picker-core.ts'

describe('truncate', () => {
  it('keeps short values and lands exactly at the cap for long ones', () => {
    expect(truncate('abc', 5)).toBe('abc')
    const long = 'x'.repeat(OUTER_HTML_CAP + 50)
    const out = truncate(long, OUTER_HTML_CAP)
    expect(out.length).toBe(OUTER_HTML_CAP)
    expect(out.endsWith('…')).toBe(true)
    expect(truncate('y'.repeat(TEXT_CAP), TEXT_CAP)).toBe('y'.repeat(TEXT_CAP))
  })
})

describe('cssPath', () => {
  it('prefers a bare id', () => {
    document.body.innerHTML = '<div id="hero"><span>t</span></div>'
    expect(cssPath(document.querySelector('#hero') as Element)).toBe('#hero')
  })

  it('yields the shortest unique selector: class beats tag chains', () => {
    document.body.innerHTML = '<div class="wrap"><section><button class="go">x</button></section></div>'
    expect(cssPath(document.querySelector('button') as Element)).toBe('.go')
  })

  it('uses nth-of-type only when uniqueness requires it', () => {
    document.body.innerHTML = '<ul><li class="a b">1</li><li class="a">2</li></ul>'
    const first = document.querySelectorAll('li')[0] as Element
    const second = document.querySelectorAll('li')[1] as Element
    // .b is unique (only li0 carries it); li1 shares .a with li0, so the
    // library indexes it.
    expect(cssPath(first)).toBe('.b')
    expect(cssPath(second)).toBe('li:nth-of-type(2)')
  })

  it('falls back to the bare tag when nothing else distinguishes the element', () => {
    document.body.innerHTML = '<div class="card primary"><p>t</p></div><div class="card primary"><p>t</p></div>'
    expect(cssPath(document.querySelectorAll('.card')[0] as Element)).toBe('div:nth-of-type(1)')
  })
})

describe('snapshotOf', () => {
  it('captures the exact contract fields with caps enforced', () => {
    document.body.innerHTML = `<div id="card" class="card primary" style="margin: 4px; padding: 8px;">
      <span>${'t'.repeat(TEXT_CAP + 100)}</span>
      <p>${'h'.repeat(OUTER_HTML_CAP + 100)}</p>
    </div>`
    const el = document.querySelector('#card') as Element
    const snap = snapshotOf(el)
    expect(snap.tagName).toBe('div')
    expect(snap.id).toBe('card')
    expect(snap.className).toBe('card primary')
    expect(snap.cssPath).toBe('#card')
    expect(snap.outerHTML.length).toBe(OUTER_HTML_CAP)
    expect(snap.textContent.length).toBe(TEXT_CAP)
    expect(snap.rect).toMatchObject({ x: expect.any(Number), y: expect.any(Number), width: expect.any(Number), height: expect.any(Number) })
    expect(snap.computed.display).toBe('block')
    expect(snap.computed.margin).toBe('4px')
    expect(snap.computed.padding).toBe('8px')
  })
})
