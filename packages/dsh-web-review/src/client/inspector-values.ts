/** Pure parsing/serialization helpers shared by inspector components. */

const NUMBER = /^\s*(-?(?:\d+\.?\d*|\.\d+))\s*([a-z%]*)\s*$/iu

export interface NumericValue {
  number: number
  unit: string
}

export function parseNumeric(value: string): NumericValue | null {
  const match = NUMBER.exec(value)
  if (match?.[1] === undefined) return null
  const number = Number(match[1])
  return Number.isFinite(number) ? { number, unit: match[2] ?? '' } : null
}

export function formatNumeric(number: number, unit: string): string {
  const rounded = Math.round(number * 1000) / 1000
  return `${String(Object.is(rounded, -0) ? 0 : rounded)}${unit}`
}

export interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

export function parseColor(value: string): Rgba | null {
  const hex = /^#([\da-f]{6})([\da-f]{2})?$/iu.exec(value.trim())
  if (hex?.[1] !== undefined) {
    return {
      r: Number.parseInt(hex[1].slice(0, 2), 16),
      g: Number.parseInt(hex[1].slice(2, 4), 16),
      b: Number.parseInt(hex[1].slice(4, 6), 16),
      a: hex[2] === undefined ? 1 : Number.parseInt(hex[2], 16) / 255,
    }
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*[,/]\s*(\d*\.?\d+)(%)?)?\s*\)$/iu.exec(value.trim())
  if (rgb === null) return null
  const [r, g, b] = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
  const a = rgb[4] === undefined ? 1 : Number(rgb[4]) / (rgb[5] === '%' ? 100 : 1)
  if ([r, g, b, a].some(part => !Number.isFinite(part)) || r > 255 || g > 255 || b > 255 || a > 1) return null
  return { r, g, b, a }
}

export function hexOf(color: Rgba): string {
  return `#${[color.r, color.g, color.b]
    .map(part => Math.max(0, Math.min(255, part)).toString(16).padStart(2, '0'))
    .join('')}`
}

export function cssColor(color: Rgba): string {
  return color.a >= 0.999
    ? hexOf(color)
    : `rgba(${color.r}, ${color.g}, ${color.b}, ${Math.round(color.a * 1000) / 1000})`
}
