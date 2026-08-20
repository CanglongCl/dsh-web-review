/** Parent-side controller for one isolated cross-origin preview iframe. */
import type { AnnotationStyleChange, AnnotationTextChange } from '../annotation-contract.ts'
import type { EditableStyleProperty } from '../annotation-properties.ts'
import {
  PREVIEW_BRIDGE_PROTOCOL,
  PREVIEW_BRIDGE_VERSION,
  previewElementTargetOf,
  previewFrameMessageOf,
  previewPageSnapshotOf,
  previewSessionDescriptorOf,
  previewTreeOf,
  type PreviewBridgeCommand,
  type PreviewElementHandle,
  type PreviewElementNavigationAction,
  type PreviewElementTarget,
  type PreviewMarker,
  type PreviewPageSnapshot,
  type PreviewSessionDescriptor,
  type PreviewSessionId,
  type PreviewTreeNode,
} from '../preview-contract.ts'
import { isPreviewableUrl } from '../proxy-url.ts'
import type { PickItem } from './contract.ts'

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const MAX_BRIDGE_SESSIONS = 64

export interface PreviewReadyState {
  pageUrl: string
  title: string
  viewport: { width: number; height: number }
  canGoBack: boolean
  canGoForward: boolean
}

export interface PreviewBridgeCallbacks {
  onReady: (state: PreviewReadyState) => void
  onPick: (target: PreviewElementTarget) => void
  onCancelPick: () => void
  onMarkClick: (pickId: string) => void
  onTargetGeometry: (
    handle: PreviewElementHandle,
    rect: PreviewElementTarget['rect'],
    viewport: PreviewElementTarget['viewport'],
  ) => void
  onShortcut: (action: PreviewElementNavigationAction) => void
  onHandoff: (descriptor: PreviewSessionDescriptor) => void
  onUnavailable: () => void
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function exactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(record).length === keys.length && keys.every(key => Object.hasOwn(record, key))
}

function viewportOf(value: unknown): PreviewReadyState['viewport'] | undefined {
  const record = recordOf(value)
  if (record === undefined || !exactKeys(record, ['width', 'height'])
    || typeof record.width !== 'number' || typeof record.height !== 'number'
    || !Number.isFinite(record.width) || !Number.isFinite(record.height)
    || record.width < 0 || record.height < 0 || record.width > 100_000 || record.height > 100_000) return undefined
  return { width: Math.round(record.width), height: Math.round(record.height) }
}

function rectOf(value: unknown): PreviewElementTarget['rect'] | undefined {
  const record = recordOf(value)
  if (record === undefined || !exactKeys(record, ['x', 'y', 'width', 'height'])) return undefined
  const values = ['x', 'y', 'width', 'height'].map(key => record[key])
  if (values.some(item => typeof item !== 'number' || !Number.isFinite(item) || Math.abs(item) > 100_000)
    || (record.width as number) < 0 || (record.height as number) < 0) return undefined
  return record as unknown as PreviewElementTarget['rect']
}

function readyOf(value: unknown): PreviewReadyState | undefined {
  const record = recordOf(value)
  if (record === undefined || !exactKeys(record, [
    'pageUrl', 'title', 'viewport', 'canGoBack', 'canGoForward',
  ]) || typeof record.pageUrl !== 'string' || record.pageUrl.length > 4_096
    || !isPreviewableUrl(record.pageUrl) || typeof record.title !== 'string'
    || record.title.length > 500 || typeof record.canGoBack !== 'boolean'
    || typeof record.canGoForward !== 'boolean') return undefined
  const viewport = viewportOf(record.viewport)
  return viewport === undefined ? undefined : {
    pageUrl: record.pageUrl,
    title: record.title,
    viewport,
    canGoBack: record.canGoBack,
    canGoForward: record.canGoForward,
  }
}

function navigationActionOf(value: unknown): PreviewElementNavigationAction | undefined {
  return value === 'child' || value === 'parent' || value === 'previous-sibling' || value === 'next-sibling'
    ? value
    : undefined
}

/** One exact-source/exact-Origin bridge instance. */
export class PreviewBridgeClient {
  readonly sessionIds = new Set<PreviewSessionId>()
  private readonly descriptors = new Map<PreviewSessionId, PreviewSessionDescriptor>()
  private descriptor: PreviewSessionDescriptor
  private readonly pending = new Map<string, PendingRequest>()
  private requestSequence = 0
  private readyTimer: ReturnType<typeof setTimeout> | undefined
  private disposed = false

  constructor(
    private readonly frame: HTMLIFrameElement,
    descriptor: PreviewSessionDescriptor,
    private readonly callbacks: PreviewBridgeCallbacks,
  ) {
    this.descriptor = descriptor
    this.sessionIds.add(descriptor.sessionId)
    this.descriptors.set(descriptor.sessionId, descriptor)
    window.addEventListener('message', this.onMessage)
    this.armReadyTimeout()
  }

  get frameUrl(): string { return this.descriptor.frameUrl }

  private readonly onMessage = (event: MessageEvent<unknown>): void => {
    if (this.disposed || event.source !== this.frame.contentWindow) return
    const message = previewFrameMessageOf(event.data)
    if (message === undefined) return
    const matched = [...this.descriptors.values()].find(descriptor => (
      event.origin === descriptor.frameOrigin && message.channel === descriptor.channel
    ))
    if (matched === undefined) return
    if (matched.sessionId !== this.descriptor.sessionId) {
      // A known prior Origin can become current through iframe history. Probe
      // messages are sent to every known descriptor on load; targetOrigin
      // guarantees that only the document actually loaded can answer.
      if (!('event' in message) || message.event.name !== 'ready') return
      this.rejectPending('preview history changed Origin')
      this.descriptor = matched
      this.armReadyTimeout()
      this.callbacks.onHandoff(matched)
    }
    if ('response' in message) {
      const pending = this.pending.get(message.requestId)
      if (pending === undefined) return
      this.pending.delete(message.requestId)
      clearTimeout(pending.timer)
      if (message.response.ok) pending.resolve(message.response.value)
      else pending.reject(new Error(message.response.error))
      return
    }
    const { event: frameEvent } = message
    const payload = frameEvent.payload as unknown
    if (frameEvent.name === 'ready') {
      const ready = readyOf(payload)
      if (ready === undefined || new URL(ready.pageUrl).origin !== matched.targetOrigin) return
      if (this.readyTimer !== undefined) clearTimeout(this.readyTimer)
      this.readyTimer = undefined
      this.callbacks.onReady(ready)
      return
    }
    if (frameEvent.name === 'pick') {
      const record = recordOf(payload)
      const target = record === undefined || !exactKeys(record, ['target'])
        ? undefined
        : previewElementTargetOf(record.target)
      if (target !== undefined) this.callbacks.onPick(target)
      return
    }
    if (frameEvent.name === 'cancel-pick') {
      if (payload === null) this.callbacks.onCancelPick()
      return
    }
    if (frameEvent.name === 'mark-click') {
      const record = recordOf(payload)
      if (record !== undefined && exactKeys(record, ['pickId']) && typeof record.pickId === 'string'
        && record.pickId.length <= 128) this.callbacks.onMarkClick(record.pickId)
      return
    }
    if (frameEvent.name === 'target-geometry') {
      const record = recordOf(payload)
      if (record === undefined || !exactKeys(record, ['handle', 'rect', 'viewport'])
        || typeof record.handle !== 'string' || !/^[a-f\d]{16,32}$/u.test(record.handle)) return
      const rect = rectOf(record.rect)
      const viewport = viewportOf(record.viewport)
      if (rect !== undefined && viewport !== undefined) {
        this.callbacks.onTargetGeometry(record.handle as PreviewElementHandle, rect, viewport)
      }
      return
    }
    if (frameEvent.name === 'shortcut') {
      const record = recordOf(payload)
      const action = navigationActionOf(record?.action)
      if (record !== undefined && exactKeys(record, ['action']) && action !== undefined) {
        this.callbacks.onShortcut(action)
      }
      return
    }
    if (frameEvent.name === 'handoff') {
      const descriptor = previewSessionDescriptorOf(payload)
      if (descriptor === undefined || this.descriptors.has(descriptor.sessionId)
        || this.descriptors.size >= MAX_BRIDGE_SESSIONS) return
      this.rejectPending('preview navigated')
      this.descriptor = descriptor
      this.sessionIds.add(descriptor.sessionId)
      this.descriptors.set(descriptor.sessionId, descriptor)
      this.armReadyTimeout()
      this.callbacks.onHandoff(descriptor)
    }
  }

  private rejectPending(message: string): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error(message))
    }
    this.pending.clear()
  }

  private armReadyTimeout(): void {
    if (this.readyTimer !== undefined) clearTimeout(this.readyTimer)
    this.readyTimer = setTimeout(() => {
      this.readyTimer = undefined
      if (!this.disposed) this.callbacks.onUnavailable()
    }, 15_000)
  }

  frameLoaded(): void {
    if (this.disposed) return
    this.armReadyTimeout()
    const target = this.frame.contentWindow
    if (target === null) return
    for (const descriptor of this.descriptors.values()) {
      this.requestSequence += 1
      target.postMessage({
        protocol: PREVIEW_BRIDGE_PROTOCOL,
        version: PREVIEW_BRIDGE_VERSION,
        channel: descriptor.channel,
        direction: 'host-to-frame' as const,
        requestId: `probe-${String(this.requestSequence)}`,
        command: { name: 'request-ready', payload: null },
      }, descriptor.frameOrigin)
    }
  }

  private command(command: PreviewBridgeCommand): Promise<unknown> {
    if (this.disposed) return Promise.reject(new Error('preview bridge disposed'))
    const target = this.frame.contentWindow
    if (target === null) return Promise.reject(new Error('preview frame unavailable'))
    this.requestSequence += 1
    const requestId = `${String(this.requestSequence)}-${Date.now().toString(36)}`
    const message = {
      protocol: PREVIEW_BRIDGE_PROTOCOL,
      version: PREVIEW_BRIDGE_VERSION,
      channel: this.descriptor.channel,
      direction: 'host-to-frame' as const,
      requestId,
      command,
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error('preview bridge command timed out'))
      }, 5_000)
      this.pending.set(requestId, { resolve, reject, timer })
      target.postMessage(message, this.descriptor.frameOrigin)
    })
  }

  activate(): void { void this.command({ name: 'activate', payload: null }).catch(() => undefined) }
  deactivate(): void { void this.command({ name: 'deactivate', payload: null }).catch(() => undefined) }
  clearSelection(): void { void this.command({ name: 'clear-selection', payload: null }).catch(() => undefined) }

  syncMarkers(picks: readonly PickItem[]): void {
    const markers: PreviewMarker[] = picks.map((pick, index) => ({
      id: pick.id,
      index: index + 1,
      cssPath: pick.snapshot.cssPath,
      changes: pick.changes,
      textChange: pick.textChange,
    }))
    void this.command({ name: 'sync-markers', payload: { markers } }).catch(() => undefined)
  }

  async openPick(pickId: string, cssPath: string): Promise<PreviewElementTarget | null> {
    const value = await this.command({ name: 'open-pick', payload: { pickId, cssPath } })
    return value === null ? null : previewElementTargetOf(value) ?? null
  }

  async navigateElement(
    handle: PreviewElementHandle,
    action: PreviewElementNavigationAction,
  ): Promise<PreviewElementTarget | null> {
    const value = await this.command({ name: 'navigate-element', payload: { handle, action } })
    return value === null ? null : previewElementTargetOf(value) ?? null
  }

  async selectElement(handle: PreviewElementHandle): Promise<PreviewElementTarget | null> {
    const value = await this.command({ name: 'select-element', payload: { handle } })
    return value === null ? null : previewElementTargetOf(value) ?? null
  }

  async readTree(handle: PreviewElementHandle): Promise<PreviewTreeNode | null> {
    return previewTreeOf(await this.command({ name: 'read-tree', payload: { handle } })) ?? null
  }

  async captureSnapshot(): Promise<PreviewPageSnapshot | null> {
    const value = await this.command({ name: 'capture-snapshot', payload: null })
    return value === null ? null : previewPageSnapshotOf(value) ?? null
  }

  previewStyle(handle: PreviewElementHandle, property: EditableStyleProperty, value: string): void {
    void this.command({ name: 'preview-style', payload: { handle, property, value } }).catch(() => undefined)
  }

  restoreStyle(handle: PreviewElementHandle, property: EditableStyleProperty): void {
    void this.command({ name: 'restore-style', payload: { handle, property } }).catch(() => undefined)
  }

  previewText(handle: PreviewElementHandle, value: string): void {
    void this.command({ name: 'preview-text', payload: { handle, value } }).catch(() => undefined)
  }

  restoreText(handle: PreviewElementHandle): void {
    void this.command({ name: 'restore-text', payload: { handle } }).catch(() => undefined)
  }

  cancelEdit(): void { void this.command({ name: 'cancel-edit', payload: null }).catch(() => undefined) }

  commitEdit(
    pickId: string,
    handle: PreviewElementHandle,
    changes: AnnotationStyleChange[],
    textChange: AnnotationTextChange | null,
  ): void {
    void this.command({
      name: 'commit-edit',
      payload: { pickId, handle, changes, textChange },
    }).catch(() => undefined)
  }

  historyBack(): void { void this.command({ name: 'history-back', payload: null }).catch(() => undefined) }
  historyForward(): void { void this.command({ name: 'history-forward', payload: null }).catch(() => undefined) }
  reload(): void { void this.command({ name: 'reload', payload: null }).catch(() => undefined) }

  dispose(): PreviewSessionId[] {
    if (this.disposed) return []
    this.disposed = true
    window.removeEventListener('message', this.onMessage)
    if (this.readyTimer !== undefined) clearTimeout(this.readyTimer)
    this.rejectPending('preview bridge disposed')
    return [...this.sessionIds]
  }
}
