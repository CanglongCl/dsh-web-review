// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  boundedReviewableTree,
  elementNavigationAction,
  elementTreeDetail,
  firstReviewableChild,
  nextReviewableSibling,
  previousReviewableSibling,
  reviewableAncestors,
  reviewableChildren,
  reviewableParent,
} from '../src/client/element-navigation.ts'

function treeElements(tree: ReturnType<typeof boundedReviewableTree>): Element[] {
  return [tree.element, ...tree.children.flatMap(treeElements)]
}

function dom(): Document {
  const document = window.document.implementation.createHTMLDocument('tree')
  document.documentElement.setAttribute('data-dsh-wv-injected', 'true')
  document.body.innerHTML = `
    <main>
      <style data-dsh-wv-injected>ignored</style>
      <section id="first"><h2>Heading</h2><p>Copy</p></section>
      <div class="dsh-wv-marker">1</div>
      <section id="second">Second</section>
    </main>`
  return document
}

describe('element navigation', () => {
  it('walks reviewable child, parent and sibling elements while skipping plugin chrome', () => {
    const document = dom()
    const main = document.querySelector('main')!
    const first = document.querySelector('#first')!
    const second = document.querySelector('#second')!
    expect(reviewableChildren(main)).toEqual([first, second])
    expect(firstReviewableChild(main)).toBe(first)
    expect(reviewableParent(first)).toBe(main)
    expect(nextReviewableSibling(first)).toBe(second)
    expect(nextReviewableSibling(second)).toBeNull()
    expect(previousReviewableSibling(second)).toBe(first)
    expect(previousReviewableSibling(first)).toBeNull()
    expect(reviewableAncestors(first).map(element => element.tagName.toLowerCase()))
      .toEqual(['html', 'body', 'main', 'section'])
  })

  it('shows child counts for containers and bounded text for leaves', () => {
    const document = dom()
    expect(elementTreeDetail(document.querySelector('#first')!)).toEqual({ kind: 'children', count: 2 })
    const second = document.querySelector('#second')!
    second.textContent = 'A'.repeat(60)
    expect(elementTreeDetail(second)).toEqual({ kind: 'text', text: `${'A'.repeat(47)}…` })
  })

  it('reserves tree budget for a selected element after a large earlier subtree', () => {
    const document = window.document.implementation.createHTMLDocument('large tree')
    const earlier = document.createElement('section')
    for (let index = 0; index < 100; index += 1) earlier.appendChild(document.createElement('div'))
    const selected = document.createElement('button')
    document.body.append(earlier, selected)

    const tree = boundedReviewableTree(selected, 25, 10)
    const elements = treeElements(tree)
    expect(elements.length).toBeLessThanOrEqual(25)
    expect(elements).toContain(selected)
  })

  it('keeps the nearest ancestry when page nesting exceeds the depth bound', () => {
    const document = window.document.implementation.createHTMLDocument('deep tree')
    let selected: Element = document.body
    for (let depth = 0; depth < 20; depth += 1) {
      const child = document.createElement('div')
      selected.appendChild(child)
      selected = child
    }
    const tree = boundedReviewableTree(selected, 100, 5)
    const elements = treeElements(tree)
    expect(elements).toHaveLength(6)
    expect(elements.at(-1)).toBe(selected)
  })

  it('maps Figma-like keys but preserves editable and modified events', () => {
    const plain = document.createElement('div')
    const input = document.createElement('input')
    const button = document.createElement('button')
    expect(elementNavigationAction(new KeyboardEvent('keydown', { key: 'Enter' }))).toBe('child')
    expect(elementNavigationAction(new KeyboardEvent('keydown', { key: '\\', code: 'Backslash' }))).toBe('parent')
    expect(elementNavigationAction(new KeyboardEvent('keydown', { key: 'Tab' }))).toBe('next-sibling')
    expect(elementNavigationAction(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true }))).toBe('previous-sibling')
    input.addEventListener('keydown', event => { expect(elementNavigationAction(event)).toBeNull() }, { once: true })
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    button.addEventListener('keydown', event => {
      expect(elementNavigationAction(event)).toBeNull()
      expect(elementNavigationAction(event, { capturePageActions: true })).toBe('child')
    }, { once: true })
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    plain.addEventListener('keydown', event => { expect(elementNavigationAction(event)).toBeNull() }, { once: true })
    plain.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))
  })
})
