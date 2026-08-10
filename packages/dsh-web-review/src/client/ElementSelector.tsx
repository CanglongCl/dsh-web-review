import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { IconChevronDownOutline14, IconChevronRightOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import {
  elementNavigationAction,
  elementTreeDetail,
  firstReviewableChild,
  nextReviewableSibling,
  navigateElement,
  previousReviewableSibling,
  reviewableAncestors,
  reviewableChildren,
  reviewableParent,
  sameElement,
} from './element-navigation.ts'
import type { WebviewKey } from './locales.ts'
import css from './ElementSelector.module.css'

interface ElementSelectorProps {
  root: Element
  current: Element
  t: Translate<WebviewKey>
  onSelect: (element: Element) => void
}

function ShortcutKey({ children }: { children: string }): JSX.Element {
  return <kbd className={css.shortcut} aria-hidden>{children}</kbd>
}

function ElementGlyph({ text }: { text: boolean }): JSX.Element {
  return <span className={css.glyph} aria-hidden>{text ? 'T' : '<>'}</span>
}

function detailOf(element: Element, t: Translate<WebviewKey>): string {
  const detail = elementTreeDetail(element)
  if (detail.kind === 'children') return t('editor.select.children', { count: String(detail.count) })
  if (detail.kind === 'empty') return t('editor.select.empty')
  return `“${detail.text}”`
}

function treeKeyOf(element: Element): string {
  const segments: string[] = []
  let current: Element | null = element
  while (current !== null) {
    const node = current
    const parent = reviewableParent(node)
    const index = parent === null
      ? 0
      : reviewableChildren(parent).findIndex(candidate => sameElement(candidate, node))
    segments.push(`${node.tagName.toLowerCase()}:${String(index)}`)
    current = parent
  }
  return segments.reverse().join('/')
}

function TreeNode({
  element, current, depth, expanded, focusedKey, t, onFocus, onKeyDown, onToggle, onSelect, registerItem,
}: {
  element: Element
  current: Element
  depth: number
  expanded: ReadonlySet<string>
  focusedKey: string
  t: Translate<WebviewKey>
  onFocus: (element: Element) => void
  onKeyDown: (event: ReactKeyboardEvent<HTMLLIElement>, element: Element) => void
  onToggle: (element: Element) => void
  onSelect: (element: Element) => void
  registerItem: (key: string, item: HTMLLIElement | null) => void
}): JSX.Element {
  const children = reviewableChildren(element)
  const hasChildren = children.length > 0
  const isCurrent = sameElement(element, current)
  const elementKey = treeKeyOf(element)
  const isExpanded = expanded.has(elementKey)
  const rowRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (isCurrent && typeof rowRef.current?.scrollIntoView === 'function') {
      rowRef.current.scrollIntoView({ block: 'nearest' })
    }
  }, [isCurrent])

  return (
    <li
      ref={item => { registerItem(elementKey, item) }}
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={isCurrent}
      aria-expanded={hasChildren ? isExpanded : undefined}
      tabIndex={focusedKey === elementKey ? 0 : -1}
      data-tree-key={elementKey}
      onFocus={event => { if (event.target === event.currentTarget) onFocus(element) }}
      onKeyDown={event => { if (event.target === event.currentTarget) onKeyDown(event, element) }}
    >
      <div
        ref={rowRef}
        className={isCurrent ? `${css.treeRow} ${css.treeRowCurrent}` : css.treeRow}
        style={{ paddingInlineStart: 6 + depth * 20 }}
        data-webview-element-row=""
      >
        {hasChildren
          ? (
            <button
              type="button"
              className={isExpanded ? `${css.disclosure} ${css.disclosureExpanded}` : css.disclosure}
              aria-label={t(isExpanded ? 'editor.select.collapse' : 'editor.select.expand', { tag: element.tagName.toLowerCase() })}
              aria-expanded={isExpanded}
              tabIndex={-1}
              data-state={isExpanded ? 'expanded' : 'collapsed'}
              onClick={() => { onFocus(element); onToggle(element) }}
            >
              {isExpanded ? <IconChevronDownOutline14 size={12} /> : <IconChevronRightOutline14 size={12} />}
            </button>
          )
          : <span className={css.disclosureSpacer} />}
        <button
          type="button"
          className={css.elementButton}
          aria-label={`${element.tagName.toLowerCase()} ${detailOf(element, t)}`}
          tabIndex={-1}
          onClick={() => { onFocus(element); onSelect(element) }}
        >
          <ElementGlyph text={!hasChildren} />
          <span className={css.tag}>{element.tagName.toLowerCase()}</span>
          <span className={css.detail}>{detailOf(element, t)}</span>
        </button>
      </div>
      {hasChildren && isExpanded && (
        <ul role="group">
          {children.map(child => (
            <TreeNode
              key={treeKeyOf(child)}
              element={child}
              current={current}
              depth={depth + 1}
              expanded={expanded}
              focusedKey={focusedKey}
              t={t}
              onFocus={onFocus}
              onKeyDown={onKeyDown}
              onToggle={onToggle}
              onSelect={onSelect}
              registerItem={registerItem}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

/** Host-owned DOM hierarchy selector for the active annotation target. */
export function ElementSelector({ root, current, t, onSelect }: ElementSelectorProps): JSX.Element {
  const initialExpanded = useMemo(() => new Set(reviewableAncestors(current).map(treeKeyOf)), [current])
  const [expanded, setExpanded] = useState<Set<string>>(initialExpanded)
  const [focusedKey, setFocusedKey] = useState(() => treeKeyOf(current))
  const itemRefs = useRef(new Map<string, HTMLLIElement>())
  const pendingFocus = useRef<string | null>(treeKeyOf(current))

  useEffect(() => {
    setExpanded(value => {
      const next = new Set(value)
      reviewableAncestors(current).forEach(element => { next.add(treeKeyOf(element)) })
      return next
    })
  }, [current])

  const visibleElements = useMemo(() => {
    const result: Element[] = []
    const visit = (element: Element): void => {
      result.push(element)
      if (expanded.has(treeKeyOf(element))) reviewableChildren(element).forEach(visit)
    }
    visit(root)
    return result
  }, [expanded, root])

  useEffect(() => {
    const key = pendingFocus.current
    if (key === null) return
    const item = itemRefs.current.get(key)
    if (item === undefined) return
    pendingFocus.current = null
    item.focus({ preventScroll: true })
  }, [expanded, focusedKey])

  const child = firstReviewableChild(current)
  const parent = reviewableParent(current)
  const previousSibling = previousReviewableSibling(current)
  const nextSibling = nextReviewableSibling(current)
  const toggle = (element: Element): void => {
    setExpanded(value => {
      const next = new Set(value)
      const key = treeKeyOf(element)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const focusElement = (element: Element): void => {
    const key = treeKeyOf(element)
    pendingFocus.current = key
    setFocusedKey(key)
    const item = itemRefs.current.get(key)
    if (item !== undefined) {
      pendingFocus.current = null
      item.focus({ preventScroll: true })
    }
  }

  const onTreeKeyDown = (event: ReactKeyboardEvent<HTMLLIElement>, element: Element): void => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.isDefaultPrevented()) return
    const navigationAction = elementNavigationAction(event.nativeEvent)
    if (navigationAction !== null) {
      const navigationTarget = navigateElement(element, navigationAction)
      event.preventDefault()
      event.stopPropagation()
      if (navigationTarget !== null) onSelect(navigationTarget)
      return
    }
    const children = reviewableChildren(element)
    const key = treeKeyOf(element)
    const index = visibleElements.findIndex(candidate => sameElement(candidate, element))
    let target: Element | null = null
    if (event.key === 'ArrowDown') target = visibleElements[index + 1] ?? null
    else if (event.key === 'ArrowUp') target = visibleElements[index - 1] ?? null
    else if (event.key === 'Home') target = visibleElements[0] ?? null
    else if (event.key === 'End') target = visibleElements.at(-1) ?? null
    else if (event.key === 'ArrowRight' && children.length > 0) {
      if (!expanded.has(key)) toggle(element)
      else target = children[0] ?? null
    } else if (event.key === 'ArrowLeft') {
      if (expanded.has(key) && children.length > 0) toggle(element)
      else target = reviewableParent(element)
    } else if (event.key === ' ') {
      onSelect(element)
    } else return
    event.preventDefault()
    event.stopPropagation()
    if (target !== null) focusElement(target)
  }

  const registerItem = (key: string, item: HTMLLIElement | null): void => {
    if (item === null) itemRefs.current.delete(key)
    else itemRefs.current.set(key, item)
  }

  const action = (target: Element | null): void => { if (target !== null) onSelect(target) }

  return (
    <div className={css.selector} data-webview-element-selector="">
      <div className={css.actions}>
        <button type="button" aria-label={t('editor.select.child')} disabled={child === null} onClick={() => { action(child) }}>
          <span>{t('editor.select.child.short')}</span>
          <ShortcutKey>↵</ShortcutKey>
        </button>
        <button type="button" aria-label={t('editor.select.parent')} disabled={parent === null} onClick={() => { action(parent) }}>
          <span>{t('editor.select.parent.short')}</span>
          <ShortcutKey>\</ShortcutKey>
        </button>
        <button type="button" aria-label={t('editor.select.previousSibling')} title={t('editor.select.previousSibling')} disabled={previousSibling === null} onClick={() => { action(previousSibling) }}>
          <span>{t('editor.select.previousSibling.short')}</span>
          <ShortcutKey>⇧⇥</ShortcutKey>
        </button>
        <button type="button" aria-label={t('editor.select.sibling')} title={t('editor.select.sibling')} disabled={nextSibling === null} onClick={() => { action(nextSibling) }}>
          <span>{t('editor.select.sibling.short')}</span>
          <ShortcutKey>⇥</ShortcutKey>
        </button>
      </div>
      <div className={css.treeHeader}>
        <span>{t('editor.select.tree')}</span>
      </div>
      <div className={css.treeViewport} data-webview-element-tree="">
        <ul className={css.tree} role="tree" aria-label={t('editor.select.tree')}>
          <TreeNode
            element={root}
            current={current}
            depth={0}
            expanded={expanded}
            focusedKey={focusedKey}
            t={t}
            onFocus={focusElement}
            onKeyDown={onTreeKeyDown}
            onToggle={toggle}
            onSelect={onSelect}
            registerItem={registerItem}
          />
        </ul>
      </div>
    </div>
  )
}
