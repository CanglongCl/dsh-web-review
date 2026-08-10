import { useRef, useState } from 'react'
import { IconLinkOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  ColorControl,
  parseNumeric,
  ScrubNumber,
  TextField,
  ToggleButton,
} from './InspectorControls.tsx'
import {
  expandQuad,
  parseSimpleShadow,
  parseSimpleTransform,
  serializeQuad,
  serializeSimpleShadow,
  serializeSimpleTransform,
  type QuadValues,
  type TransformKind,
} from './composite-properties.ts'
import css from './CompositeControls.module.css'

function Cell({ badge, label, value, fallbackValue = '0px', onChange }: {
  badge: string
  label: string
  value: string
  fallbackValue?: string
  onChange: (value: string) => void
}) {
  return (
    <span className={css.fieldCell}>
      <ScrubNumber label={label} value={value} glyph={badge} fallbackValue={fallbackValue} onChange={onChange} />
    </span>
  )
}

function LinkToggle({ linked, linkLabel, unlinkLabel, onChange }: {
  linked: boolean
  linkLabel: string
  unlinkLabel: string
  onChange: (linked: boolean) => void
}) {
  const icon = linked
    ? <IconLinkOutline14 />
    : (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
        <path d="M5.25 4.1 6.4 2.95a2.4 2.4 0 0 1 3.4 3.4L8.65 7.5M8.75 9.9 7.6 11.05a2.4 2.4 0 0 1-3.4-3.4L5.35 6.5M2 2l10 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    )
  return (
    <span className={css.linkCell}>
      <ToggleButton label={linked ? unlinkLabel : linkLabel} pressed={linked} onToggle={() => { onChange(!linked) }}>
        {icon}
      </ToggleButton>
    </span>
  )
}

export function SizeControl({ width, height, labels, onWidthChange, onHeightChange }: {
  width: string
  height: string
  labels: { width: string; height: string; link: string; unlink: string }
  onWidthChange: (value: string) => void
  onHeightChange: (value: string) => void
}) {
  const [linked, setLinked] = useState(false)
  const ratio = useRef<number | null>(null)
  const toggle = (next: boolean) => {
    if (next) {
      const w = parseNumeric(width)
      const h = parseNumeric(height)
      ratio.current = w !== null && h !== null && h.number !== 0 ? w.number / h.number : null
    }
    setLinked(next)
  }
  const coupled = (next: string, fromWidth: boolean) => {
    const nextNumeric = parseNumeric(next)
    const other = parseNumeric(fromWidth ? height : width)
    const currentRatio = ratio.current
    if (linked && nextNumeric !== null && other !== null && currentRatio !== null && currentRatio !== 0) {
      const value = fromWidth ? nextNumeric.number / currentRatio : nextNumeric.number * currentRatio
      const rounded = Math.round(value * 1000) / 1000
      if (fromWidth) onHeightChange(`${rounded}${other.unit}`)
      else onWidthChange(`${rounded}${other.unit}`)
    }
    if (fromWidth) onWidthChange(next)
    else onHeightChange(next)
  }
  return (
    <span className={css.pair}>
      <Cell badge="W" label={labels.width} value={width} onChange={next => { coupled(next, true) }} />
      <Cell badge="H" label={labels.height} value={height} onChange={next => { coupled(next, false) }} />
      <LinkToggle linked={linked} linkLabel={labels.link} unlinkLabel={labels.unlink} onChange={toggle} />
    </span>
  )
}

export function RadiusControl({ label, value, cornerLabels, linkLabel, unlinkLabel, rawHint, onChange }: {
  label: string
  value: string
  cornerLabels: QuadValues
  linkLabel: string
  unlinkLabel: string
  rawHint: string
  onChange: (value: string) => void
}) {
  const parsed = expandQuad(value)
  const [linked, setLinked] = useState(() => parsed !== null && parsed.every(part => part === parsed[0]))
  if (parsed === null) return <span className={css.raw}><TextField label={label} value={value} onChange={onChange} /><span className={css.rawHint}>{rawHint}</span></span>
  const update = (index: number, next: string) => {
    const values: QuadValues = [...parsed]
    if (linked) values.fill(next)
    else values[index] = next
    onChange(serializeQuad(values, linked))
  }
  // CSS stores corners clockwise (TL, TR, BR, BL); the two-row control is
  // spatial, so its second row must render BL then BR.
  const visualOrder = [0, 1, 3, 2] as const
  const badges = ['↖', '↗', '↙', '↘'] as const
  return (
    <span className={css.quad}>
      {visualOrder.map((valueIndex, visualIndex) => <Cell
        key={valueIndex}
        badge={badges[visualIndex]!}
        label={cornerLabels[valueIndex]!}
        value={parsed[valueIndex]!}
        onChange={next => { update(valueIndex, next) }}
      />)}
      <LinkToggle linked={linked} linkLabel={linkLabel} unlinkLabel={unlinkLabel} onChange={setLinked} />
    </span>
  )
}

export function ShadowControl({ label, value, labels, rawHint, onChange }: {
  label: string
  value: string
  labels: { x: string; y: string; blur: string; spread: string; color: string; inset: string }
  rawHint: string
  onChange: (value: string) => void
}) {
  const parsed = parseSimpleShadow(value)
  if (parsed === null) return <span className={css.raw}><TextField label={label} value={value} onChange={onChange} /><span className={css.rawHint}>{rawHint}</span></span>
  const updateLength = (index: number, next: string) => {
    const shadow = { ...parsed, lengths: [...parsed.lengths] as QuadValues, arity: Math.max(parsed.arity, index + 1) }
    shadow.lengths[index] = next
    onChange(serializeSimpleShadow(shadow))
  }
  const fieldLabels = [labels.x, labels.y, labels.blur, labels.spread] as const
  const badges = ['X', 'Y', 'B', 'S'] as const
  return (
    <span>
      <span className={css.effectGrid}>
        {parsed.lengths.map((part, index) => <Cell key={badges[index]!} badge={badges[index]!} label={fieldLabels[index]!} value={part} onChange={next => { updateLength(index, next) }} />)}
      </span>
      <span className={css.effectRow}>
        <span className={css.effectLabel}>{labels.color}</span>
        <ColorControl label={labels.color} value={parsed.color} onChange={color => { onChange(serializeSimpleShadow({ ...parsed, color })) }} />
      </span>
      <span className={css.effectRow}>
        <span className={css.effectLabel}>{labels.inset}</span>
        <ToggleButton label={labels.inset} pressed={parsed.inset} onToggle={() => { onChange(serializeSimpleShadow({ ...parsed, inset: !parsed.inset })) }}>I</ToggleButton>
      </span>
    </span>
  )
}

export function TransformControl({ label, value, labels, rawHint, onChange }: {
  label: string
  value: string
  labels: Record<TransformKind, string>
  rawHint: string
  onChange: (value: string) => void
}) {
  const parsed = parseSimpleTransform(value)
  if (parsed === null) return <span className={css.raw}><TextField label={label} value={value} onChange={onChange} /><span className={css.rawHint}>{rawHint}</span></span>
  const update = (kind: TransformKind, next: string) => {
    onChange(serializeSimpleTransform({ ...parsed, values: { ...parsed.values, [kind]: next } }))
  }
  const badges: Record<TransformKind, string> = { translateX: 'X', translateY: 'Y', scaleX: 'SX', scaleY: 'SY', rotate: '°' }
  const kinds = Object.keys(badges) as TransformKind[]
  return (
    <span className={css.effectGrid}>
      {kinds.map(kind => <Cell
        key={kind}
        badge={badges[kind]}
        label={labels[kind]}
        value={parsed.values[kind]}
        fallbackValue={kind === 'scaleX' || kind === 'scaleY' ? '1' : kind === 'rotate' ? '0deg' : '0px'}
        onChange={next => { update(kind, next) }}
      />)}
    </span>
  )
}
