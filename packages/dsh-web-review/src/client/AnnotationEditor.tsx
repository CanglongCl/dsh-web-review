import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { IconCheckOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  AnnotationStyleChange,
  AnnotationTextChange,
  AnnotationViewport,
} from '../annotation-contract.ts'
import {
  isSafeAnnotationStyleValue,
  type EditableStyleProperty,
} from '../annotation-properties.ts'
import {
  applyCommitted,
  baselineValue,
  previewStyle,
  previewText,
  restoreAll,
  restoreStyle,
  restoreText,
  type LiveElementPatch,
} from './live-patch.ts'
import {
  BoxModelControl,
  ColorControl,
  InspectorRow,
  InspectorSection,
  OptionMenu,
  parseNumeric,
  ScrubNumber,
  SegmentedControl,
  StyleGlyph,
  TextAreaField,
  TextField,
  ToggleButton,
  ToggleGroup,
} from './InspectorControls.tsx'
import { PROPERTY_BY_NAME, PROPERTY_GROUPS, type PropertyControl } from './property-editor-config.ts'
import type { WebviewKey } from './locales.ts'
import { RadiusControl, ShadowControl, SizeControl, TransformControl } from './CompositeControls.tsx'
import css from './AnnotationEditor.module.css'

export interface AnnotationEditorValue {
  comment: string
  changes: AnnotationStyleChange[]
  textChange: AnnotationTextChange | null
  viewport: AnnotationViewport
}

export interface AnnotationEditorProps {
  id: string
  patch: LiveElementPatch
  frame: HTMLIFrameElement
  comment: string
  changes: readonly AnnotationStyleChange[]
  textChange: AnnotationTextChange | null | undefined
  t: Translate<WebviewKey>
  onCancel: () => void
  onConfirm: (value: AnnotationEditorValue) => void
}

function validCssValue(element: Element, property: EditableStyleProperty, value: string): boolean {
  if (!isSafeAnnotationStyleValue(value)) return false
  const probe = element.ownerDocument.createElement('div').style
  probe.setProperty(property, value)
  return probe.getPropertyValue(property) !== ''
}

function AdjustIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M2 4h4m3 0h5M2 12h5m3 0h4M6 2v4m4 4v4" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
      <circle cx="7.5" cy="4" r="1.5" fill="white" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="8.5" cy="12" r="1.5" fill="white" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

function AlignIcon({ kind }: { kind: 'left' | 'center' | 'right' | 'justify' }) {
  const widths = kind === 'justify' ? [12, 12, 12] : [12, 8, 11]
  const x = (width: number) => kind === 'center' ? (14 - width) / 2 : kind === 'right' ? 14 - width : 0
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      {widths.map((width, index) => <rect key={index} x={x(width)} y={2 + index * 4} width={width} height="1.4" rx=".7" fill="currentColor" />)}
    </svg>
  )
}

function propertyLabel(control: PropertyControl, t: Translate<WebviewKey>): string {
  return t(control.labelKey)
}

const four = <T,>(values: readonly T[]): [T, T, T, T] => [values[0]!, values[1]!, values[2]!, values[3]!]

/** Host-owned, DSH-styled property inspector with reversible iframe preview. */
export function AnnotationEditor({
  patch, frame, comment: initialComment, changes: initialChanges,
  textChange: initialTextChange, t, onCancel, onConfirm,
}: AnnotationEditorProps) {
  const initialMap = useMemo(() => new Map(initialChanges.map(change => [change.property, change])), [initialChanges])
  const originals = useMemo(() => new Map(
    PROPERTY_GROUPS.flatMap(group => group.controls).map(({ property }) => [
      property,
      initialMap.get(property)?.before ?? baselineValue(patch, property),
    ]),
  ), [initialMap, patch])
  const [comment, setComment] = useState(initialComment)
  const [expanded, setExpanded] = useState(false)
  const [values, setValues] = useState<Map<EditableStyleProperty, string>>(
    () => new Map([...originals].map(([property, before]) => [property, initialMap.get(property)?.after ?? before])),
  )
  const [invalid, setInvalid] = useState<Set<EditableStyleProperty>>(new Set())
  const originalText = patch.originalText?.value
  const [text, setText] = useState(initialTextChange?.after ?? originalText ?? '')
  const [marginLinked, setMarginLinked] = useState(false)
  const [paddingLinked, setPaddingLinked] = useState(false)
  const [flexControlsSeen, setFlexControlsSeen] = useState(() => {
    const display = initialMap.get('display')?.after ?? originals.get('display')
    return display === 'flex' || display === 'inline-flex'
  })
  const [layoutControlsSeen, setLayoutControlsSeen] = useState(() => {
    const display = initialMap.get('display')?.after ?? originals.get('display')
    return display === 'flex' || display === 'inline-flex' || display === 'grid'
  })
  const [positionControlsSeen, setPositionControlsSeen] = useState(() => {
    const position = initialMap.get('position')?.after ?? originals.get('position')
    return position !== 'static'
  })
  const normalWeightRef = useRef('400')
  const normalStyleRef = useRef('normal')
  const [, forcePosition] = useState(0)
  const editorRef = useRef<HTMLDivElement | null>(null)

  const valueOf = (property: EditableStyleProperty): string => values.get(property) ?? originals.get(property) ?? ''
  const changed = (property: EditableStyleProperty): boolean => valueOf(property) !== (originals.get(property) ?? '')
  const currentChanges = (): AnnotationStyleChange[] => [...originals].flatMap(([property, before]) => {
    const after = valueOf(property)
    return after === before ? [] : [{ property, before, after }]
  })

  useEffect(() => {
    const win = frame.contentWindow
    if (win === null) return
    const reposition = () => { forcePosition(value => value + 1) }
    win.addEventListener('scroll', reposition, true)
    win.addEventListener('resize', reposition)
    return () => {
      win.removeEventListener('scroll', reposition, true)
      win.removeEventListener('resize', reposition)
    }
  }, [frame])

  useEffect(() => { forcePosition(value => value + 1) }, [expanded])

  const cancel = (): void => {
    restoreAll(patch)
    applyCommitted(patch, initialChanges, initialTextChange)
    onCancel()
  }

  const textChanged = originalText !== undefined && text !== originalText
  const dirty = comment.trim() !== '' || currentChanges().length > 0 || textChanged
  const canConfirm = invalid.size === 0 && dirty

  const confirm = (): void => {
    if (!canConfirm) return
    const viewport = {
      width: Math.round(frame.contentWindow?.innerWidth ?? frame.clientWidth),
      height: Math.round(frame.contentWindow?.innerHeight ?? frame.clientHeight),
    }
    onConfirm({
      comment,
      changes: currentChanges(),
      textChange: textChanged ? { before: initialTextChange?.before ?? originalText, after: text } : null,
      viewport,
    })
  }

  const updateProperty = (property: EditableStyleProperty, next: string): void => {
    setValues(current => new Map(current).set(property, next))
    const before = originals.get(property) ?? ''
    if (next === before) {
      restoreStyle(patch, property)
      setInvalid(current => { const copy = new Set(current); copy.delete(property); return copy })
      return
    }
    if (next.trim() === '' || !validCssValue(patch.element, property, next)) {
      setInvalid(current => new Set(current).add(property))
      return
    }
    setInvalid(current => { const copy = new Set(current); copy.delete(property); return copy })
    previewStyle(patch, property, next)
  }

  const updateText = (next: string): void => {
    setText(next)
    if (originalText === undefined) return
    if (next === originalText) restoreText(patch)
    else previewText(patch, next)
  }

  const reset = (property: EditableStyleProperty): void => { updateProperty(property, originals.get(property) ?? '') }

  const numericFallback = (property: EditableStyleProperty): string => {
    if (property === 'line-height') {
      const fontSize = parseNumeric(valueOf('font-size'))
      return fontSize === null ? '16px' : `${String(Math.round(fontSize.number * 1.2 * 1000) / 1000)}${fontSize.unit || 'px'}`
    }
    if (property === 'letter-spacing' || property === 'gap' || property === 'row-gap' || property === 'column-gap') return '0px'
    if (property === 'z-index') return '0'
    if (property === 'opacity') return '100%'
    return '0px'
  }

  const renderControl = (property: EditableStyleProperty): ReactNode => {
    const control = PROPERTY_BY_NAME.get(property)
    if (control === undefined) return null
    const label = propertyLabel(control, t)
    const value = valueOf(property)
    if (control.kind === 'color') return <ColorControl label={label} value={value} onChange={next => { updateProperty(property, next) }} />
    if (control.kind === 'menu') return <OptionMenu label={label} value={value} options={control.options ?? []} onChange={next => { updateProperty(property, next) }} />
    if (property === 'opacity') {
      const normalized = value.trim() === '' ? '1' : value
      const parsed = /^\s*(\d*\.?\d+)\s*$/u.exec(normalized)
      const displayValue = parsed?.[1] === undefined ? normalized : `${String(Math.round(Number(parsed[1]) * 10_000) / 100)}%`
      return (
        <ScrubNumber
          label={label}
          value={displayValue}
          min={0}
          max={100}
          invalid={invalid.has(property)}
          onChange={(next) => {
            const percent = /^\s*(\d*\.?\d+)\s*%?\s*$/u.exec(next)
            updateProperty(property, percent?.[1] === undefined ? next : String(Number(percent[1]) / 100))
          }}
        />
      )
    }
    if (control.kind === 'number') return (
      <ScrubNumber
        label={label}
        value={value}
        fallbackValue={numericFallback(property)}
        invalid={invalid.has(property)}
        onChange={next => { updateProperty(property, next) }}
        {...(control.step === undefined ? {} : { step: control.step })}
        {...(control.min === undefined ? {} : { min: control.min })}
        {...(control.max === undefined ? {} : { max: control.max })}
        {...(control.glyph === undefined ? {} : { glyph: control.glyph })}
      />
    )
    return <TextField label={label} value={value} invalid={invalid.has(property)} onChange={next => { updateProperty(property, next) }} />
  }

  const row = (property: EditableStyleProperty) => {
    const control = PROPERTY_BY_NAME.get(property)
    if (control === undefined) return null
    const label = propertyLabel(control, t)
    return (
      <InspectorRow key={property} label={label} changed={changed(property)} resetLabel={`${t('editor.reset')} · ${label}`} onReset={() => { reset(property) }}>
        {renderControl(property)}
      </InspectorRow>
    )
  }

  const weight = Number(valueOf('font-weight'))
  const bold = Number.isFinite(weight) && weight >= 600
  const style = valueOf('font-style')
  const decorationTokens = valueOf('text-decoration').split(/\s+/u).filter(token => token !== '' && token !== 'none')
  const underlined = decorationTokens.includes('underline')
  const align = valueOf('text-align')
  const display = valueOf('display')
  const flex = display === 'flex' || display === 'inline-flex'
  const layout = flex || display === 'grid'
  const positioned = valueOf('position') !== 'static'
    || (['top', 'right', 'bottom', 'left', 'z-index'] as const).some(property => valueOf(property) !== 'auto')
  useEffect(() => { if (flex) setFlexControlsSeen(true) }, [flex])
  useEffect(() => { if (layout) setLayoutControlsSeen(true) }, [layout])
  useEffect(() => { if (positioned) setPositionControlsSeen(true) }, [positioned])
  const showFlexControls = flex || flexControlsSeen
  const showLayoutControls = layout || layoutControlsSeen
  const showPositionControls = positioned || positionControlsSeen

  const spacing = (prefix: 'margin' | 'padding', linked: boolean, setLinked: (value: boolean) => void) => {
    const properties = four(['top', 'right', 'bottom', 'left'].map(side => `${prefix}-${side}` as EditableStyleProperty))
    return (
      <InspectorRow label={prefix === 'margin' ? 'Margin' : 'Padding'} staticLabel changed={properties.some(changed)} resetLabel={`${t('editor.reset')} · ${prefix}`} onReset={() => { properties.forEach(reset) }}>
        <BoxModelControl
          label={prefix === 'margin' ? 'Margin' : 'Padding'}
          values={four(properties.map(valueOf))}
          linked={linked}
          onLinkedChange={setLinked}
          onChange={(index, next) => {
            if (linked) properties.forEach(property => { updateProperty(property, next) })
            else { const property = properties[index]; if (property !== undefined) updateProperty(property, next) }
          }}
        />
      </InspectorRow>
    )
  }

  const rect = patch.element.getBoundingClientRect()
  const width = expanded ? Math.min(400, Math.max(280, frame.clientWidth - 16)) : Math.min(330, Math.max(240, frame.clientWidth - 16))
  const measuredHeight = editorRef.current?.offsetHeight ?? (expanded ? 560 : 54)
  const left = Math.min(Math.max(8, rect.left), Math.max(8, frame.clientWidth - width - 8))
  const above = rect.top - measuredHeight - 8
  const largeTarget = rect.height >= frame.clientHeight * 0.6
  const top = largeTarget
    ? Math.min(Math.max(8, rect.top + 16), Math.max(8, frame.clientHeight - measuredHeight - 8))
    : Math.max(8, above >= 8 ? above : Math.min(rect.bottom + 8, Math.max(8, frame.clientHeight - measuredHeight - 8)))

  return (
    <div
      ref={editorRef}
      className={css.editor}
      style={{ left, top, width }}
      data-webview-annotation-editor=""
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return
        event.preventDefault()
        cancel()
      }}
    >
      <div className={css.composeRow}>
        <button type="button" className={expanded ? `${css.adjust} ${css.adjustActive}` : css.adjust} aria-label={t('editor.adjust')} title={t('editor.adjust')} aria-expanded={expanded} onClick={() => { setExpanded(value => !value) }}>
          <AdjustIcon />
        </button>
        <input
          className={`${css.commentInput} dsh-wv-comment-input`}
          value={comment}
          maxLength={4000}
          placeholder={t('editor.comment')}
          autoFocus
          onChange={event => { setComment(event.target.value) }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') { event.preventDefault(); cancel() }
            if (event.key === 'Enter') { event.preventDefault(); confirm() }
          }}
        />
        {!expanded && (
          <button type="button" className={css.quickConfirm} aria-label={t('editor.confirm')} disabled={!canConfirm} onClick={confirm}>
            <IconCheckOutline16 size={16} />
          </button>
        )}
      </div>

      {expanded && (
        <>
          <div className={css.inspector} data-webview-property-inspector="">
            {originalText !== undefined && (
              <InspectorSection label={t('editor.text')}>
                <InspectorRow wide label={t('editor.text')} changed={textChanged} resetLabel={t('editor.reset')} onReset={() => { updateText(originalText) }}>
                  <TextAreaField label={t('editor.text')} value={text} onChange={updateText} />
                </InspectorRow>
              </InspectorSection>
            )}

            <InspectorSection label={t('editor.group.fill')}>
              {row('color')}{row('background-color')}{row('opacity')}
            </InspectorSection>

            <InspectorSection label={t('editor.group.typography')}>
              {row('font-family')}
              <InspectorRow label={t('editor.property.fontStyle')} changed={changed('font-weight') || changed('font-style') || changed('text-decoration')} resetLabel={`${t('editor.reset')} · ${t('editor.property.fontStyle')}`} onReset={() => { reset('font-weight'); reset('font-style'); reset('text-decoration') }}>
                <ToggleGroup>
                  <ToggleButton label={t('editor.action.bold')} pressed={bold} onToggle={() => {
                    if (bold) updateProperty('font-weight', normalWeightRef.current)
                    else { normalWeightRef.current = valueOf('font-weight'); updateProperty('font-weight', '700') }
                  }}><StyleGlyph kind="bold" /></ToggleButton>
                  <ToggleButton label={t('editor.action.italic')} pressed={style === 'italic' || style === 'oblique'} onToggle={() => {
                    if (style === 'italic' || style === 'oblique') updateProperty('font-style', normalStyleRef.current)
                    else { normalStyleRef.current = style; updateProperty('font-style', 'italic') }
                  }}><StyleGlyph kind="italic" /></ToggleButton>
                  <ToggleButton label={t('editor.action.underline')} pressed={underlined} onToggle={() => {
                    const next = underlined ? decorationTokens.filter(token => token !== 'underline') : [...decorationTokens, 'underline']
                    updateProperty('text-decoration', next.length === 0 ? 'none' : next.join(' '))
                  }}><StyleGlyph kind="underline" /></ToggleButton>
                </ToggleGroup>
              </InspectorRow>
              {row('font-weight')}{row('font-size')}{row('line-height')}{row('letter-spacing')}
              <InspectorRow label={t('editor.property.textAlign')} changed={changed('text-align')} resetLabel={`${t('editor.reset')} · ${t('editor.property.textAlign')}`} onReset={() => { reset('text-align') }}>
                <SegmentedControl
                  label={t('editor.property.textAlign')}
                  value={['left', 'center', 'right', 'justify'].includes(align) ? align : 'left'}
                  options={[
                    { value: 'left', label: t('editor.action.alignLeft'), content: <AlignIcon kind="left" /> },
                    { value: 'center', label: t('editor.action.alignCenter'), content: <AlignIcon kind="center" /> },
                    { value: 'right', label: t('editor.action.alignRight'), content: <AlignIcon kind="right" /> },
                    { value: 'justify', label: t('editor.action.justify'), content: <AlignIcon kind="justify" /> },
                  ]}
                  onChange={next => { updateProperty('text-align', next) }}
                />
              </InspectorRow>
              {row('text-decoration')}{row('text-transform')}
            </InspectorSection>

            <InspectorSection label={t('editor.group.size')}>
              <InspectorRow
                wide
                label={`${t('editor.property.width')} × ${t('editor.property.height')}`}
                changed={changed('width') || changed('height')}
                resetLabel={`${t('editor.reset')} · ${t('editor.group.size')}`}
                onReset={() => { reset('width'); reset('height') }}
              >
                <SizeControl
                  width={valueOf('width')}
                  height={valueOf('height')}
                  labels={{
                    width: t('editor.property.width'),
                    height: t('editor.property.height'),
                    link: t('editor.action.linkValues'),
                    unlink: t('editor.action.unlinkValues'),
                  }}
                  onWidthChange={next => { updateProperty('width', next) }}
                  onHeightChange={next => { updateProperty('height', next) }}
                />
              </InspectorRow>
              {row('display')}{row('position')}
              {showFlexControls && <>{row('flex-direction')}{row('flex-wrap')}</>}
              {showLayoutControls && <>{row('justify-content')}{row('align-items')}{row('align-content')}{row('gap')}{row('row-gap')}{row('column-gap')}</>}
              {row('overflow')}
            </InspectorSection>

            <InspectorSection label={t('editor.group.spacing')}>
              {spacing('margin', marginLinked, setMarginLinked)}
              {spacing('padding', paddingLinked, setPaddingLinked)}
            </InspectorSection>

            <InspectorSection label={t('editor.group.border')}>
              {row('border-width')}{row('border-style')}{row('border-color')}
              <InspectorRow wide label={t('editor.property.borderRadius')} changed={changed('border-radius')} resetLabel={`${t('editor.reset')} · ${t('editor.property.borderRadius')}`} onReset={() => { reset('border-radius') }}>
                <RadiusControl
                  label={t('editor.property.borderRadius')}
                  value={valueOf('border-radius')}
                  cornerLabels={[
                    t('editor.property.cornerTopLeft'), t('editor.property.cornerTopRight'),
                    t('editor.property.cornerBottomRight'), t('editor.property.cornerBottomLeft'),
                  ]}
                  linkLabel={t('editor.action.linkValues')}
                  unlinkLabel={t('editor.action.unlinkValues')}
                  rawHint={t('editor.rawHint')}
                  onChange={next => { updateProperty('border-radius', next) }}
                />
              </InspectorRow>
            </InspectorSection>

            <InspectorSection label={t('editor.group.constraints')} defaultOpen={showPositionControls}>
              {row('min-width')}{row('max-width')}{row('min-height')}{row('max-height')}
              {showPositionControls && <>{row('top')}{row('right')}{row('bottom')}{row('left')}{row('z-index')}</>}
            </InspectorSection>

            <InspectorSection label={t('editor.group.effects')} defaultOpen={false}>
              <InspectorRow wide label={t('editor.property.boxShadow')} changed={changed('box-shadow')} resetLabel={`${t('editor.reset')} · ${t('editor.property.boxShadow')}`} onReset={() => { reset('box-shadow') }}>
                <ShadowControl
                  label={t('editor.property.boxShadow')}
                  value={valueOf('box-shadow')}
                  rawHint={t('editor.rawHint')}
                  labels={{
                    x: t('editor.property.shadowX'), y: t('editor.property.shadowY'),
                    blur: t('editor.property.shadowBlur'), spread: t('editor.property.shadowSpread'),
                    color: t('editor.property.shadowColor'), inset: t('editor.property.shadowInset'),
                  }}
                  onChange={next => { updateProperty('box-shadow', next) }}
                />
              </InspectorRow>
              <InspectorRow wide label={t('editor.property.transform')} changed={changed('transform')} resetLabel={`${t('editor.reset')} · ${t('editor.property.transform')}`} onReset={() => { reset('transform') }}>
                <TransformControl
                  label={t('editor.property.transform')}
                  value={valueOf('transform')}
                  rawHint={t('editor.rawHint')}
                  labels={{
                    translateX: t('editor.property.translateX'), translateY: t('editor.property.translateY'),
                    scaleX: t('editor.property.scaleX'), scaleY: t('editor.property.scaleY'), rotate: t('editor.property.rotate'),
                  }}
                  onChange={next => { updateProperty('transform', next) }}
                />
              </InspectorRow>
            </InspectorSection>
          </div>
          <div className={css.footer} data-webview-editor-footer="">
            <button type="button" className={css.cancel} onClick={cancel}>{t('editor.cancel')}</button>
            <button type="button" className={css.confirm} aria-label={t('editor.confirm')} disabled={!canConfirm} onClick={confirm}>
              <IconCheckOutline16 size={16} />
            </button>
          </div>
        </>
      )}
    </div>
  )
}
