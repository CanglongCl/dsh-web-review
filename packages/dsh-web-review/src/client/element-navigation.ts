/** Pure DOM navigation used by the host-owned element selector and shortcuts. */

const NON_REVIEWABLE_TAGS = new Set([
  'BASE', 'HEAD', 'LINK', 'META', 'NOSCRIPT', 'SCRIPT', 'STYLE', 'TEMPLATE', 'TITLE',
])

/** Hierarchy movement supported by the selector toolbar and keyboard. */
export type ElementNavigationAction = 'child' | 'parent' | 'previous-sibling' | 'next-sibling'

/** True when an element belongs in the reviewable page hierarchy. */
export function isReviewableElement(element: Element): boolean {
  if (NON_REVIEWABLE_TAGS.has(element.tagName)) return false
  return !element.classList.contains('dsh-wv-marker')
}

/** Reviewable direct element children in document order. */
export function reviewableChildren(element: Element): Element[] {
  return Array.from(element.children).filter(isReviewableElement)
}

/** First reviewable child element, or null at a leaf. */
export function firstReviewableChild(element: Element): Element | null {
  return reviewableChildren(element)[0] ?? null
}

/** Reviewable parent element, or null above the document element. */
export function reviewableParent(element: Element): Element | null {
  const parent = element.parentElement
  return parent !== null && isReviewableElement(parent) ? parent : null
}

/** Next reviewable sibling element, skipping injected and metadata nodes. */
export function nextReviewableSibling(element: Element): Element | null {
  let sibling = element.nextElementSibling
  while (sibling !== null && !isReviewableElement(sibling)) sibling = sibling.nextElementSibling
  return sibling
}

/** Previous reviewable sibling element, skipping injected and metadata nodes. */
export function previousReviewableSibling(element: Element): Element | null {
  let sibling = element.previousElementSibling
  while (sibling !== null && !isReviewableElement(sibling)) sibling = sibling.previousElementSibling
  return sibling
}

/** Resolve one hierarchy movement from an element. */
export function navigateElement(element: Element, action: ElementNavigationAction): Element | null {
  if (action === 'child') return firstReviewableChild(element)
  if (action === 'parent') return reviewableParent(element)
  if (action === 'previous-sibling') return previousReviewableSibling(element)
  return nextReviewableSibling(element)
}

/** The element and all of its reviewable ancestors, including itself. */
export function reviewableAncestors(element: Element): Element[] {
  const result: Element[] = []
  let current: Element | null = element
  while (current !== null && isReviewableElement(current)) {
    result.push(current)
    current = reviewableParent(current)
  }
  return result.reverse()
}

/** One DOM-only hierarchy node before bridge handles and labels are added. */
export interface BoundedReviewableTreeNode {
  element: Element
  children: BoundedReviewableTreeNode[]
}

/**
 * Serialize a bounded reviewable hierarchy while reserving enough budget for
 * the selected element's ancestor path. Large earlier subtrees can therefore
 * never crowd the current target out of the bridge response.
 */
export function boundedReviewableTree(
  current: Element,
  maxNodes: number,
  maxDepth: number,
): BoundedReviewableTreeNode {
  const nodeLimit = Math.max(1, Math.floor(maxNodes))
  const depthLimit = Math.max(0, Math.floor(maxDepth))
  const ancestors = reviewableAncestors(current)
  const path = ancestors.slice(-Math.min(nodeLimit, depthLimit + 1))
  const pathIndex = new Map(path.map((element, index) => [element, index]))
  let remaining = nodeLimit

  const visitOptional = (
    element: Element,
    reserve: number,
    depth: number,
  ): BoundedReviewableTreeNode => {
    remaining -= 1
    const children: BoundedReviewableTreeNode[] = []
    if (depth < depthLimit) {
      for (const child of reviewableChildren(element)) {
        if (remaining <= reserve) break
        children.push(visitOptional(child, reserve, depth + 1))
      }
    }
    return { element, children }
  }
  const visitPath = (element: Element, depth: number): BoundedReviewableTreeNode => {
    remaining -= 1
    const index = pathIndex.get(element) ?? path.length - 1
    const pathChild = path[index + 1]
    const mandatoryRemaining = path.length - index - 1
    const children: BoundedReviewableTreeNode[] = []
    let passedPathChild = false
    if (depth < depthLimit) {
      for (const child of reviewableChildren(element)) {
        if (child === pathChild) {
          children.push(visitPath(child, depth + 1))
          passedPathChild = true
          continue
        }
        const reserve = passedPathChild ? 0 : mandatoryRemaining
        if (remaining > reserve) children.push(visitOptional(child, reserve, depth + 1))
      }
    }
    return { element, children }
  }
  return visitPath(path[0] ?? current, 0)
}

/** Locale-neutral data used to render one compact tree-row detail. */
export type ElementTreeDetail =
  | { kind: 'children'; count: number }
  | { kind: 'empty' }
  | { kind: 'text'; text: string }

/** Compact tree-row detail data: direct text for leaves, otherwise child count. */
export function elementTreeDetail(element: Element): ElementTreeDetail {
  const children = reviewableChildren(element)
  if (children.length > 0) return { kind: 'children', count: children.length }
  const text = (element.textContent ?? '').replace(/\s+/gu, ' ').trim()
  if (text === '') return { kind: 'empty' }
  const excerpt = text.length > 48 ? `${text.slice(0, 47)}…` : text
  return { kind: 'text', text: excerpt }
}

/** True when hierarchy shortcuts must defer to an editable/interactive UI. */
export function isElementNavigationInput(target: EventTarget | null, capturePageActions = false): boolean {
  if (target === null || typeof target !== 'object') return false
  const element = (target as Node).nodeType === 1
    ? target as Element
    : (target as Node).parentElement
  if (element === null || element === undefined) return false
  const editable = [
    'input', 'textarea', 'select',
    '[contenteditable]:not([contenteditable="false"])',
  ]
  if (capturePageActions) return element.closest(editable.join(',')) !== null
  return element.closest([
    ...editable, 'button', 'a[href]',
    '[role="menu"]', '[role="dialog"]', '[aria-haspopup="menu"]',
  ].join(',')) !== null
}

/** Map an unmodified keyboard event to a hierarchy movement. */
export function elementNavigationAction(
  event: KeyboardEvent,
  options: { capturePageActions?: boolean } = {},
): ElementNavigationAction | null {
  if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return null
  if (isElementNavigationInput(event.target, options.capturePageActions ?? false)) return null
  if (event.key === 'Enter') return 'child'
  if (event.code === 'Backslash' || event.key === '\\') return 'parent'
  if (event.key === 'Tab') return event.shiftKey ? 'previous-sibling' : 'next-sibling'
  return null
}
