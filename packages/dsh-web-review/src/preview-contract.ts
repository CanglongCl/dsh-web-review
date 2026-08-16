/**
 * Cross-origin preview-session and frame-bridge contracts.
 *
 * Values received from a preview frame are untrusted page evidence. The
 * channel routes messages to the correct iframe; it is not an authenticity
 * boundary because scripts in the isolated page can inspect their own DOM.
 */
import type {
  AnnotationStyleChange,
  AnnotationTextChange,
  AnnotationViewport,
} from './annotation-contract.ts'
import {
  EDITABLE_STYLE_PROPERTIES,
  isEditableStyleProperty,
  type EditableStyleProperty,
} from './annotation-properties.ts'
import { decodeTarget, isPreviewableUrl } from './proxy-url.ts'
import {
  MAX_SNAPSHOT_HTML,
  SNAPSHOT_LIMITS,
  type PageSnapshotScreenshot,
} from './snapshot-contract.ts'

export type PreviewElementNavigationAction = 'child' | 'parent' | 'previous-sibling' | 'next-sibling'
export type PreviewElementTreeDetail =
  | { kind: 'children'; count: number }
  | { kind: 'empty' }
  | { kind: 'text'; text: string }

/** DOM evidence shape kept independent of browser DOM library types. */
export interface PreviewElementSnapshot {
  tagName: string
  id: string
  className: string
  cssPath: string
  fullPath: string
  label: string
  role: string
  stableClasses: string[]
  anchor: import('./annotation-contract.ts').AnnotationAnchor | null
  /** True when the element sits inside this plugin's own `[data-webview-ui]` chrome. */
  inToolChrome: boolean
  outerHTML: string
  textContent: string
  rect: { x: number; y: number; width: number; height: number }
  computed: {
    display: string
    position: string
    fontSize: string
    color: string
    backgroundColor: string
    margin: string
    padding: string
    width: string
    height: string
  }
}

/** Bounds for untrusted page evidence crossing the isolated-frame bridge. */
export const PREVIEW_ELEMENT_LIMITS = {
  tagName: 64,
  id: 512,
  className: 2_000,
  cssPath: 2_000,
  fullPath: 4_000,
  label: 500,
  role: 100,
  stableClass: 100,
  stableClasses: 20,
  anchorFile: 1_000,
  anchorComponent: 500,
  outerHTML: 1_500,
  textContent: 300,
  computedValue: 500,
  styleValue: 500,
  stylePriority: 32,
  textValue: 2_000,
} as const

/** Bounds for one serialized hierarchy response from the isolated frame. */
export const PREVIEW_TREE_LIMITS = {
  nodes: 2_000,
  depth: 100,
  key: 2_000,
} as const

export const PREVIEW_SESSIONS_PATH = '/webview-preview-sessions'
export const PREVIEW_CLIENT_HEADER = 'x-dsh-web-review-client'
export const PREVIEW_CLIENT_HEADER_VALUE = '1'
export const PREVIEW_BRIDGE_PROTOCOL = 'dsh-web-review/bridge'
export const PREVIEW_BRIDGE_VERSION = 1
export const PREVIEW_RESERVED_PREFIX = '/.dsh-web-review'
export const PREVIEW_BRIDGE_PATH = `${PREVIEW_RESERVED_PREFIX}/bridge.js`
export const PREVIEW_ENTRY_PREFIX = `${PREVIEW_RESERVED_PREFIX}/entry/`
export const PREVIEW_PROXY_PREFIX = `${PREVIEW_RESERVED_PREFIX}/proxy/`
export const PREVIEW_NAVIGATE_PREFIX = `${PREVIEW_RESERVED_PREFIX}/navigate/`

declare const previewSessionIdBrand: unique symbol
declare const previewChannelBrand: unique symbol
declare const previewElementHandleBrand: unique symbol

export type PreviewSessionId = string & { readonly [previewSessionIdBrand]: true }
export type PreviewChannel = string & { readonly [previewChannelBrand]: true }
export type PreviewElementHandle = string & { readonly [previewElementHandleBrand]: true }

export interface PreviewSessionDescriptor {
  sessionId: PreviewSessionId
  frameUrl: string
  frameOrigin: string
  /** Server-bound target Origin used to reject page-forged address changes. */
  targetOrigin: string
  channel: PreviewChannel
}

export interface PreviewInlineDeclaration {
  value: string
  priority: string
}

export interface PreviewElementTarget {
  handle: PreviewElementHandle
  snapshot: PreviewElementSnapshot
  rect: { x: number; y: number; width: number; height: number }
  viewport: AnnotationViewport
  baselines: Record<EditableStyleProperty, string>
  inlineStyles: Partial<Record<EditableStyleProperty, PreviewInlineDeclaration>>
  originalText: string | null
  detail: PreviewElementTreeDetail
  navigation: Record<PreviewElementNavigationAction, boolean>
}

export interface PreviewTreeNode {
  handle: PreviewElementHandle
  key: string
  tagName: string
  detail: PreviewElementTreeDetail
  current: boolean
  children: PreviewTreeNode[]
}

export interface PreviewMarker {
  id: string
  index: number
  cssPath: string
  changes: AnnotationStyleChange[]
  textChange: AnnotationTextChange | null
}

export type PreviewBridgeCommand =
  | { name: 'request-ready'; payload: null }
  | { name: 'activate'; payload: null }
  | { name: 'deactivate'; payload: null }
  | { name: 'clear-selection'; payload: null }
  | { name: 'sync-markers'; payload: { markers: PreviewMarker[] } }
  | { name: 'open-pick'; payload: { pickId: string; cssPath: string } }
  | { name: 'navigate-element'; payload: { handle: PreviewElementHandle; action: PreviewElementNavigationAction } }
  | { name: 'select-element'; payload: { handle: PreviewElementHandle } }
  | { name: 'read-tree'; payload: { handle: PreviewElementHandle } }
  | { name: 'preview-style'; payload: { handle: PreviewElementHandle; property: EditableStyleProperty; value: string } }
  | { name: 'restore-style'; payload: { handle: PreviewElementHandle; property: EditableStyleProperty } }
  | { name: 'preview-text'; payload: { handle: PreviewElementHandle; value: string } }
  | { name: 'restore-text'; payload: { handle: PreviewElementHandle } }
  | { name: 'cancel-edit'; payload: null }
  | { name: 'commit-edit'; payload: {
      pickId: string
      handle: PreviewElementHandle
      changes: AnnotationStyleChange[]
      textChange: AnnotationTextChange | null
    } }
  | { name: 'history-back'; payload: null }
  | { name: 'history-forward'; payload: null }
  | { name: 'reload'; payload: null }
  | { name: 'capture-snapshot'; payload: null }

export interface PreviewHostMessage {
  protocol: typeof PREVIEW_BRIDGE_PROTOCOL
  version: typeof PREVIEW_BRIDGE_VERSION
  channel: PreviewChannel
  direction: 'host-to-frame'
  requestId: string
  command: PreviewBridgeCommand
}

export type PreviewFrameEvent =
  | { name: 'ready'; payload: {
      pageUrl: string
      title: string
      viewport: AnnotationViewport
      canGoBack: boolean
      canGoForward: boolean
    } }
  | { name: 'pick'; payload: { target: PreviewElementTarget } }
  | { name: 'cancel-pick'; payload: null }
  | { name: 'mark-click'; payload: { pickId: string } }
  | { name: 'target-geometry'; payload: {
      handle: PreviewElementHandle
      rect: PreviewElementTarget['rect']
      viewport: AnnotationViewport
    } }
  | { name: 'shortcut'; payload: { action: PreviewElementNavigationAction } }
  | { name: 'handoff'; payload: PreviewSessionDescriptor }

/** Bounded page-capture evidence crossing the isolated-frame bridge. */
export interface PreviewPageSnapshot {
  html: string
  viewport: AnnotationViewport
  scroll: { x: number; y: number }
  screenshot: PageSnapshotScreenshot | null
  screenshotError: string | null
}

function pageSnapshotScreenshotOf(value: unknown): PageSnapshotScreenshot | undefined {
  const record = recordOf(value)
  if (record === undefined || !exactKeys(record, ['dataUrl', 'width', 'height', 'truncated'])
    || typeof record.truncated !== 'boolean') return undefined
  const dataUrl = boundedString(record.dataUrl, SNAPSHOT_LIMITS.dataUrl, false)
  const width = finiteDimension(record.width)
  const height = finiteDimension(record.height)
  if (dataUrl === undefined || !dataUrl.startsWith('data:image/png;base64,')
    || width === undefined || height === undefined || width < 1 || height < 1) return undefined
  return { dataUrl, width: Math.round(width), height: Math.round(height), truncated: record.truncated }
}

/** Strictly decode one bounded page-capture response from an untrusted frame. */
export function previewPageSnapshotOf(value: unknown): PreviewPageSnapshot | undefined {
  const record = recordOf(value)
  if (record === undefined || !exactKeys(record, [
    'html', 'viewport', 'scroll', 'screenshot', 'screenshotError',
  ])) return undefined
  const html = boundedString(record.html, MAX_SNAPSHOT_HTML, false)
  const viewport = viewportOf(record.viewport)
  const scroll = recordOf(record.scroll)
  const screenshot = record.screenshot
  const screenshotError = record.screenshotError
  if (html === undefined || viewport === undefined || scroll === undefined
    || !exactKeys(scroll, ['x', 'y'])) return undefined
  const x = finiteDimension(scroll.x, SNAPSHOT_LIMITS.scroll)
  const y = finiteDimension(scroll.y, SNAPSHOT_LIMITS.scroll)
  if (x === undefined || y === undefined || x < 0 || y < 0) return undefined
  const parsedScreenshot = screenshot === null ? null : pageSnapshotScreenshotOf(screenshot)
  const parsedError = screenshotError === null ? null : boundedString(
    screenshotError,
    SNAPSHOT_LIMITS.screenshotError,
    false,
  )
  if (parsedScreenshot === undefined || parsedError === undefined
    || (parsedScreenshot === null) === (parsedError === null)) return undefined
  return {
    html,
    viewport,
    scroll: { x: Math.round(x), y: Math.round(y) },
    screenshot: parsedScreenshot,
    screenshotError: parsedError,
  }
}

export interface PreviewFrameEventMessage {
  protocol: typeof PREVIEW_BRIDGE_PROTOCOL
  version: typeof PREVIEW_BRIDGE_VERSION
  channel: PreviewChannel
  direction: 'frame-to-host'
  event: PreviewFrameEvent
}

export interface PreviewFrameResponseMessage {
  protocol: typeof PREVIEW_BRIDGE_PROTOCOL
  version: typeof PREVIEW_BRIDGE_VERSION
  channel: PreviewChannel
  direction: 'frame-to-host'
  requestId: string
  response: { ok: true; value: unknown } | { ok: false; error: string }
}

export type PreviewFrameMessage = PreviewFrameEventMessage | PreviewFrameResponseMessage

type UnknownRecord = Record<string, unknown>

function recordOf(value: unknown): UnknownRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined
}

function exactKeys(record: UnknownRecord, keys: readonly string[]): boolean {
  return Object.keys(record).length === keys.length && keys.every(key => Object.hasOwn(record, key))
}

function boundedString(value: unknown, cap: number, allowEmpty = true): string | undefined {
  return typeof value === 'string' && value.length <= cap && (allowEmpty || value.length > 0)
    ? value
    : undefined
}

function finiteDimension(value: unknown, cap = 100_000): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= cap ? value : undefined
}

function viewportOf(value: unknown): AnnotationViewport | undefined {
  const record = recordOf(value)
  if (record === undefined || !exactKeys(record, ['width', 'height'])) return undefined
  const width = finiteDimension(record.width)
  const height = finiteDimension(record.height)
  return width === undefined || height === undefined || width < 0 || height < 0
    ? undefined
    : { width: Math.round(width), height: Math.round(height) }
}

function rectOf(value: unknown): PreviewElementTarget['rect'] | undefined {
  const record = recordOf(value)
  if (record === undefined || !exactKeys(record, ['x', 'y', 'width', 'height'])) return undefined
  const x = finiteDimension(record.x)
  const y = finiteDimension(record.y)
  const width = finiteDimension(record.width)
  const height = finiteDimension(record.height)
  return x === undefined || y === undefined || width === undefined || height === undefined || width < 0 || height < 0
    ? undefined
    : { x, y, width, height }
}

function sessionIdOf(value: unknown): PreviewSessionId | undefined {
  return typeof value === 'string' && /^[a-f\d]{32}$/u.test(value) ? value as PreviewSessionId : undefined
}

function channelOf(value: unknown): PreviewChannel | undefined {
  return typeof value === 'string' && /^[a-f\d]{32}$/u.test(value) ? value as PreviewChannel : undefined
}

function elementHandleOf(value: unknown): PreviewElementHandle | undefined {
  return typeof value === 'string' && /^[a-f\d]{16,32}$/u.test(value) ? value as PreviewElementHandle : undefined
}

/** Strictly decode the main-host or handoff session descriptor. */
export function previewSessionDescriptorOf(value: unknown): PreviewSessionDescriptor | undefined {
  const record = recordOf(value)
  if (record === undefined || !exactKeys(record, [
    'sessionId', 'frameUrl', 'frameOrigin', 'targetOrigin', 'channel',
  ])) return undefined
  const sessionId = sessionIdOf(record.sessionId)
  const channel = channelOf(record.channel)
  const frameUrl = boundedString(record.frameUrl, 32_768, false)
  const frameOrigin = boundedString(record.frameOrigin, 2_048, false)
  const targetOrigin = boundedString(record.targetOrigin, 2_048, false)
  if (sessionId === undefined || channel === undefined || frameUrl === undefined
    || frameOrigin === undefined || targetOrigin === undefined) return undefined
  try {
    const url = new URL(frameUrl)
    const target = new URL(decodeTarget(url.pathname.slice(PREVIEW_ENTRY_PREFIX.length)))
    if (url.protocol !== 'http:' || url.origin !== frameOrigin
      || url.hostname !== `${sessionId}.localhost`
      || !url.pathname.startsWith(PREVIEW_ENTRY_PREFIX)
      || url.username !== '' || url.password !== ''
      || !isPreviewableUrl(target.href) || target.origin !== targetOrigin
      || new URL(targetOrigin).origin !== targetOrigin) return undefined
  } catch {
    return undefined
  }
  return { sessionId, frameUrl, frameOrigin, targetOrigin, channel }
}

function treeDetailOf(value: unknown): PreviewElementTreeDetail | undefined {
  const record = recordOf(value)
  if (record === undefined || typeof record.kind !== 'string') return undefined
  if (record.kind === 'empty' && exactKeys(record, ['kind'])) return { kind: 'empty' }
  if (record.kind === 'children' && exactKeys(record, ['kind', 'count']) && Number.isSafeInteger(record.count)
    && (record.count as number) >= 0 && (record.count as number) <= 100_000) {
    return { kind: 'children', count: record.count as number }
  }
  const text = boundedString(record.text, 48)
  return record.kind === 'text' && exactKeys(record, ['kind', 'text']) && text !== undefined
    ? { kind: 'text', text }
    : undefined
}

function snapshotOf(value: unknown): PreviewElementSnapshot | undefined {
  const record = recordOf(value)
  if (record === undefined || !exactKeys(record, [
    'tagName', 'id', 'className', 'cssPath', 'fullPath', 'label', 'role',
    'stableClasses', 'anchor', 'inToolChrome', 'outerHTML', 'textContent', 'rect', 'computed',
  ])) return undefined
  if (typeof record.inToolChrome !== 'boolean') return undefined
  const stringCaps = {
    tagName: PREVIEW_ELEMENT_LIMITS.tagName,
    id: PREVIEW_ELEMENT_LIMITS.id,
    className: PREVIEW_ELEMENT_LIMITS.className,
    cssPath: PREVIEW_ELEMENT_LIMITS.cssPath,
    fullPath: PREVIEW_ELEMENT_LIMITS.fullPath,
    label: PREVIEW_ELEMENT_LIMITS.label,
    role: PREVIEW_ELEMENT_LIMITS.role,
    outerHTML: PREVIEW_ELEMENT_LIMITS.outerHTML,
    textContent: PREVIEW_ELEMENT_LIMITS.textContent,
  } as const
  for (const [key, cap] of Object.entries(stringCaps)) {
    if (boundedString(record[key], cap) === undefined) return undefined
  }
  if (!Array.isArray(record.stableClasses)
    || record.stableClasses.length > PREVIEW_ELEMENT_LIMITS.stableClasses
    || record.stableClasses.some(value => boundedString(
      value,
      PREVIEW_ELEMENT_LIMITS.stableClass,
      false,
    ) === undefined)) return undefined
  const rect = rectOf(record.rect)
  const computed = recordOf(record.computed)
  if (rect === undefined || computed === undefined || !exactKeys(computed, [
    'display', 'position', 'fontSize', 'color', 'backgroundColor', 'margin',
    'padding', 'width', 'height',
  ]) || Object.values(computed).some(item => boundedString(
    item,
    PREVIEW_ELEMENT_LIMITS.computedValue,
  ) === undefined)) return undefined
  const anchor = record.anchor
  if (anchor !== null) {
    const anchorRecord = recordOf(anchor)
    const anchorKeys = anchorRecord === undefined ? [] : Object.keys(anchorRecord)
    if (anchorRecord === undefined
      || !['react', 'vue', 'svelte'].includes(String(anchorRecord.framework))
      || boundedString(anchorRecord.component, PREVIEW_ELEMENT_LIMITS.anchorComponent) === undefined
      || boundedString(anchorRecord.file, PREVIEW_ELEMENT_LIMITS.anchorFile, false) === undefined
      || !['framework', 'component', 'file'].every(key => anchorKeys.includes(key))
      || anchorKeys.some(key => !['framework', 'component', 'file', 'line'].includes(key))
      || (anchorRecord.line !== undefined
        && (!Number.isSafeInteger(anchorRecord.line) || (anchorRecord.line as number) < 1))) return undefined
  }
  return { ...record, rect } as unknown as PreviewElementSnapshot
}

/** Strictly decode one serializable element target from an untrusted frame. */
export function previewElementTargetOf(value: unknown): PreviewElementTarget | undefined {
  const record = recordOf(value)
  if (record === undefined || !exactKeys(record, [
    'handle', 'snapshot', 'rect', 'viewport', 'baselines', 'inlineStyles',
    'originalText', 'detail', 'navigation',
  ])) return undefined
  const handle = elementHandleOf(record.handle)
  const snapshot = snapshotOf(record.snapshot)
  const rect = rectOf(record.rect)
  const viewport = viewportOf(record.viewport)
  const detail = treeDetailOf(record.detail)
  const baselines = recordOf(record.baselines)
  const inlineStyles = recordOf(record.inlineStyles)
  const navigation = recordOf(record.navigation)
  if (handle === undefined || snapshot === undefined || rect === undefined || viewport === undefined
    || detail === undefined || baselines === undefined || inlineStyles === undefined || navigation === undefined
    || !exactKeys(baselines, EDITABLE_STYLE_PROPERTIES)
    || EDITABLE_STYLE_PROPERTIES.some(property => boundedString(
      baselines[property],
      PREVIEW_ELEMENT_LIMITS.styleValue,
    ) === undefined)
    || Object.keys(inlineStyles).some(property => !isEditableStyleProperty(property))
    || !exactKeys(navigation, ['child', 'parent', 'previous-sibling', 'next-sibling'])
    || Object.values(navigation).some(item => typeof item !== 'boolean')) return undefined
  const parsedInline: PreviewElementTarget['inlineStyles'] = {}
  for (const property of EDITABLE_STYLE_PROPERTIES) {
    const raw = inlineStyles[property]
    if (raw === undefined) continue
    const declaration = recordOf(raw)
    if (declaration === undefined || !exactKeys(declaration, ['value', 'priority'])) return undefined
    const inlineValue = boundedString(declaration.value, PREVIEW_ELEMENT_LIMITS.styleValue)
    const priority = boundedString(declaration.priority, PREVIEW_ELEMENT_LIMITS.stylePriority)
    if (inlineValue === undefined || priority === undefined) return undefined
    parsedInline[property] = { value: inlineValue, priority }
  }
  const originalText = record.originalText
  if (originalText !== null
    && boundedString(originalText, PREVIEW_ELEMENT_LIMITS.textValue) === undefined) return undefined
  return {
    handle,
    snapshot,
    rect,
    viewport,
    baselines: baselines as Record<EditableStyleProperty, string>,
    inlineStyles: parsedInline,
    originalText: originalText as string | null,
    detail,
    navigation: navigation as Record<PreviewElementNavigationAction, boolean>,
  }
}

/** Decode only the bridge envelope; event payloads are decoded by the consumer. */
export function previewFrameMessageOf(value: unknown): PreviewFrameMessage | undefined {
  const record = recordOf(value)
  if (record === undefined || record.protocol !== PREVIEW_BRIDGE_PROTOCOL
    || record.version !== PREVIEW_BRIDGE_VERSION || record.direction !== 'frame-to-host') return undefined
  const channel = channelOf(record.channel)
  if (channel === undefined) return undefined
  if (Object.hasOwn(record, 'event')) {
    if (!exactKeys(record, ['protocol', 'version', 'channel', 'direction', 'event'])) return undefined
    const event = recordOf(record.event)
    if (event === undefined || typeof event.name !== 'string' || !exactKeys(event, ['name', 'payload'])) return undefined
    return { protocol: PREVIEW_BRIDGE_PROTOCOL, version: PREVIEW_BRIDGE_VERSION, channel, direction: 'frame-to-host', event: event as unknown as PreviewFrameEvent }
  }
  if (!exactKeys(record, ['protocol', 'version', 'channel', 'direction', 'requestId', 'response'])) return undefined
  const requestId = boundedString(record.requestId, 64, false)
  const response = recordOf(record.response)
  if (requestId === undefined || response === undefined || typeof response.ok !== 'boolean') return undefined
  if (response.ok && exactKeys(response, ['ok', 'value'])) {
    return { protocol: PREVIEW_BRIDGE_PROTOCOL, version: PREVIEW_BRIDGE_VERSION, channel, direction: 'frame-to-host', requestId, response: { ok: true, value: response.value } }
  }
  const error = boundedString(response.error, 500, false)
  return !response.ok && exactKeys(response, ['ok', 'error']) && error !== undefined
    ? { protocol: PREVIEW_BRIDGE_PROTOCOL, version: PREVIEW_BRIDGE_VERSION, channel, direction: 'frame-to-host', requestId, response: { ok: false, error } }
    : undefined
}

/** Strictly decode one bounded serialized hierarchy. */
export function previewTreeOf(
  value: unknown,
  budget = PREVIEW_TREE_LIMITS.nodes,
): PreviewTreeNode | undefined {
  let remaining = budget
  const visit = (raw: unknown, depth: number): PreviewTreeNode | undefined => {
    if (remaining <= 0 || depth > PREVIEW_TREE_LIMITS.depth) return undefined
    remaining -= 1
    const record = recordOf(raw)
    if (record === undefined || !exactKeys(record, ['handle', 'key', 'tagName', 'detail', 'current', 'children'])) return undefined
    const handle = elementHandleOf(record.handle)
    const key = boundedString(record.key, PREVIEW_TREE_LIMITS.key, false)
    const tagName = boundedString(record.tagName, 64, false)
    const detail = treeDetailOf(record.detail)
    if (handle === undefined || key === undefined || tagName === undefined || detail === undefined
      || typeof record.current !== 'boolean' || !Array.isArray(record.children)
      || record.children.length > PREVIEW_TREE_LIMITS.nodes) return undefined
    const children: PreviewTreeNode[] = []
    for (const child of record.children) {
      const parsed = visit(child, depth + 1)
      if (parsed === undefined) return undefined
      children.push(parsed)
    }
    return { handle, key, tagName, detail, current: record.current, children }
  }
  return visit(value, 0)
}
