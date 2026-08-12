// @vitest-environment jsdom
/**
 * Source-anchor suite: framework-agnostic source-location extraction from
 * framework-internal DOM metadata. jsdom lets us attach arbitrary JS props
 * to elements, so each case mounts a mock of the framework's internal shape
 * (React fiber / Vue instance / Svelte meta) and asserts the resolved
 * SourceAnchor — or null for plain elements and production builds.
 */
import { describe, expect, it } from 'vitest'
import { PREVIEW_ELEMENT_LIMITS } from '../src/preview-contract.ts'
import { sourceAnchorOf, type SourceAnchor } from '../src/client/source-anchor.ts'

/** Attach a framework-internal metadata prop to an element (jsdom allows arbitrary JS props). */
function attach(el: Element, key: string, value: unknown): void {
  ;(el as unknown as Record<string, unknown>)[key] = value
}

/** Resolve the anchor and fail the test if the element resolved to null. */
function expectAnchor(el: Element): SourceAnchor {
  const anchor = sourceAnchorOf(el)
  expect(anchor).not.toBeNull()
  return anchor as SourceAnchor
}

describe('sourceAnchorOf — React (dev mode)', () => {
  it('resolves file/line from the element fiber and filters SKIP_COMPONENTS from the chain', () => {
    const el = document.createElement('div')
    attach(el, '__reactFiber$7f3a9c', {
      type: { name: 'Hero' },
      _debugSource: { fileName: '/Users/me/project/src/components/Hero.tsx', lineNumber: 12 },
      return: {
        type: { name: 'Layout' },
        return: { type: { name: 'AppRouter' }, return: null },
      },
    })
    const anchor = expectAnchor(el)
    expect(anchor.framework).toBe('react')
    // Absolute path is relativized to src/...
    expect(anchor.file).toBe('src/components/Hero.tsx')
    expect(anchor.line).toBe(12)
    // Outermost-first, AppRouter (in SKIP_COMPONENTS) filtered out.
    expect(anchor.component).toBe('Layout › Hero')
  })

  it('falls back to an ancestor fiber when the element fiber itself has no _debugSource', () => {
    const el = document.createElement('div')
    attach(el, '__reactFiber$abc123', {
      type: { name: 'Hero' },
      return: {
        type: { name: 'Layout' },
        _debugSource: { fileName: 'src/components/Wrap.tsx', lineNumber: 7 },
        return: null,
      },
    })
    const anchor = expectAnchor(el)
    expect(anchor.framework).toBe('react')
    // File/line come from the ancestor (Layout) fiber, already src-relative.
    expect(anchor.file).toBe('src/components/Wrap.tsx')
    expect(anchor.line).toBe(7)
    expect(anchor.component).toBe('Layout › Hero')
  })

  it('returns null when the fiber exists but carries no _debugSource (production build)', () => {
    const el = document.createElement('div')
    attach(el, '__reactFiber$prod1', {
      type: { name: 'Hero' },
      return: { type: { name: 'Layout' }, return: null },
    })
    expect(sourceAnchorOf(el)).toBeNull()
  })

  it('terminates cyclic fiber chains and still resolves a valid source', () => {
    const el = document.createElement('div')
    const fiber: Record<string, unknown> = {
      type: { name: 'Hero' },
      _debugSource: { fileName: 'src/components/Hero.tsx', lineNumber: 8 },
    }
    fiber.return = fiber
    attach(el, '__reactFiber$cycle', fiber)
    expect(expectAnchor(el)).toMatchObject({ file: 'src/components/Hero.tsx', line: 8, component: 'Hero' })
  })

  it('recognizes the legacy __reactInternalInstance$ fiber prefix', () => {
    const el = document.createElement('div')
    attach(el, '__reactInternalInstance$legacy', {
      type: { name: 'Hero' },
      _debugSource: { fileName: 'src/components/Hero.tsx', lineNumber: 1 },
      return: null,
    })
    const anchor = expectAnchor(el)
    expect(anchor).toMatchObject({ framework: 'react', file: 'src/components/Hero.tsx', line: 1 })
  })
})

describe('sourceAnchorOf — Vue', () => {
  it('Vue 3: reads __vueParentComponent.type.__file and type.name, no line property', () => {
    const el = document.createElement('div')
    attach(el, '__vueParentComponent', { type: { __file: 'src/components/Hero.vue', name: 'Hero' } })
    const anchor = expectAnchor(el)
    expect(anchor.framework).toBe('vue')
    expect(anchor.component).toBe('Hero')
    expect(anchor.file).toBe('src/components/Hero.vue')
    expect(anchor).not.toHaveProperty('line')
  })

  it('Vue 3: falls back to type.__name when type.name is absent', () => {
    const el = document.createElement('div')
    attach(el, '__vueParentComponent', { type: { __file: 'src/components/Hero.vue', __name: 'Hero' } })
    const anchor = expectAnchor(el)
    expect(anchor).toMatchObject({ framework: 'vue', component: 'Hero', file: 'src/components/Hero.vue' })
    expect(anchor).not.toHaveProperty('line')
  })

  it('Vue 2: reads __vue__.$options.__file and $options.name', () => {
    const el = document.createElement('div')
    attach(el, '__vue__', { $options: { __file: 'src/components/Hero.vue', name: 'Hero' } })
    const anchor = expectAnchor(el)
    expect(anchor.framework).toBe('vue')
    expect(anchor.component).toBe('Hero')
    expect(anchor.file).toBe('src/components/Hero.vue')
    expect(anchor).not.toHaveProperty('line')
  })
})

describe('sourceAnchorOf — Svelte 5', () => {
  it('reads __svelte_meta.loc, infers the component from the file basename', () => {
    const el = document.createElement('div')
    attach(el, '__svelte_meta', { loc: { file: 'src/components/Hero.svelte', line: 42 } })
    const anchor = expectAnchor(el)
    expect(anchor.framework).toBe('svelte')
    expect(anchor.component).toBe('Hero')
    expect(anchor.file).toBe('src/components/Hero.svelte')
    expect(anchor.line).toBe(42)
  })

  it('bounds page-owned source metadata before bridge serialization', () => {
    const el = document.createElement('div')
    const component = 'S'.repeat(PREVIEW_ELEMENT_LIMITS.anchorComponent + 50)
    const file = `src/${'d/'.repeat(PREVIEW_ELEMENT_LIMITS.anchorFile)}/${component}.svelte`
    attach(el, '__svelte_meta', { loc: { file } })
    const anchor = expectAnchor(el)
    expect(anchor.component).toHaveLength(PREVIEW_ELEMENT_LIMITS.anchorComponent)
    expect(anchor.file).toHaveLength(PREVIEW_ELEMENT_LIMITS.anchorFile)
  })
})

describe('sourceAnchorOf — fallbacks and priority', () => {
  it('returns null for a plain element with no framework metadata', () => {
    const el = document.createElement('div')
    expect(sourceAnchorOf(el)).toBeNull()
  })

  it('prefers React over Vue when both metadata shapes are present', () => {
    const el = document.createElement('div')
    attach(el, '__reactFiber$prio', {
      type: { name: 'Hero' },
      _debugSource: { fileName: 'src/components/Hero.tsx', lineNumber: 3 },
      return: null,
    })
    attach(el, '__vueParentComponent', { type: { __file: 'src/components/Hero.vue', name: 'Hero' } })
    const anchor = expectAnchor(el)
    expect(anchor.framework).toBe('react')
    expect(anchor.file).toBe('src/components/Hero.tsx')
  })

  it('never throws on malformed metadata — returns null instead', () => {
    const el = document.createElement('div')
    attach(el, '__reactFiber$x', 'garbage')
    attach(el, '__vueParentComponent', 'garbage')
    attach(el, '__vue__', 42)
    attach(el, '__svelte_meta', null)
    expect(() => sourceAnchorOf(el)).not.toThrow()
    expect(sourceAnchorOf(el)).toBeNull()
  })

  it('ignores invalid primitive fields and throwing metadata accessors', () => {
    const el = document.createElement('div')
    attach(el, '__reactFiber$invalid', {
      _debugSource: { fileName: 42, lineNumber: '12' },
      return: null,
    })
    Object.defineProperty(el, '__vueParentComponent', {
      configurable: true,
      get() { throw new Error('page-owned getter') },
    })
    attach(el, '__svelte_meta', { loc: { file: 7, line: -1 } })
    expect(() => sourceAnchorOf(el)).not.toThrow()
    expect(sourceAnchorOf(el)).toBeNull()
  })

  it('normalizes Windows source paths and omits invalid line numbers', () => {
    const el = document.createElement('div')
    attach(el, '__svelte_meta', { loc: { file: 'C:\\project\\src\\Hero.svelte', line: 0 } })
    expect(expectAnchor(el)).toEqual({
      framework: 'svelte', component: 'Hero', file: 'src/Hero.svelte',
    })
  })
})
