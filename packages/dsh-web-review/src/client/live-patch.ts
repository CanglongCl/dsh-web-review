/** Typed, exact rollback ledger for temporary iframe element previews. */
import type { AnnotationStyleChange, AnnotationTextChange } from '../annotation-contract.ts'
import type { EditableStyleProperty } from '../annotation-properties.ts'
import { EDITABLE_STYLE_PROPERTIES } from '../annotation-properties.ts'

interface InlineDeclaration {
  value: string
  priority: string
}

export interface LiveElementPatch {
  element: Element
  originalStyles: Map<EditableStyleProperty, InlineDeclaration>
  computedBaselines: Map<EditableStyleProperty, string>
  originalText: { node: Text; value: string } | null
}

function styleOf(element: Element): CSSStyleDeclaration | undefined {
  return (element as Element & { style?: CSSStyleDeclaration }).style
}

/** One safe direct text node; composite elements are deliberately ineligible. */
export function editableTextNode(element: Element): Text | null {
  if (element.children.length > 0) return null
  const nodes = Array.from(element.childNodes).filter(
    (node): node is Text => node.nodeType === 3 && (node as Text).data.trim() !== '',
  )
  return nodes.length === 1 ? nodes[0] ?? null : null
}

export function createLivePatch(element: Element): LiveElementPatch {
  const node = editableTextNode(element)
  return {
    element,
    originalStyles: new Map(),
    computedBaselines: new Map(EDITABLE_STYLE_PROPERTIES.map(property => [property, computedValue(element, property)])),
    originalText: node === null ? null : { node, value: node.data },
  }
}

export function baselineValue(patch: LiveElementPatch, property: EditableStyleProperty): string {
  return patch.computedBaselines.get(property) ?? ''
}

/** Current computed baseline for a property before its first preview write. */
export function computedValue(element: Element, property: EditableStyleProperty): string {
  return element.ownerDocument.defaultView?.getComputedStyle(element).getPropertyValue(property).trim() ?? ''
}

export function previewStyle(patch: LiveElementPatch, property: EditableStyleProperty, value: string): void {
  const style = styleOf(patch.element)
  if (style === undefined) return
  if (!patch.originalStyles.has(property)) {
    patch.originalStyles.set(property, {
      value: style.getPropertyValue(property),
      priority: style.getPropertyPriority(property),
    })
  }
  style.setProperty(property, value, 'important')
}

export function restoreStyle(patch: LiveElementPatch, property: EditableStyleProperty): void {
  const style = styleOf(patch.element)
  const original = patch.originalStyles.get(property)
  if (style === undefined || original === undefined) return
  if (original.value === '') style.removeProperty(property)
  else style.setProperty(property, original.value, original.priority)
  patch.originalStyles.delete(property)
}

export function previewText(patch: LiveElementPatch, value: string): boolean {
  if (patch.originalText === null) return false
  patch.originalText.node.data = value
  return true
}

export function restoreText(patch: LiveElementPatch): void {
  if (patch.originalText !== null) patch.originalText.node.data = patch.originalText.value
}

export function restoreAll(patch: LiveElementPatch): void {
  for (const property of [...patch.originalStyles.keys()]) restoreStyle(patch, property)
  restoreText(patch)
}

/** Replay committed edits after Cancel or a frame re-anchor. */
export function applyCommitted(
  patch: LiveElementPatch,
  changes: readonly AnnotationStyleChange[],
  textChange: AnnotationTextChange | null | undefined,
): void {
  for (const change of changes) previewStyle(patch, change.property, change.after)
  if (textChange !== null && textChange !== undefined) previewText(patch, textChange.after)
}
