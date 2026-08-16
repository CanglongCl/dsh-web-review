// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import {
  PREVIEW_BRIDGE_PROTOCOL,
  PREVIEW_BRIDGE_VERSION,
  type PreviewChannel,
  type PreviewSessionDescriptor,
  type PreviewSessionId,
} from '../src/preview-contract.ts'
import { PreviewBridgeClient } from '../src/client/preview-bridge.ts'

function descriptor(seed: string): PreviewSessionDescriptor {
  const sessionId = seed.repeat(32).slice(0, 32) as PreviewSessionId
  const channel = `${seed}f`.repeat(32).slice(0, 32) as PreviewChannel
  const frameOrigin = `http://${sessionId}.localhost:41234`
  return {
    sessionId,
    channel,
    frameOrigin,
    frameUrl: `${frameOrigin}/.dsh-web-review/entry/https%3A//example.com/`,
    targetOrigin: 'https://example.com',
    snapshotsEnabled: true,
  }
}

function frameMessage(
  frame: HTMLIFrameElement,
  active: PreviewSessionDescriptor,
  event: { name: string; payload: unknown },
  overrides: { source?: MessageEventSource | null; origin?: string; channel?: string } = {},
): MessageEvent<unknown> {
  return new MessageEvent('message', {
    source: overrides.source === undefined ? frame.contentWindow : overrides.source,
    origin: overrides.origin ?? active.frameOrigin,
    data: {
      protocol: PREVIEW_BRIDGE_PROTOCOL,
      version: PREVIEW_BRIDGE_VERSION,
      channel: overrides.channel ?? active.channel,
      direction: 'frame-to-host',
      event,
    },
  })
}

describe('PreviewBridgeClient trust boundary', () => {
  it('requires exact source, Origin and channel across handoffs and known history entries', () => {
    const first = descriptor('a')
    const second = descriptor('b')
    const frame = document.createElement('iframe')
    document.body.appendChild(frame)
    const onReady = vi.fn()
    const onHandoff = vi.fn()
    const client = new PreviewBridgeClient(frame, first, {
      onReady,
      onHandoff,
      onPick: vi.fn(),
      onCancelPick: vi.fn(),
      onMarkClick: vi.fn(),
      onTargetGeometry: vi.fn(),
      onShortcut: vi.fn(),
      onUnavailable: vi.fn(),
    })
    const ready = {
      name: 'ready',
      payload: {
        pageUrl: 'https://example.com/', title: 'Example',
        viewport: { width: 800, height: 600 }, canGoBack: false, canGoForward: false,
      },
    }
    window.dispatchEvent(frameMessage(frame, first, ready, { source: window }))
    window.dispatchEvent(frameMessage(frame, first, ready, { origin: 'http://evil.localhost:41234' }))
    window.dispatchEvent(frameMessage(frame, first, ready, { channel: '0'.repeat(32) }))
    expect(onReady).not.toHaveBeenCalled()
    window.dispatchEvent(frameMessage(frame, first, {
      ...ready,
      payload: { ...ready.payload, pageUrl: 'https://spoofed.example/' },
    }))
    expect(onReady).not.toHaveBeenCalled()
    window.dispatchEvent(frameMessage(frame, first, ready))
    expect(onReady).toHaveBeenCalledOnce()

    window.dispatchEvent(frameMessage(frame, first, {
      name: 'handoff',
      payload: { ...second, sessionId: first.sessionId },
    }))
    expect(onHandoff).not.toHaveBeenCalled()
    window.dispatchEvent(frameMessage(frame, first, {
      name: 'handoff',
      payload: { ...second, targetOrigin: 'https://spoofed.example' },
    }))
    expect(onHandoff).not.toHaveBeenCalled()
    window.dispatchEvent(frameMessage(frame, first, { name: 'handoff', payload: second }))
    expect(onHandoff).toHaveBeenCalledWith(second)
    const unknown = descriptor('d')
    window.dispatchEvent(frameMessage(frame, unknown, ready))
    expect(onReady).toHaveBeenCalledOnce()
    window.dispatchEvent(frameMessage(frame, first, ready))
    expect(onHandoff).toHaveBeenLastCalledWith(first)
    expect(onReady).toHaveBeenCalledTimes(2)
    window.dispatchEvent(frameMessage(frame, second, ready))
    expect(onHandoff).toHaveBeenLastCalledWith(second)
    expect(onReady).toHaveBeenCalledTimes(3)
    expect(client.dispose()).toEqual([first.sessionId, second.sessionId])
  })

  it('posts commands only to the descriptor Origin', () => {
    const active = descriptor('c')
    const frame = document.createElement('iframe')
    document.body.appendChild(frame)
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => undefined)
    const client = new PreviewBridgeClient(frame, active, {
      onReady: vi.fn(), onHandoff: vi.fn(), onPick: vi.fn(), onCancelPick: vi.fn(),
      onMarkClick: vi.fn(), onTargetGeometry: vi.fn(), onShortcut: vi.fn(), onUnavailable: vi.fn(),
    })
    client.activate()
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      protocol: PREVIEW_BRIDGE_PROTOCOL,
      channel: active.channel,
      direction: 'host-to-frame',
    }), active.frameOrigin)
    client.dispose()
  })
})
