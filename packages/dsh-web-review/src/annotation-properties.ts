/**
 * Browser-annotation CSS property allowlist shared by both package faces.
 * Values remain user input and are validated separately; URL-bearing and
 * generated-content properties are intentionally absent.
 */
export const EDITABLE_STYLE_PROPERTIES = [
  'color', 'background-color', 'opacity',
  'font-family', 'font-size', 'font-weight', 'font-style', 'line-height',
  'letter-spacing', 'text-align', 'text-decoration', 'text-transform',
  'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height',
  'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index',
  'flex-direction', 'flex-wrap', 'justify-content', 'align-items',
  'align-content', 'gap', 'row-gap', 'column-gap', 'overflow',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-width', 'border-style', 'border-color', 'border-radius',
  'box-shadow', 'transform',
] as const

export type EditableStyleProperty = typeof EDITABLE_STYLE_PROPERTIES[number]

const EDITABLE_STYLE_PROPERTY_SET = new Set<string>(EDITABLE_STYLE_PROPERTIES)

/** Strict wire-boundary predicate for one supported CSS property name. */
export function isEditableStyleProperty(value: string): value is EditableStyleProperty {
  return EDITABLE_STYLE_PROPERTY_SET.has(value)
}

/** Reject values that can fetch/execute or break the one-value wire shape. */
export function isSafeAnnotationStyleValue(value: string): boolean {
  const normalized = value.trim()
  return normalized !== ''
    && !/[\u0000-\u001f\u007f]/u.test(normalized)
    && !/(?:url|expression)\s*\(/iu.test(normalized)
    && !/@import/iu.test(normalized)
}
