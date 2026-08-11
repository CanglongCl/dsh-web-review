import { useEffect, useMemo, useRef, useState } from 'react'
import { IconChevronDownOutline14, IconChevronRightOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import {
  elementTreeDetail,
  firstReviewableChild,
  nextReviewableSibling,
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
  element, current, depth, expanded, t, onToggle, onSelect,
}: {
  element: Element
  current: Element
  depth: number
  expanded: ReadonlySet<string>
  t: Translate<WebviewKey>
  onToggle: (element: Element) => void
  onSelect: (element: Element) => void
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
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={isCurrent}
      aria-expanded={hasChildren ? isExpanded : undefined}
      tabIndex={-1}
      data-tree-key={elementKey}
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
              onClick={() => { onToggle(element) }}
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
          onClick={() => { onSelect(element) }}
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
              t={t}
              onToggle={onToggle}
              onSelect={onSelect}
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

  useEffect(() => {
    setExpanded(value => {
      const next = new Set(value)
      reviewableAncestors(current).forEach(element => { next.add(treeKeyOf(element)) })
      return next
    })
  }, [current])

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

  const action = (target: Element | null): void => { if (target !== null) onSelect(target) }

  return (
    <div className={css.selector} data-webview-element-selector="">
      <div className={css.actions}>
        <button type="button" tabIndex={-1} aria-label={t('editor.select.child')} disabled={child === null} onClick={() => { action(child) }}>
          <span>{t('editor.select.child.short')}</span>
          <ShortcutKey>↵</ShortcutKey>
        </button>
        <button type="button" tabIndex={-1} aria-label={t('editor.select.parent')} disabled={parent === null} onClick={() => { action(parent) }}>
          <span>{t('editor.select.parent.short')}</span>
          <ShortcutKey>\</ShortcutKey>
        </button>
        <button type="button" tabIndex={-1} aria-label={t('editor.select.previousSibling')} title={t('editor.select.previousSibling')} disabled={previousSibling === null} onClick={() => { action(previousSibling) }}>
          <span>{t('editor.select.previousSibling.short')}</span>
          <ShortcutKey>⇧⇥</ShortcutKey>
        </button>
        <button type="button" tabIndex={-1} aria-label={t('editor.select.sibling')} title={t('editor.select.sibling')} disabled={nextSibling === null} onClick={() => { action(nextSibling) }}>
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
            t={t}
            onToggle={toggle}
            onSelect={onSelect}
          />
        </ul>
      </div>
    </div>
  )
}
