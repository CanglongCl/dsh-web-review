import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { IconCheckOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  AnnotationStyleChange,
  AnnotationTextChange,
  AnnotationViewport,
} from '../annotation-contract.ts'
import { ANNOTATION_LIMITS } from '../annotation-contract.ts'
import {
  isSafeAnnotationStyleValue,
  type EditableStyleProperty,
} from '../annotation-properties.ts'
import type {
  PreviewElementHandle,
  PreviewElementNavigationAction,
  PreviewElementTarget,
  PreviewTreeNode,
} from '../preview-contract.ts'
import {
  BoxModelControl,
  type BoxModelLinks,
  ColorControl,
  InspectorRow,
  InspectorSection,
  OptionMenu,
  ScrubNumber,
  SegmentedControl,
  StyleGlyph,
  TextAreaField,
  TextField,
  ToggleButton,
  ToggleGroup,
  updateBoxModelLinks,
} from './InspectorControls.tsx'
import { parseNumeric } from './inspector-values.ts'
import { PROPERTY_BY_NAME, PROPERTY_GROUPS, type PropertyControl } from './property-editor-config.ts'
import type { WebviewKey } from './locales.ts'
import type { UiSkillName } from '../ui-skills.ts'
import { UiSkillSelector } from './UiSkillSelector.tsx'
import { RadiusControl, ShadowControl, SizeControl, TransformControl } from './CompositeControls.tsx'
import { PreviewElementSelector } from './PreviewElementSelector.tsx'
import { elementNavigationAction } from './element-navigation.ts'
import {
  clampFloatingEditorPosition,
  placeFloatingEditor,
  resizeFloatingEditor,
  type FloatingEditorPosition,
  type FloatingEditorResizeEdge,
  type FloatingEditorSize,
} from './floating-position.ts'
import css from './AnnotationEditor.module.css'

export interface AnnotationEditorValue {
  comment: string
  changes: AnnotationStyleChange[]
  textChange: AnnotationTextChange | null
  viewport: AnnotationViewport
}

interface AnnotationEditorBaseProps {
  id: string
  frame: HTMLIFrameElement
  comment: string
  changes: readonly AnnotationStyleChange[]
  textChange: AnnotationTextChange | null
  initialMode?: AnnotationEditorMode
  navigationFeedback?: ElementNavigationFeedback | null
  selectedSkills?: readonly UiSkillName[]
  position?: FloatingEditorPosition | null
  size?: FloatingEditorSize | null
  t: Translate<WebviewKey>
  onCancel: () => void
  onConfirm: (value: AnnotationEditorValue) => void
  /** Mirror the draft into the host transaction for iframe-origin shortcuts. */
  onCommentChange?: (comment: string) => void
  onPositionChange?: (position: FloatingEditorPosition | null) => void
  onSizeChange?: (size: FloatingEditorSize | null) => void
  onSizeCommit?: (size: FloatingEditorSize) => void
  onToggleSkill?: (name: UiSkillName) => void
}

export interface AnnotationEditorProps extends AnnotationEditorBaseProps {
  target: PreviewElementTarget
  tree: PreviewTreeNode | null
  onNavigateTarget: (
    action: PreviewElementNavigationAction,
    comment: string,
    mode: AnnotationEditorMode,
  ) => void
  onSelectTarget: (handle: PreviewElementHandle, comment: string, mode: AnnotationEditorMode) => void
  onPreviewStyle: (property: EditableStyleProperty, value: string) => void
  onRestoreStyle: (property: EditableStyleProperty) => void
  onPreviewText: (value: string) => void
  onRestoreText: () => void
}

/** Mutually exclusive surface shown below the annotation compose row. */
export type AnnotationEditorMode = 'collapsed' | 'select' | 'adjust'

/** One canvas navigation acknowledgement that survives editor re-anchoring. */
export interface ElementNavigationFeedback {
  action: PreviewElementNavigationAction
  sequence: number
}

const ignorePositionChange = (): void => {}
const ignoreSizeChange = (): void => {}
const ignoreSizeCommit = (): void => {}

const RESIZE_EDGES: readonly FloatingEditorResizeEdge[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']

function previewNavigationTargetLabel(target: PreviewElementTarget, t: Translate<WebviewKey>): string {
  const tag = target.snapshot.tagName
  if (target.detail.kind === 'children') return `${tag} · ${t('editor.select.children', { count: String(target.detail.count) })}`
  if (target.detail.kind === 'empty') return tag
  return `${tag} · “${target.detail.text}”`
}

function validCssValue(property: EditableStyleProperty, value: string): boolean {
  if (!isSafeAnnotationStyleValue(value)) return false
  const probe = document.createElement('div').style
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

function SelectIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M1.5 2.5h13v11h-13zM5 2.5v11M1.5 6h3.5M1.5 10h3.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function EyeIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M2.2 8s2.15-3.7 5.8-3.7S13.8 8 13.8 8 11.65 11.7 8 11.7 2.2 8 2.2 8Z" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="8" cy="8" r="1.7" stroke="currentColor" strokeWidth="1.45" />
    </svg>
  )
}

function DragHandleIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      {[3, 8, 13].flatMap(y => [5, 11].map(x => <circle key={`${x}:${y}`} cx={x} cy={y} r="1.25" />))}
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
export function AnnotationEditor(props: AnnotationEditorProps) {
  const {
    frame, comment: initialComment, changes: initialChanges,
    textChange: initialTextChange, initialMode = 'collapsed', navigationFeedback = null,
    position = null, size = null, t, onCancel, onConfirm,
    selectedSkills = [], onToggleSkill = () => {},
    onPositionChange = ignorePositionChange,
    onSizeChange = ignoreSizeChange,
    onSizeCommit = ignoreSizeCommit,
  } = props
  const { target } = props
  const initialMap = useMemo(() => new Map(initialChanges.map(change => [change.property, change])), [initialChanges])
  const originals = useMemo(() => new Map(
    PROPERTY_GROUPS.flatMap(group => group.controls).map(({ property }) => [
      property,
      initialMap.get(property)?.before ?? target.baselines[property],
    ]),
  ), [initialMap, target])
  const [comment, setComment] = useState(initialComment)
  const [mode, setMode] = useState<AnnotationEditorMode>(initialMode)
  const [hidden, setHidden] = useState(false)
  const [activeScrub, setActiveScrub] = useState<string | null>(null)
  const [values, setValues] = useState<Map<EditableStyleProperty, string>>(
    () => new Map([...originals].map(([property, before]) => [property, initialMap.get(property)?.after ?? before])),
  )
  const [invalid, setInvalid] = useState<Set<EditableStyleProperty>>(new Set())
  const originalText = target.originalText ?? undefined
  const [text, setText] = useState(initialTextChange?.after ?? originalText ?? '')
  const [marginLinks, setMarginLinks] = useState<BoxModelLinks>({ vertical: false, horizontal: false, all: false })
  const [paddingLinks, setPaddingLinks] = useState<BoxModelLinks>({ vertical: false, horizontal: false, all: false })
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
  const visibleToggleRef = useRef<HTMLButtonElement | null>(null)
  const hiddenToggleRef = useRef<HTMLButtonElement | null>(null)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    origin: FloatingEditorPosition | null
    originRendered: FloatingEditorPosition
    latest: FloatingEditorPosition
    started: boolean
  } | null>(null)
  const [dragging, setDragging] = useState(false)
  const resizeRef = useRef<{
    pointerId: number
    edge: FloatingEditorResizeEdge
    startX: number
    startY: number
    originPosition: FloatingEditorPosition | null
    originSize: FloatingEditorSize | null
    renderedPosition: FloatingEditorPosition
    renderedSize: FloatingEditorSize
    latestSize: FloatingEditorSize
    started: boolean
  } | null>(null)
  const [resizing, setResizing] = useState(false)

  const valueOf = (property: EditableStyleProperty): string => values.get(property) ?? originals.get(property) ?? ''
  const changed = (property: EditableStyleProperty): boolean => valueOf(property) !== (originals.get(property) ?? '')
  const currentChanges = (): AnnotationStyleChange[] => [...originals].flatMap(([property, before]) => {
    const after = valueOf(property)
    return after === before ? [] : [{ property, before, after }]
  })

  useEffect(() => { forcePosition(value => value + 1) }, [mode])

  useEffect(() => {
    editorRef.current?.focus({ preventScroll: true })
  }, [mode, target])

  const cancel = (): void => { onCancel() }

  const textChanged = originalText !== undefined && text !== originalText
  const canConfirmComment = (candidate: string): boolean => invalid.size === 0
    && candidate.length <= ANNOTATION_LIMITS.comment
    && text.length <= ANNOTATION_LIMITS.textValue
    && (candidate.trim() !== '' || currentChanges().length > 0 || textChanged)
  const canConfirm = canConfirmComment(comment)

  const confirm = (candidate = comment): void => {
    if (!canConfirmComment(candidate)) return
    const viewport = {
      width: Math.round(target.viewport.width),
      height: Math.round(target.viewport.height),
    }
    onConfirm({
      comment: candidate,
      changes: currentChanges(),
      textChange: textChanged ? { before: initialTextChange?.before ?? originalText, after: text } : null,
      viewport,
    })
  }

  const moveSelection = (event: KeyboardEvent, capturePageActions = false): void => {
    const action = elementNavigationAction(event, { capturePageActions })
    if (action === null) return
    const available = target.navigation[action] === true
    if (!available && !capturePageActions) return
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    if (!available) return
    props.onNavigateTarget(action, comment, mode)
  }

  const updateProperty = (property: EditableStyleProperty, next: string): void => {
    const before = originals.get(property) ?? ''
    if (next === before) {
      props.onRestoreStyle(property)
      setInvalid(current => { const copy = new Set(current); copy.delete(property); return copy })
      setValues(current => new Map(current).set(property, next))
      return
    }
    if (
      next.length > ANNOTATION_LIMITS.styleValue
      || next.trim() === ''
      || !validCssValue(property, next)
    ) {
      setInvalid(current => new Set(current).add(property))
      setValues(current => new Map(current).set(property, next))
      return
    }
    // Record the rollback baseline before the state update can trigger a
    // render that derives numeric fallbacks for keyword values.
    props.onPreviewStyle(property, next)
    setInvalid(current => { const copy = new Set(current); copy.delete(property); return copy })
    setValues(current => new Map(current).set(property, next))
  }

  const updateText = (next: string): void => {
    setText(next)
    if (originalText === undefined) return
    if (next === originalText) {
      props.onRestoreText()
    } else props.onPreviewText(next)
  }

  const reset = (property: EditableStyleProperty): void => { updateProperty(property, originals.get(property) ?? '') }
  const scrubChange = (target: string) => (active: boolean): void => {
    setActiveScrub(current => active ? target : current === target ? null : current)
  }

  const numericFallback = (property: EditableStyleProperty): string => {
    const originalInline = target.inlineStyles[property]?.value
    if (originalInline !== undefined && parseNumeric(originalInline) !== null) return originalInline
    const baseline = originals.get(property)
    if (baseline !== undefined && parseNumeric(baseline) !== null) return baseline
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
    if (control.kind === 'color') return <ColorControl label={label} value={value} onScrubChange={scrubChange(property)} onChange={next => { updateProperty(property, next) }} />
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
          onScrubChange={scrubChange(property)}
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
        options={control.options ?? []}
        presetLabel={t('editor.action.choosePreset')}
        onScrubChange={scrubChange(property)}
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
      <InspectorRow key={property} label={label} active={activeScrub === property} changed={changed(property)} resetLabel={`${t('editor.reset')} · ${label}`} onReset={() => { reset(property) }}>
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

  const spacing = (prefix: 'margin' | 'padding', links: BoxModelLinks, setLinks: (value: BoxModelLinks) => void) => {
    const properties = four(['top', 'right', 'bottom', 'left'].map(side => `${prefix}-${side}` as EditableStyleProperty))
    const controls = four(properties.map(property => PROPERTY_BY_NAME.get(property)!))
    const groupLabel = t(prefix === 'margin' ? 'editor.group.margin' : 'editor.group.padding')
    return (
      <InspectorRow wide label={groupLabel} active={activeScrub === prefix} staticLabel changed={properties.some(changed)} resetLabel={`${t('editor.reset')} · ${groupLabel}`} onReset={() => { properties.forEach(reset) }}>
        <BoxModelControl
          label={groupLabel}
          sideLabels={four(controls.map(control => propertyLabel(control, t)))}
          values={four(properties.map(valueOf))}
          options={controls[0]?.options ?? []}
          presetLabel={t('editor.action.choosePreset')}
          onScrubChange={scrubChange(prefix)}
          links={links}
          {...(prefix === 'padding' ? { min: 0 } : {})}
          linkLabel={t('editor.action.linkValues')}
          unlinkLabel={t('editor.action.unlinkValues')}
          linkAllLabel={t('editor.action.linkAllValues')}
          unlinkAllLabel={t('editor.action.unlinkAllValues')}
          onLinkChange={(axis, linked) => {
            setLinks(updateBoxModelLinks(links, axis, linked))
          }}
          onChange={(index, next) => {
            const property = properties[index]
            if (property !== undefined) updateProperty(property, next)
          }}
        />
      </InspectorRow>
    )
  }

  const rect = {
    x: target.rect.x,
    y: target.rect.y,
    width: target.rect.width,
    height: target.rect.height,
    top: target.rect.y,
    right: target.rect.x + target.rect.width,
    bottom: target.rect.y + target.rect.height,
    left: target.rect.x,
  }
  const preferredWidth = mode === 'select' ? 414 : mode === 'adjust' ? 400 : 374
  const availableWidth = Math.max(0, frame.clientWidth - 16)
  const availableHeight = Math.max(0, frame.clientHeight - 16)
  const minimumWidth = Math.min(320, availableWidth)
  const minimumHeight = Math.min(mode === 'select' ? 260 : 300, availableHeight)
  const autoWidth = Math.min(preferredWidth, Math.max(280, availableWidth))
  const width = mode !== 'collapsed' && size !== null
    ? Math.min(Math.max(size.width, minimumWidth), availableWidth)
    : autoWidth
  // A mode switch renders before the existing ref reports the new panel's
  // height. Use the expanded estimate until its larger layout is measurable,
  // otherwise the card can anchor like the collapsed pill and clip below the
  // iframe viewport for one stable render.
  const preferredHeight = mode === 'select' ? 430 : mode === 'adjust' ? 560 : 82
  const measuredHeight = Math.max(editorRef.current?.scrollHeight ?? 0, preferredHeight)
  const placement = placeFloatingEditor({
    target: rect,
    surfaceWidth: frame.clientWidth,
    surfaceHeight: frame.clientHeight,
    editorWidth: width,
    editorHeight: measuredHeight,
    minHeight: mode === 'select' ? 260 : mode === 'adjust' ? 300 : 54,
  })
  const manualHeight = mode !== 'collapsed' && size !== null
    ? Math.min(Math.max(size.height, minimumHeight), availableHeight)
    : Math.min(measuredHeight, availableHeight)
  const renderedPosition = position === null
    ? { left: placement.left, top: placement.top }
    : clampFloatingEditorPosition({
        position,
        surfaceWidth: frame.clientWidth,
        surfaceHeight: frame.clientHeight,
        editorWidth: width,
        editorHeight: manualHeight,
      })
  const maxHeight = position === null ? placement.maxHeight : manualHeight
  const hiddenLeft = Math.min(
    Math.max(8, renderedPosition.left + width - 36),
    Math.max(8, frame.clientWidth - 44),
  )

  useEffect(() => {
    if (position === null) return
    if (position.left === renderedPosition.left && position.top === renderedPosition.top) return
    onPositionChange(renderedPosition)
  }, [onPositionChange, position, renderedPosition.left, renderedPosition.top])

  const finishDrag = (cancelled: boolean): void => {
    const drag = dragRef.current
    if (drag === null) return
    if (cancelled && drag.started) onPositionChange(drag.origin)
    dragRef.current = null
    setDragging(false)
  }

  const finishResize = (cancelled: boolean): void => {
    const resize = resizeRef.current
    if (resize === null) return
    if (cancelled && resize.started) {
      onPositionChange(resize.originPosition)
      onSizeChange(resize.originSize)
    } else if (resize.started) {
      onSizeCommit(resize.latestSize)
    }
    resizeRef.current = null
    setResizing(false)
  }

  const hideEditor = (): void => {
    setActiveScrub(null)
    setHidden(true)
    queueMicrotask(() => { hiddenToggleRef.current?.focus() })
  }
  const showEditor = (): void => {
    setHidden(false)
    queueMicrotask(() => { visibleToggleRef.current?.focus() })
  }

  return (
    <>
      <div
        ref={editorRef}
        className={`${css.editor} ${hidden ? css.editorHidden : ''}`}
        style={{
          left: renderedPosition.left,
          top: renderedPosition.top,
          width,
          maxHeight,
          ...(mode !== 'collapsed' && size !== null ? { height: manualHeight } : {}),
        }}
        data-webview-annotation-editor=""
        data-placement={placement.side}
        {...(activeScrub === null ? {} : { 'data-scrubbing': activeScrub })}
        {...(hidden ? { 'data-editor-hidden': '' } : {})}
        {...(dragging ? { 'data-editor-dragging': '' } : {})}
        {...(resizing ? { 'data-editor-resizing': '' } : {})}
        aria-hidden={hidden}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || event.defaultPrevented) return
          event.preventDefault()
          if (mode === 'select') setMode('collapsed')
          else cancel()
        }}
        onKeyDownCapture={(event) => { moveSelection(event.nativeEvent, true) }}
      >
        {mode !== 'collapsed' && RESIZE_EDGES.map(edge => (
          <div
            key={edge}
            className={css.resizeHandle}
            data-resize-edge={edge}
            aria-hidden="true"
            onPointerDown={(event) => {
              if (event.button !== 0) return
              resizeRef.current = {
                pointerId: event.pointerId,
                edge,
                startX: event.clientX,
                startY: event.clientY,
                originPosition: position,
                originSize: size,
                renderedPosition,
                renderedSize: { width, height: manualHeight },
                latestSize: { width, height: manualHeight },
                started: false,
              }
              event.currentTarget.setPointerCapture?.(event.pointerId)
              event.preventDefault()
            }}
            onPointerMove={(event) => {
              const resize = resizeRef.current
              if (resize === null || resize.pointerId !== event.pointerId) return
              const deltaX = event.clientX - resize.startX
              const deltaY = event.clientY - resize.startY
              if (!resize.started && Math.hypot(deltaX, deltaY) <= 3) return
              if (!resize.started) {
                resize.started = true
                setResizing(true)
              }
              const next = resizeFloatingEditor({
                edge: resize.edge,
                position: resize.renderedPosition,
                size: resize.renderedSize,
                deltaX,
                deltaY,
                surfaceWidth: frame.clientWidth,
                surfaceHeight: frame.clientHeight,
                minWidth: minimumWidth,
                minHeight: minimumHeight,
              })
              onPositionChange(next.position)
              onSizeChange(next.size)
              resize.latestSize = next.size
            }}
            onPointerUp={(event) => {
              const resize = resizeRef.current
              if (resize === null || resize.pointerId !== event.pointerId) return
              finishResize(false)
              if (event.currentTarget.hasPointerCapture?.(event.pointerId) === true) {
                event.currentTarget.releasePointerCapture?.(event.pointerId)
              }
            }}
            onPointerCancel={() => { finishResize(true) }}
            // Capture loss is also the normal end signal in some browsers.
            // Preserve the last valid geometry; only pointercancel rolls back.
            onLostPointerCapture={() => { finishResize(false) }}
          />
        ))}
        <div className={`${css.composeRow} ${mode !== 'collapsed' ? css.composeRowExpanded : ''}`}>
          <button type="button" className={mode === 'select' ? `${css.adjust} ${css.adjustActive}` : css.adjust} aria-label={t('editor.select')} title={t('editor.select')} aria-expanded={mode === 'select'} onClick={() => { setMode(value => value === 'select' ? 'collapsed' : 'select') }}>
            <SelectIcon />
          </button>
          <button type="button" className={mode === 'adjust' ? `${css.adjust} ${css.adjustActive}` : css.adjust} aria-label={t('editor.adjust')} title={t('editor.adjust')} aria-expanded={mode === 'adjust'} onClick={() => { setMode(value => value === 'adjust' ? 'collapsed' : 'adjust') }}>
            <AdjustIcon />
          </button>
          <input
            className={`${css.commentInput} dsh-wv-comment-input`}
            value={comment}
            maxLength={ANNOTATION_LIMITS.comment}
            placeholder={t('editor.comment')}
            onChange={(event) => {
              const next = event.target.value
              setComment(next)
              props.onCommentChange?.(next)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') { event.preventDefault(); if (mode === 'select') setMode('collapsed'); else cancel() }
              if (event.key === 'Enter') { event.preventDefault(); confirm(event.currentTarget.value) }
            }}
          />
          {mode !== 'collapsed' && (
            <button
              type="button"
              className={css.dragHandle}
              aria-label={t('editor.move')}
              title={t('editor.move')}
              onPointerDown={(event) => {
                if (event.button !== 0) return
                dragRef.current = {
                  pointerId: event.pointerId,
                  startX: event.clientX,
                  startY: event.clientY,
                  origin: position,
                  originRendered: renderedPosition,
                  latest: renderedPosition,
                  started: false,
                }
                event.currentTarget.setPointerCapture?.(event.pointerId)
              }}
              onPointerMove={(event) => {
                const drag = dragRef.current
                if (drag === null || drag.pointerId !== event.pointerId) return
                const dx = event.clientX - drag.startX
                const dy = event.clientY - drag.startY
                if (!drag.started && Math.hypot(dx, dy) <= 3) return
                if (!drag.started) {
                  drag.started = true
                  setDragging(true)
                }
                drag.latest = clampFloatingEditorPosition({
                  position: { left: drag.originRendered.left + dx, top: drag.originRendered.top + dy },
                  surfaceWidth: frame.clientWidth,
                  surfaceHeight: frame.clientHeight,
                  editorWidth: width,
                  editorHeight: manualHeight,
                })
                onPositionChange(drag.latest)
              }}
              onPointerUp={(event) => {
                const drag = dragRef.current
                if (drag === null || drag.pointerId !== event.pointerId) return
                finishDrag(false)
                event.currentTarget.releasePointerCapture?.(event.pointerId)
              }}
              onPointerCancel={() => { finishDrag(true) }}
              onLostPointerCapture={() => { finishDrag(true) }}
            >
              <DragHandleIcon />
            </button>
          )}
          <button
            ref={visibleToggleRef}
            type="button"
            className={css.visibilityToggle}
            aria-label={t('editor.hide')}
            title={t('editor.hide')}
            aria-pressed={false}
            onClick={hideEditor}
          >
            <EyeIcon />
          </button>
          {mode === 'collapsed' && (
            <button type="button" className={css.quickConfirm} aria-label={t('editor.confirm')} disabled={!canConfirm} onClick={() => { confirm() }}>
              <IconCheckOutline16 size={16} />
            </button>
          )}
        </div>

      {mode !== 'select' && (
        <div
          className={css.navigationFeedbackSlot}
          data-webview-navigation-feedback=""
          data-action={navigationFeedback?.action}
          role="status"
          aria-live="polite"
        >
          <div className={css.navigationFeedback}>
            <span className={css.navigationGlyph} aria-hidden>&lt;&gt;</span>
            <span key={navigationFeedback?.sequence ?? 'current'} className={css.navigationTarget}>
              {t('editor.select.current', { target: previewNavigationTargetLabel(target, t) })}
            </span>
          </div>
        </div>
      )}

      {mode === 'select' && (
        <PreviewElementSelector
          target={target}
          tree={props.tree}
          t={t}
          onNavigate={action => { props.onNavigateTarget(action, comment, mode) }}
          onSelect={handle => { props.onSelectTarget(handle, comment, mode) }}
        />
      )}

      {mode === 'adjust' && (
        <>
          <div className={css.inspector} data-webview-property-inspector="">
            <UiSkillSelector selected={selectedSkills} t={t} onToggle={onToggleSkill} />
            {originalText !== undefined && (
              <InspectorSection label={t('editor.text')}>
                <InspectorRow wide label={t('editor.text')} changed={textChanged} resetLabel={t('editor.reset')} onReset={() => { updateText(originalText) }}>
                  <TextAreaField
                    label={t('editor.text')}
                    value={text}
                    maxLength={ANNOTATION_LIMITS.textValue}
                    onChange={updateText}
                  />
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
                active={activeScrub === 'size'}
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
                  options={PROPERTY_BY_NAME.get('width')?.options ?? []}
                  presetLabel={t('editor.action.choosePreset')}
                  onWidthChange={next => { updateProperty('width', next) }}
                  onHeightChange={next => { updateProperty('height', next) }}
                  onScrubChange={scrubChange('size')}
                />
              </InspectorRow>
              {row('display')}{row('position')}
              {showFlexControls && <>{row('flex-direction')}{row('flex-wrap')}</>}
              {showLayoutControls && <>{row('justify-content')}{row('align-items')}{row('align-content')}{row('gap')}{row('row-gap')}{row('column-gap')}</>}
              {row('overflow')}
            </InspectorSection>

            <InspectorSection label={t('editor.group.spacing')}>
              {spacing('margin', marginLinks, setMarginLinks)}
              {spacing('padding', paddingLinks, setPaddingLinks)}
            </InspectorSection>

            <InspectorSection label={t('editor.group.border')}>
              {row('border-width')}{row('border-style')}{row('border-color')}
              <InspectorRow wide label={t('editor.property.borderRadius')} active={activeScrub === 'border-radius'} changed={changed('border-radius')} resetLabel={`${t('editor.reset')} · ${t('editor.property.borderRadius')}`} onReset={() => { reset('border-radius') }}>
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
                  onScrubChange={scrubChange('border-radius')}
                  onChange={next => { updateProperty('border-radius', next) }}
                />
              </InspectorRow>
            </InspectorSection>

            <InspectorSection label={t('editor.group.constraints')} defaultOpen={showPositionControls}>
              {row('min-width')}{row('max-width')}{row('min-height')}{row('max-height')}
              {showPositionControls && <>{row('top')}{row('right')}{row('bottom')}{row('left')}{row('z-index')}</>}
            </InspectorSection>

            <InspectorSection label={t('editor.group.effects')} defaultOpen={false}>
              <InspectorRow wide label={t('editor.property.boxShadow')} active={activeScrub === 'box-shadow'} changed={changed('box-shadow')} resetLabel={`${t('editor.reset')} · ${t('editor.property.boxShadow')}`} onReset={() => { reset('box-shadow') }}>
                <ShadowControl
                  label={t('editor.property.boxShadow')}
                  value={valueOf('box-shadow')}
                  rawHint={t('editor.rawHint')}
                  labels={{
                    x: t('editor.property.shadowX'), y: t('editor.property.shadowY'),
                    blur: t('editor.property.shadowBlur'), spread: t('editor.property.shadowSpread'),
                    color: t('editor.property.shadowColor'), inset: t('editor.property.shadowInset'),
                  }}
                  onScrubChange={scrubChange('box-shadow')}
                  onChange={next => { updateProperty('box-shadow', next) }}
                />
              </InspectorRow>
              <InspectorRow wide label={t('editor.property.transform')} active={activeScrub === 'transform'} changed={changed('transform')} resetLabel={`${t('editor.reset')} · ${t('editor.property.transform')}`} onReset={() => { reset('transform') }}>
                <TransformControl
                  label={t('editor.property.transform')}
                  value={valueOf('transform')}
                  rawHint={t('editor.rawHint')}
                  labels={{
                    translateX: t('editor.property.translateX'), translateY: t('editor.property.translateY'),
                    scaleX: t('editor.property.scaleX'), scaleY: t('editor.property.scaleY'), rotate: t('editor.property.rotate'),
                  }}
                  onScrubChange={scrubChange('transform')}
                  onChange={next => { updateProperty('transform', next) }}
                />
              </InspectorRow>
            </InspectorSection>
          </div>
          <div className={css.footer} data-webview-editor-footer="">
            <button type="button" className={css.cancel} onClick={cancel}>{t('editor.cancel')}</button>
            <button type="button" className={css.confirm} aria-label={t('editor.confirm')} disabled={!canConfirm} onClick={() => { confirm() }}>
              <IconCheckOutline16 size={16} />
            </button>
          </div>
        </>
      )}
      </div>
      <button
        ref={hiddenToggleRef}
        type="button"
        className={`${css.visibilityFab} ${hidden ? '' : css.visibilityFabHidden}`}
        style={{ left: hiddenLeft, top: renderedPosition.top }}
        aria-label={t('editor.show')}
        title={t('editor.show')}
        aria-pressed={hidden}
        onClick={showEditor}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          cancel()
        }}
      >
        <EyeIcon />
      </button>
    </>
  )
}
