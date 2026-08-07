// @vitest-environment jsdom
/**
 * Picker-core suite: cssPath generation (delegated to css-selector-generator
 * — assertions pin its shortest-unique behavior for our priority config),
 * the full DOM path, identity helpers (label/role/stable classes), and
 * snapshot caps (jsdom).
 */
import { describe, expect, it } from 'vitest'
import {
  OUTER_HTML_CAP, TEXT_CAP, accessibleLabel, cssPath, fullPathOf, roleOf,
  snapshotOf, stableClassesOf, truncate,
} from '../src/client/picker-core.ts'

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

describe('fullPathOf', () => {
  it('walks the complete ancestor chain, indexing only competing siblings', () => {
    document.body.innerHTML = '<main><section class="cards"><div class="card"><button class="btn-primary">x</button></div></section></main>'
    const el = document.querySelector('button') as Element
    expect(fullPathOf(el)).toBe('html > body > main > section.cards > div.card > button.btn-primary')
  })

  it('adds nth-of-type where same-tag siblings compete', () => {
    document.body.innerHTML = '<main><div class="card">a</div><div class="card">b</div></main>'
    const second = document.querySelectorAll('.card')[1] as Element
    expect(fullPathOf(second)).toBe('html > body > main > div.card:nth-of-type(2)')
  })

  it('uses the id instead of an index on id-bearing levels', () => {
    document.body.innerHTML = '<div id="app"><div class="card"><p>x</p></div></div>'
    const el = document.querySelector('p') as Element
    expect(fullPathOf(el)).toBe('html > body > div#app > div.card > p')
  })

  it('excludes the plugin chrome classes (dsh-wv-*) from the path', () => {
    document.body.innerHTML = '<main><div class="card"><button>x</button></div></main>'
    document.documentElement.classList.add('dsh-wv-picking')
    const el = document.querySelector('button') as Element
    expect(fullPathOf(el)).toBe('html > body > main > div.card > button')
  })
})

describe('identity helpers', () => {
  it('accessibleLabel prefers aria-label/title, falls back to visible text', () => {
    document.body.innerHTML = '<button aria-label="保存">save</button><button title="删除">x</button><div class="card"><p>卡片标题</p></div>'
    expect(accessibleLabel(document.querySelector('button[aria-label]') as Element)).toBe('保存')
    expect(accessibleLabel(document.querySelector('button[title]') as Element)).toBe('删除')
    expect(accessibleLabel(document.querySelector('.card') as Element)).toBe('卡片标题')
  })

  it('roleOf maps tags and explicit roles', () => {
    document.body.innerHTML = '<button>b</button><a href="/x">l</a><h2>t</h2><input><div role="tab">t</div><span>s</span>'
    expect(roleOf(document.querySelector('button') as Element)).toBe('button')
    expect(roleOf(document.querySelector('a') as Element)).toBe('link')
    expect(roleOf(document.querySelector('h2') as Element)).toBe('heading')
    expect(roleOf(document.querySelector('input') as Element)).toBe('textbox')
    expect(roleOf(document.querySelector('[role="tab"]') as Element)).toBe('tab')
    expect(roleOf(document.querySelector('span') as Element)).toBe('')
  })

  it('stableClassesOf drops utility, hashed, variant, and chrome classes', () => {
    document.body.innerHTML = '<div class="btn-primary m-2 hover:bg-red css-1a2b3c flex text-sm card dsh-wv-mark">x</div>'
    expect(stableClassesOf(document.querySelector('div') as Element)).toEqual(['btn-primary', 'card'])
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
    expect(snap.fullPath).toBe('html > body > div#card')
    // Visible-text fallback label (the long span/p children, capped).
    expect(snap.label.startsWith('ttttt')).toBe(true)
    expect(snap.label.length).toBeLessThanOrEqual(48)
    expect(snap.role).toBe('')
    expect(snap.stableClasses).toEqual(['card', 'primary'])
    expect(snap.anchor).toBeNull()
    expect(snap.outerHTML.length).toBe(OUTER_HTML_CAP)
    expect(snap.textContent.length).toBe(TEXT_CAP)
    expect(snap.rect).toMatchObject({ x: expect.any(Number), y: expect.any(Number), width: expect.any(Number), height: expect.any(Number) })
    expect(snap.computed.display).toBe('block')
    expect(snap.computed.margin).toBe('4px')
    expect(snap.computed.padding).toBe('8px')
  })
})
