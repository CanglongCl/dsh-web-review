import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { IconChevronDownOutline14, IconChevronRightOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  PreviewElementHandle,
  PreviewElementNavigationAction,
  PreviewElementTarget,
  PreviewTreeNode,
} from '../preview-contract.ts'
import type { WebviewKey } from './locales.ts'
import css from './ElementSelector.module.css'

interface PreviewElementSelectorProps {
  target: PreviewElementTarget
  tree: PreviewTreeNode | null
  t: Translate<WebviewKey>
  onNavigate: (action: PreviewElementNavigationAction) => void
  onSelect: (handle: PreviewElementHandle) => void
}

function ShortcutKey({ children }: { children: string }): JSX.Element {
  return <kbd className={css.shortcut} aria-hidden>{children}</kbd>
}

function ElementGlyph({ text }: { text: boolean }): JSX.Element {
  return <span className={css.glyph} aria-hidden>{text ? 'T' : '<>'}</span>
}

function detailText(node: PreviewTreeNode, t: Translate<WebviewKey>): string {
  if (node.detail.kind === 'children') return t('editor.select.children', { count: String(node.detail.count) })
  if (node.detail.kind === 'empty') return t('editor.select.empty')
  return `“${node.detail.text}”`
}

function currentPath(node: PreviewTreeNode): string[] | undefined {
  if (node.current) return [node.key]
  for (const child of node.children) {
    const path = currentPath(child)
    if (path !== undefined) return [node.key, ...path]
  }
  return undefined
}

function TreeNode({
  node, depth, expanded, t, onToggle, onSelect,
}: {
  node: PreviewTreeNode
  depth: number
  expanded: ReadonlySet<string>
  t: Translate<WebviewKey>
  onToggle: (key: string) => void
  onSelect: (handle: PreviewElementHandle) => void
}): JSX.Element {
  const hasChildren = node.children.length > 0
  const isExpanded = expanded.has(node.key)
  const rowRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (node.current) rowRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [node.current])
  return (
    <li
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={node.current}
      aria-expanded={hasChildren ? isExpanded : undefined}
      tabIndex={-1}
      data-tree-key={node.key}
    >
      <div
        ref={rowRef}
        className={node.current ? `${css.treeRow} ${css.treeRowCurrent}` : css.treeRow}
        style={{ paddingInlineStart: 6 + depth * 20 }}
        data-webview-element-row=""
      >
        {hasChildren
          ? (
            <button
              type="button"
              className={isExpanded ? `${css.disclosure} ${css.disclosureExpanded}` : css.disclosure}
              aria-label={t(isExpanded ? 'editor.select.collapse' : 'editor.select.expand', { tag: node.tagName })}
              aria-expanded={isExpanded}
              tabIndex={-1}
              data-state={isExpanded ? 'expanded' : 'collapsed'}
              onClick={() => { onToggle(node.key) }}
            >
              {isExpanded ? <IconChevronDownOutline14 size={12} /> : <IconChevronRightOutline14 size={12} />}
            </button>
          )
          : <span className={css.disclosureSpacer} />}
        <button
          type="button"
          className={css.elementButton}
          aria-label={`${node.tagName} ${detailText(node, t)}`}
          tabIndex={-1}
          onClick={() => { onSelect(node.handle) }}
        >
          <ElementGlyph text={!hasChildren} />
          <span className={css.tag}>{node.tagName}</span>
          <span className={css.detail}>{detailText(node, t)}</span>
        </button>
      </div>
      {hasChildren && isExpanded && (
        <ul role="group">
          {node.children.map(child => (
            <TreeNode
              key={child.key}
              node={child}
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

/** Host renderer for the bounded hierarchy serialized by the frame bridge. */
export function PreviewElementSelector({
  target, tree, t, onNavigate, onSelect,
}: PreviewElementSelectorProps): JSX.Element {
  const initialExpanded = useMemo(() => new Set(tree === null ? [] : currentPath(tree) ?? []), [tree])
  const [expanded, setExpanded] = useState(initialExpanded)
  const [canScrollDown, setCanScrollDown] = useState(false)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const syncScrollAffordance = useCallback(() => {
    const viewport = viewportRef.current
    if (viewport === null) return
    const next = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight > 2
    setCanScrollDown(current => current === next ? current : next)
  }, [])
  useEffect(() => { setExpanded(initialExpanded) }, [initialExpanded])
  useEffect(() => {
    const viewport = viewportRef.current
    if (viewport === null) return
    syncScrollAffordance()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(syncScrollAffordance)
    observer.observe(viewport)
    return () => { observer.disconnect() }
  }, [expanded, syncScrollAffordance])
  const action = (name: PreviewElementNavigationAction): void => {
    if (target.navigation[name]) onNavigate(name)
  }
  return (
    <div className={css.selector} data-webview-element-selector="">
      <div className={css.actions}>
        <button type="button" tabIndex={-1} aria-label={t('editor.select.child')} disabled={!target.navigation.child} onClick={() => { action('child') }}>
          <span>{t('editor.select.child.short')}</span><ShortcutKey>↵</ShortcutKey>
        </button>
        <button type="button" tabIndex={-1} aria-label={t('editor.select.parent')} disabled={!target.navigation.parent} onClick={() => { action('parent') }}>
          <span>{t('editor.select.parent.short')}</span><ShortcutKey>\</ShortcutKey>
        </button>
        <button type="button" tabIndex={-1} aria-label={t('editor.select.previousSibling')} disabled={!target.navigation['previous-sibling']} onClick={() => { action('previous-sibling') }}>
          <span>{t('editor.select.previousSibling.short')}</span><ShortcutKey>⇧⇥</ShortcutKey>
        </button>
        <button type="button" tabIndex={-1} aria-label={t('editor.select.sibling')} disabled={!target.navigation['next-sibling']} onClick={() => { action('next-sibling') }}>
          <span>{t('editor.select.sibling.short')}</span><ShortcutKey>⇥</ShortcutKey>
        </button>
      </div>
      <div className={css.treeHeader}><span>{t('editor.select.tree')}</span></div>
      <div className={css.treeViewportShell} {...(canScrollDown ? { 'data-can-scroll-down': '' } : {})}>
        <div ref={viewportRef} className={css.treeViewport} data-webview-element-tree="" onScroll={syncScrollAffordance}>
          {tree !== null && (
            <ul className={css.tree} role="tree" aria-label={t('editor.select.tree')}>
              <TreeNode
                node={tree}
                depth={0}
                expanded={expanded}
                t={t}
                onToggle={(key) => {
                  setExpanded(current => {
                    const next = new Set(current)
                    if (next.has(key)) next.delete(key)
                    else next.add(key)
                    return next
                  })
                }}
                onSelect={onSelect}
              />
            </ul>
          )}
        </div>
        <div className={css.treeFade} data-webview-element-tree-fade="" aria-hidden="true" />
      </div>
    </div>
  )
}
