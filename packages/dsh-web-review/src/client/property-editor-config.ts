import type { EditableStyleProperty } from '../annotation-properties.ts'
import type { WebviewKey } from './locales.ts'

export type PropertyControlKind = 'color' | 'number' | 'menu' | 'raw'

export interface PropertyControl {
  property: EditableStyleProperty
  labelKey: WebviewKey
  kind: PropertyControlKind
  options?: readonly string[]
  step?: number
  min?: number
  max?: number
  glyph?: string
}

export interface PropertyGroup {
  labelKey: WebviewKey
  controls: readonly PropertyControl[]
}

const raw = (property: EditableStyleProperty, labelKey: WebviewKey): PropertyControl => ({ property, labelKey, kind: 'raw' })
const color = (property: EditableStyleProperty, labelKey: WebviewKey): PropertyControl => ({ property, labelKey, kind: 'color' })
const number = (property: EditableStyleProperty, labelKey: WebviewKey, options: Pick<PropertyControl, 'step' | 'min' | 'max' | 'glyph'> = {}): PropertyControl => ({ property, labelKey, kind: 'number', ...options })
const menu = (property: EditableStyleProperty, labelKey: WebviewKey, options: readonly string[]): PropertyControl => ({ property, labelKey, kind: 'menu', options })

export const FONT_FAMILIES = [
  'Inter, sans-serif', 'system-ui, sans-serif', 'Arial, sans-serif', 'Helvetica, sans-serif',
  'Roboto, sans-serif', 'PingFang SC, sans-serif', 'Microsoft YaHei, sans-serif',
  'Noto Sans CJK SC, sans-serif', 'Georgia, serif', 'Times New Roman, serif',
  'ui-monospace, monospace',
] as const

export const TEXT_ALIGNMENTS = ['left', 'center', 'right', 'justify'] as const

/** Typed property metadata. Composite controls consume the same entries. */
export const PROPERTY_GROUPS: readonly PropertyGroup[] = [
  {
    labelKey: 'editor.group.fill',
    controls: [
      color('color', 'editor.property.color'),
      color('background-color', 'editor.property.background'),
      number('opacity', 'editor.property.opacity', { step: 0.01, min: 0, max: 1, glyph: '%' }),
    ],
  },
  {
    labelKey: 'editor.group.typography',
    controls: [
      menu('font-family', 'editor.property.fontFamily', FONT_FAMILIES),
      menu('font-weight', 'editor.property.fontWeight', ['100', '200', '300', '400', '500', '600', '700', '800', '900']),
      menu('font-style', 'editor.property.fontStyle', ['normal', 'italic', 'oblique']),
      number('font-size', 'editor.property.fontSize', { step: 1, min: 0, glyph: 'S' }),
      number('line-height', 'editor.property.lineHeight', { step: 1, min: 0, glyph: '↕' }),
      number('letter-spacing', 'editor.property.letterSpacing', { step: 0.1, glyph: '↔' }),
      menu('text-align', 'editor.property.textAlign', ['left', 'center', 'right', 'justify', 'start', 'end']),
      menu('text-decoration', 'editor.property.textDecoration', ['none', 'underline', 'line-through', 'overline']),
      menu('text-transform', 'editor.property.textTransform', ['none', 'uppercase', 'lowercase', 'capitalize']),
    ],
  },
  {
    labelKey: 'editor.group.size',
    controls: [
      number('width', 'editor.property.width', { step: 1, min: 0, glyph: 'W' }),
      number('height', 'editor.property.height', { step: 1, min: 0, glyph: 'H' }),
      number('min-width', 'editor.property.minWidth', { step: 1, min: 0, glyph: 'W' }),
      number('max-width', 'editor.property.maxWidth', { step: 1, min: 0, glyph: 'W' }),
      number('min-height', 'editor.property.minHeight', { step: 1, min: 0, glyph: 'H' }),
      number('max-height', 'editor.property.maxHeight', { step: 1, min: 0, glyph: 'H' }),
    ],
  },
  {
    labelKey: 'editor.group.layout',
    controls: [
      menu('display', 'editor.property.display', ['block', 'inline', 'inline-block', 'flex', 'inline-flex', 'grid', 'none']),
      menu('position', 'editor.property.position', ['static', 'relative', 'absolute', 'fixed', 'sticky']),
      number('top', 'editor.property.top'), number('right', 'editor.property.right'),
      number('bottom', 'editor.property.bottom'), number('left', 'editor.property.left'),
      number('z-index', 'editor.property.zIndex', { step: 1, glyph: 'Z' }),
      menu('flex-direction', 'editor.property.flexDirection', ['row', 'row-reverse', 'column', 'column-reverse']),
      menu('flex-wrap', 'editor.property.flexWrap', ['nowrap', 'wrap', 'wrap-reverse']),
      menu('justify-content', 'editor.property.justifyContent', ['normal', 'flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly']),
      menu('align-items', 'editor.property.alignItems', ['normal', 'stretch', 'flex-start', 'center', 'flex-end', 'baseline']),
      menu('align-content', 'editor.property.alignContent', ['normal', 'stretch', 'flex-start', 'center', 'flex-end', 'space-between', 'space-around']),
      number('gap', 'editor.property.gap', { step: 1, min: 0 }),
      number('row-gap', 'editor.property.rowGap', { step: 1, min: 0 }),
      number('column-gap', 'editor.property.columnGap', { step: 1, min: 0 }),
      menu('overflow', 'editor.property.overflow', ['visible', 'hidden', 'clip', 'scroll', 'auto']),
    ],
  },
  {
    labelKey: 'editor.group.spacing',
    controls: [
      number('margin-top', 'editor.property.marginTop'), number('margin-right', 'editor.property.marginRight'),
      number('margin-bottom', 'editor.property.marginBottom'), number('margin-left', 'editor.property.marginLeft'),
      number('padding-top', 'editor.property.paddingTop', { min: 0 }), number('padding-right', 'editor.property.paddingRight', { min: 0 }),
      number('padding-bottom', 'editor.property.paddingBottom', { min: 0 }), number('padding-left', 'editor.property.paddingLeft', { min: 0 }),
    ],
  },
  {
    labelKey: 'editor.group.border',
    controls: [
      number('border-radius', 'editor.property.borderRadius', { min: 0 }),
      number('border-width', 'editor.property.borderWidth', { min: 0 }),
      menu('border-style', 'editor.property.borderStyle', ['none', 'solid', 'dashed', 'dotted', 'double']),
      color('border-color', 'editor.property.borderColor'),
    ],
  },
  {
    labelKey: 'editor.group.effects',
    controls: [raw('box-shadow', 'editor.property.boxShadow'), raw('transform', 'editor.property.transform')],
  },
] as const

export const PROPERTY_BY_NAME = new Map(
  PROPERTY_GROUPS.flatMap(group => group.controls).map(control => [control.property, control]),
)
