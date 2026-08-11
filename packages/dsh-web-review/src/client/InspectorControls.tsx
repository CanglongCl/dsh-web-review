import { createPortal } from 'react-dom'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import {
  IconChevronDownOutline14,
  IconLinkOutline14,
  IconRefreshOutline14,
  Menu,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import clsx from 'clsx'
import { cssColor, formatNumeric, hexOf, parseColor, parseNumeric } from './inspector-values.ts'
import css from './InspectorControls.module.css'

export function InspectorSection({ label, children, defaultOpen = true, onOpenChange }: {
  label: string
  children: ReactNode
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className={css.section}>
      <button type="button" className={css.sectionHeader} aria-expanded={open} onClick={() => {
        setOpen((value) => {
          onOpenChange?.(!value)
          return !value
        })
      }}>
        <span>{label}</span>
        <IconChevronDownOutline14 className={clsx(css.sectionChevron, open && css.sectionChevronOpen)} />
      </button>
      {open && <div className={css.sectionBody}>{children}</div>}
    </section>
  )
}

export function InspectorRow({ label, children, changed = false, onReset, resetLabel, staticLabel = false, wide = false, active = false }: {
  label: string
  children: ReactNode
  changed?: boolean
  onReset?: () => void
  resetLabel?: string
  staticLabel?: boolean
  wide?: boolean
  active?: boolean
}) {
  return (
    <div
      className={clsx(css.row, wide && css.rowWide)}
      data-inspector-row=""
      {...(active ? { 'data-scrub-active': '' } : {})}
    >
      <span className={clsx(css.rowLabel, staticLabel && css.rowLabelStatic)}>{label}</span>
      <span className={css.rowControl}>
        {children}
        {changed && onReset !== undefined && (
          <button type="button" className={css.reset} aria-label={resetLabel} title={resetLabel} onClick={onReset}>
            <IconRefreshOutline14 />
          </button>
        )}
        {(!changed || onReset === undefined) && <span className={css.resetPlaceholder} aria-hidden />}
      </span>
    </div>
  )
}

export function OptionMenu({ label, value, options, onChange }: {
  label: string
  value: string
  options: readonly string[]
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const items: MenuEntry[] = (options.includes(value) ? options : [value, ...options]).map(option => ({ id: option, label: option }))
  const close = () => { setOpen(false); queueMicrotask(() => { triggerRef.current?.focus() }) }
  return (
    <Menu
      open={open}
      compact
      portal
      align="end"
      items={items}
      selectedId={value}
      onSelect={(next) => { onChange(next); close() }}
      onClose={close}
      anchor={(
        <button ref={triggerRef} type="button" className={css.menuTrigger} aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => { setOpen(next => !next) }}>
          <span className={css.menuValue}>{value}</span>
          <IconChevronDownOutline14 className={css.menuChevron} />
        </button>
      )}
    />
  )
}

export interface SegmentOption { value: string; label: string; content: ReactNode }

export function SegmentedControl({ label, value, options, onChange }: {
  label: string
  value: string
  options: readonly SegmentOption[]
  onChange: (value: string) => void
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  return (
    <span className={css.segments} role="group" aria-label={label}>
      {options.map((option, index) => (
        <button
          key={option.value}
          ref={(node) => { refs.current[index] = node }}
          type="button"
          className={clsx(css.toggle, value === option.value && css.toggleActive)}
          aria-label={option.label}
          aria-pressed={value === option.value}
          title={option.label}
          onClick={() => { onChange(option.value) }}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
            event.preventDefault()
            const delta = event.key === 'ArrowRight' ? 1 : -1
            const next = (index + delta + options.length) % options.length
            const optionAt = options[next]
            if (optionAt !== undefined) onChange(optionAt.value)
            refs.current[next]?.focus()
          }}
        >{option.content}</button>
      ))}
    </span>
  )
}

export function ToggleButton({ label, pressed, onToggle, children }: {
  label: string
  pressed: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <button type="button" className={clsx(css.toggle, pressed && css.toggleActive)} aria-label={label} title={label} aria-pressed={pressed} onClick={onToggle}>
      {children}
    </button>
  )
}

export function ToggleGroup({ children }: { children: ReactNode }) {
  return <span className={css.toggleGroup}>{children}</span>
}

export function TextField({ label, value, onChange, invalid = false }: {
  label: string
  value: string
  onChange: (value: string) => void
  invalid?: boolean
}) {
  const focusValue = useRef(value)
  return (
    <input
      className={clsx(css.field, invalid && css.invalid)}
      aria-label={label}
      value={value}
      onFocus={() => { focusValue.current = value }}
      onChange={event => { onChange(event.target.value) }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        onChange(focusValue.current)
        event.currentTarget.blur()
      }}
    />
  )
}

export function TextAreaField({ label, value, maxLength, onChange }: {
  label: string
  value: string
  maxLength?: number
  onChange: (value: string) => void
}) {
  const focusValue = useRef(value)
  return (
    <textarea
      className={css.textArea}
      data-webview-text-content=""
      aria-label={label}
      value={value}
      rows={2}
      {...(maxLength === undefined ? {} : { maxLength })}
      onFocus={() => { focusValue.current = value }}
      onChange={event => { onChange(event.target.value) }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        onChange(focusValue.current)
        event.currentTarget.blur()
      }}
    />
  )
}

export function StyleGlyph({ kind }: { kind: 'bold' | 'italic' | 'underline' }) {
  return <span className={kind === 'italic' ? css.italicGlyph : kind === 'underline' ? css.underlineGlyph : undefined}>{kind === 'bold' ? 'B' : kind === 'italic' ? 'I' : 'U'}</span>
}

export function ScrubNumber({ label, value, onChange, onScrubChange, step = 1, min, max, glyph = '↔', fallbackValue, invalid = false }: {
  label: string
  value: string
  onChange: (value: string) => void
  onScrubChange?: ((active: boolean) => void) | undefined
  step?: number
  min?: number
  max?: number
  glyph?: ReactNode
  fallbackValue?: string
  invalid?: boolean
}) {
  const drag = useRef<{ x: number; value: number; unit: string; started: boolean } | null>(null)
  const scrubChangeRef = useRef(onScrubChange)
  scrubChangeRef.current = onScrubChange
  const focusValue = useRef(value)
  const clamp = (number: number) => Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, number))
  const numericValue = () => parseNumeric(value) ?? (fallbackValue === undefined ? null : parseNumeric(fallbackValue))
  const canScrub = numericValue() !== null
  const increment = (delta: number) => {
    const parsed = numericValue()
    if (parsed === null) return
    onChange(formatNumeric(clamp(parsed.number + delta), parsed.unit))
  }
  const finishDrag = (restore: boolean): void => {
    const current = drag.current
    if (current === null) return
    if (restore && current.started) onChange(formatNumeric(current.value, current.unit))
    if (current.started) scrubChangeRef.current?.(false)
    drag.current = null
  }
  useEffect(() => () => {
    if (drag.current?.started === true) scrubChangeRef.current?.(false)
  }, [])
  return (
    <span className={css.numberWrap} data-webview-scrub-control="">
      <button
        type="button"
        className={css.numberHandle}
        data-webview-scrub-handle=""
        aria-label={`${label} · 拖动调整`}
        title={canScrub ? `${label} · 拖动调整` : `${label} · 当前值仅支持文本编辑`}
        disabled={!canScrub}
        onPointerDown={(event) => {
          const parsed = numericValue()
          if (parsed === null) return
          drag.current = { x: event.clientX, value: parsed.number, unit: parsed.unit, started: false }
          event.currentTarget.setPointerCapture?.(event.pointerId)
        }}
        onPointerMove={(event) => {
          const current = drag.current
          if (current === null) return
          const delta = event.clientX - current.x
          if (!current.started && Math.abs(delta) < 3) return
          if (!current.started) {
            current.started = true
            scrubChangeRef.current?.(true)
          }
          onChange(formatNumeric(clamp(current.value + delta * step), current.unit))
        }}
        onPointerUp={() => { finishDrag(false) }}
        onPointerCancel={() => { finishDrag(true) }}
        onLostPointerCapture={() => { finishDrag(false) }}
      >{glyph}</button>
      <input
        className={clsx(css.field, invalid && css.invalid)}
        aria-label={label}
        role="spinbutton"
        value={value}
        inputMode="decimal"
        {...(parseNumeric(value) === null ? {} : { 'aria-valuenow': parseNumeric(value)!.number })}
        {...(min === undefined ? {} : { 'aria-valuemin': min })}
        {...(max === undefined ? {} : { 'aria-valuemax': max })}
        aria-valuetext={value}
        onFocus={() => { focusValue.current = value }}
        onChange={event => { onChange(event.target.value) }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onChange(focusValue.current)
            event.currentTarget.blur()
            return
          }
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
          event.preventDefault()
          const factor = event.shiftKey ? 10 : event.altKey ? 0.1 : 1
          increment((event.key === 'ArrowUp' ? step : -step) * factor)
        }}
      />
    </span>
  )
}

export function ColorControl({ label, value, onChange, onScrubChange }: { label: string; value: string; onChange: (value: string) => void; onScrubChange?: ((active: boolean) => void) | undefined }) {
  const parsed = parseColor(value)
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const color = parsed ?? { r: 0, g: 0, b: 0, a: 1 }
  useLayoutEffect(() => {
    if (!open || triggerRef.current === null) return
    const rect = triggerRef.current.getBoundingClientRect()
    const popoverWidth = popoverRef.current?.offsetWidth ?? Math.min(236, window.innerWidth - 16)
    const popoverHeight = popoverRef.current?.offsetHeight ?? 170
    setPosition({
      left: Math.max(8, Math.min(window.innerWidth - popoverWidth - 8, rect.right - popoverWidth)),
      top: Math.max(8, Math.min(window.innerHeight - popoverHeight - 8, rect.bottom + 4)),
    })
    queueMicrotask(() => { popoverRef.current?.querySelector<HTMLElement>('input, button')?.focus() })
  }, [open])
  useEffect(() => {
    if (!open) return
    const down = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return
      if (popoverRef.current?.contains(event.target) === true || triggerRef.current?.contains(event.target) === true) return
      setOpen(false)
    }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); triggerRef.current?.focus() } }
    document.addEventListener('pointerdown', down)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', down); document.removeEventListener('keydown', key) }
  }, [open])
  return (
    <>
      <button ref={triggerRef} type="button" className={css.colorTrigger} aria-label={label} aria-haspopup="dialog" aria-expanded={open} onClick={() => { setOpen(next => !next) }}>
        <span className={css.swatch}><span className={css.swatchFill} style={{ background: value }} /></span>
        <span className={css.colorValue}>{parsed === null ? value : hexOf(color)}</span>
      </button>
      {open && createPortal(
        <div
          ref={popoverRef}
          className={css.popover}
          style={position}
          role="dialog"
          aria-modal="true"
          aria-label={`${label} · 颜色选择器`}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              setOpen(false)
              queueMicrotask(() => { triggerRef.current?.focus() })
              return
            }
            if (event.key !== 'Tab' || popoverRef.current === null) return
            const focusable = [...popoverRef.current.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)')]
            if (focusable.length === 0) return
            const current = focusable.indexOf(document.activeElement as HTMLElement)
            const next = event.shiftKey
              ? (current <= 0 ? focusable.length - 1 : current - 1)
              : (current >= focusable.length - 1 ? 0 : current + 1)
            event.preventDefault()
            focusable[next]?.focus()
          }}
        >
          <input className={css.spectrum} type="color" aria-label={`${label} · 色谱`} value={hexOf(color)} onChange={(event) => {
            const next = parseColor(event.target.value)
            if (next !== null) onChange(cssColor({ ...next, a: color.a }))
          }} />
          <div className={css.popoverRow}>
            <label><span className={css.popoverLabel}>Hex</span><input className={css.field} aria-label={`${label} · Hex`} value={parsed === null ? value : hexOf(color)} onChange={event => {
              const next = parseColor(event.target.value)
              if (next !== null) onChange(cssColor({ ...next, a: color.a }))
              else onChange(event.target.value)
            }} /></label>
            <label><span className={css.popoverLabel}>Alpha</span><ScrubNumber label={`${label} · 透明度`} value={`${String(Math.round(color.a * 100))}%`} min={0} max={100} onScrubChange={onScrubChange} onChange={(next) => {
              const numeric = parseNumeric(next)
              if (numeric !== null) onChange(cssColor({ ...color, a: numeric.number / 100 }))
            }} /></label>
          </div>
        </div>, document.body,
      )}
    </>
  )
}

export interface BoxModelLinks {
  vertical: boolean
  horizontal: boolean
  all: boolean
}

export function updateBoxModelLinks(links: BoxModelLinks, axis: keyof BoxModelLinks, linked: boolean): BoxModelLinks {
  if (axis === 'all') {
    return linked
      ? { vertical: true, horizontal: true, all: true }
      : { vertical: true, horizontal: true, all: false }
  }
  return { ...links, [axis]: linked, all: false }
}

export function BoxModelControl({ label, sideLabels, values, links, min, linkLabel, unlinkLabel, linkAllLabel, unlinkAllLabel, onLinkChange, onChange, onScrubChange }: {
  label: string
  sideLabels: readonly [string, string, string, string]
  values: readonly [string, string, string, string]
  links: BoxModelLinks
  min?: number
  linkLabel: string
  unlinkLabel: string
  linkAllLabel: string
  unlinkAllLabel: string
  onLinkChange: (axis: keyof BoxModelLinks, linked: boolean) => void
  onChange: (index: number, value: string) => void
  onScrubChange?: ((active: boolean) => void) | undefined
}) {
  const glyphs = ['↑', '→', '↓', '←'] as const
  const update = (index: number, next: string) => {
    onChange(index, next)
    if (links.all) {
      values.forEach((_, otherIndex) => { if (otherIndex !== index) onChange(otherIndex, next) })
      return
    }
    if (links.vertical && index === 0) onChange(2, next)
    if (links.vertical && index === 2) onChange(0, next)
    if (links.horizontal && index === 1) onChange(3, next)
    if (links.horizontal && index === 3) onChange(1, next)
  }
  const field = (index: number) => <ScrubNumber
    label={sideLabels[index] ?? label}
    value={values[index] ?? ''}
    glyph={glyphs[index] ?? '↔'}
    {...(min === undefined ? {} : { min })}
    onScrubChange={onScrubChange}
    onChange={next => { update(index, next) }}
  />
  const axis = (first: number, second: number, key: keyof BoxModelLinks) => {
    const linked = links[key]
    const sides = `${sideLabels[first] ?? label} / ${sideLabels[second] ?? label}`
    const action = linked ? unlinkLabel : linkLabel
    const buttonLabel = `${action} · ${sides}`
    return (
      <span className={css.boxAxis}>
        {field(first)}
        {!links.all && (
          <ToggleButton label={buttonLabel} pressed={linked} onToggle={() => { onLinkChange(key, !linked) }}>
            <IconLinkOutline14 />
          </ToggleButton>
        )}
        {links.all && <span aria-hidden />}
        {field(second)}
      </span>
    )
  }
  const canMerge = links.vertical && links.horizontal && !links.all
  return (
    <span className={clsx(css.boxModelWrap, canMerge && css.boxModelMergeReady, links.all && css.boxModelAllLinked)} role="group" aria-label={label}>
      {axis(0, 2, 'vertical')}
      {axis(3, 1, 'horizontal')}
      {canMerge && (
        <span className={css.boxAllLink}>
          <ToggleButton label={linkAllLabel} pressed={false} onToggle={() => { onLinkChange('all', true) }}>
            <IconLinkOutline14 />
          </ToggleButton>
        </span>
      )}
      {links.all && (
        <span className={css.boxAllLink}>
          <ToggleButton label={unlinkAllLabel} pressed onToggle={() => { onLinkChange('all', false) }}>
            <IconLinkOutline14 />
          </ToggleButton>
        </span>
      )}
    </span>
  )
}
