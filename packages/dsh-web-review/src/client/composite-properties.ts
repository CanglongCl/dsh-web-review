import { parseColor, parseNumeric } from './inspector-values.ts'

export type QuadValues = [string, string, string, string]

/** Expand the CSS 1–4 value shorthand in top/right/bottom/left order. */
export function expandQuad(value: string): QuadValues | null {
  if (value.includes('/')) return null
  const parts = value.trim().split(/\s+/u).filter(Boolean)
  if (parts.length < 1 || parts.length > 4 || parts.some(part => parseNumeric(part) === null)) return null
  if (parts.length === 1) return [parts[0]!, parts[0]!, parts[0]!, parts[0]!]
  if (parts.length === 2) return [parts[0]!, parts[1]!, parts[0]!, parts[1]!]
  if (parts.length === 3) return [parts[0]!, parts[1]!, parts[2]!, parts[1]!]
  return [parts[0]!, parts[1]!, parts[2]!, parts[3]!]
}

export function serializeQuad(values: QuadValues, linked: boolean): string {
  return linked ? values[0] : values.join(' ')
}

export interface SimpleShadow {
  inset: boolean
  color: string
  colorFirst: boolean
  lengths: QuadValues
  arity: number
}

function hasTopLevelComma(value: string): boolean {
  let depth = 0
  for (const character of value) {
    if (character === '(') depth += 1
    else if (character === ')') depth -= 1
    else if (character === ',' && depth === 0) return true
  }
  return false
}

/** Parse one editable shadow; lists and uncommon color syntaxes stay raw. */
export function parseSimpleShadow(value: string): SimpleShadow | null {
  const raw = value.trim()
  if (raw === 'none') {
    return { inset: false, color: 'rgba(0, 0, 0, 0.2)', colorFirst: false, lengths: ['0px', '4px', '12px', '0px'], arity: 4 }
  }
  if (hasTopLevelComma(raw)) return null
  const colorMatch = /#[\da-f]{6}(?:[\da-f]{2})?|rgba?\([^)]*\)/iu.exec(raw)
  if (colorMatch === null || parseColor(colorMatch[0]) === null) return null
  const colorFirst = raw.slice(0, colorMatch.index).trim() === ''
  const withoutColor = `${raw.slice(0, colorMatch.index)} ${raw.slice(colorMatch.index + colorMatch[0].length)}`
  const tokens = withoutColor.trim().split(/\s+/u).filter(Boolean)
  const insetIndex = tokens.indexOf('inset')
  const inset = insetIndex >= 0
  if (inset) tokens.splice(insetIndex, 1)
  if (tokens.length < 2 || tokens.length > 4 || tokens.some(token => parseNumeric(token) === null)) return null
  const unit = parseNumeric(tokens[0]!)?.unit ?? 'px'
  const zero = unit === '' ? '0' : `0${unit}`
  return {
    inset,
    color: colorMatch[0],
    colorFirst,
    lengths: [tokens[0]!, tokens[1]!, tokens[2] ?? zero, tokens[3] ?? zero],
    arity: tokens.length,
  }
}

export function serializeSimpleShadow(shadow: SimpleShadow): string {
  const lengths = shadow.lengths.slice(0, Math.max(2, shadow.arity)).join(' ')
  const inset = shadow.inset ? ' inset' : ''
  return shadow.colorFirst
    ? `${shadow.color} ${lengths}${inset}`
    : `${lengths} ${shadow.color}${inset}`
}

export type TransformKind = 'translateX' | 'translateY' | 'scaleX' | 'scaleY' | 'rotate'

export interface SimpleTransform {
  order: TransformKind[]
  values: Record<TransformKind, string>
}

const TRANSFORM_DEFAULTS: Record<TransformKind, string> = {
  translateX: '0px',
  translateY: '0px',
  scaleX: '1',
  scaleY: '1',
  rotate: '0deg',
}
const TRANSFORM_ORDER = Object.keys(TRANSFORM_DEFAULTS) as TransformKind[]

/** Parse a lossless subset while leaving matrices/unknown operations raw. */
export function parseSimpleTransform(value: string): SimpleTransform | null {
  const raw = value.trim()
  if (raw === 'none') return { order: [], values: { ...TRANSFORM_DEFAULTS } }
  const values = { ...TRANSFORM_DEFAULTS }
  const order: TransformKind[] = []
  const expression = /([a-zA-Z]+)\(([^()]*)\)/gu
  let cursor = 0
  for (const match of raw.matchAll(expression)) {
    if (match.index === undefined || raw.slice(cursor, match.index).trim() !== '') return null
    const kind = match[1] as TransformKind
    const argument = match[2]?.trim() ?? ''
    if (!TRANSFORM_ORDER.includes(kind) || order.includes(kind) || parseNumeric(argument) === null) return null
    if ((kind.startsWith('scale') && parseNumeric(argument)?.unit !== '') || (kind === 'rotate' && !['deg', 'rad', 'turn'].includes(parseNumeric(argument)?.unit ?? ''))) return null
    values[kind] = argument
    order.push(kind)
    cursor = match.index + match[0].length
  }
  if (order.length === 0 || raw.slice(cursor).trim() !== '') return null
  return { order, values }
}

export function serializeSimpleTransform(transform: SimpleTransform): string {
  const order = [...transform.order]
  for (const kind of TRANSFORM_ORDER) {
    if (!order.includes(kind) && transform.values[kind] !== TRANSFORM_DEFAULTS[kind]) order.push(kind)
  }
  return order.length === 0 ? 'none' : order.map(kind => `${kind}(${transform.values[kind]})`).join(' ')
}
