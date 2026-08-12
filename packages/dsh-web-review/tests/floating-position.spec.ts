import { describe, expect, it } from 'vitest'
import {
  clampFloatingEditorPosition,
  placeFloatingEditor,
  resizeFloatingEditor,
  type FloatingRect,
} from '../src/client/floating-position.ts'

const target = (top: number, left: number, width = 60, height = 30): FloatingRect => ({
  top,
  left,
  width,
  height,
  right: left + width,
  bottom: top + height,
})

describe('resizeFloatingEditor', () => {
  it('resizes from a corner while keeping the opposite corner fixed', () => {
    expect(resizeFloatingEditor({
      edge: 'nw',
      position: { left: 100, top: 80 },
      size: { width: 400, height: 320 },
      deltaX: 40,
      deltaY: 30,
      surfaceWidth: 800,
      surfaceHeight: 600,
      minWidth: 320,
      minHeight: 300,
    })).toEqual({
      position: { left: 140, top: 100 },
      size: { width: 360, height: 300 },
    })
  })

  it('enforces minimum dimensions and the eight-pixel surface margin', () => {
    expect(resizeFloatingEditor({
      edge: 'se',
      position: { left: 100, top: 80 },
      size: { width: 400, height: 320 },
      deltaX: 900,
      deltaY: 900,
      surfaceWidth: 800,
      surfaceHeight: 600,
      minWidth: 320,
      minHeight: 300,
    })).toEqual({
      position: { left: 100, top: 80 },
      size: { width: 692, height: 512 },
    })

    expect(resizeFloatingEditor({
      edge: 'nw',
      position: { left: 100, top: 80 },
      size: { width: 400, height: 320 },
      deltaX: 900,
      deltaY: 900,
      surfaceWidth: 800,
      surfaceHeight: 600,
      minWidth: 320,
      minHeight: 300,
    })).toEqual({
      position: { left: 180, top: 100 },
      size: { width: 320, height: 300 },
    })
  })
})

describe('placeFloatingEditor', () => {
  it('uses the roomier vertical side without covering the target', () => {
    const below = placeFloatingEditor({
      target: target(100, 60), surfaceWidth: 500, surfaceHeight: 600,
      editorWidth: 414, editorHeight: 430, minHeight: 260,
    })
    expect(below.side).toBe('below')
    expect(below.top).toBe(138)

    const above = placeFloatingEditor({
      target: target(520, 60), surfaceWidth: 500, surfaceHeight: 600,
      editorWidth: 414, editorHeight: 430, minHeight: 260,
    })
    expect(above.side).toBe('above')
    expect(above.top + above.maxHeight).toBe(512)
  })

  it('shrinks a scrollable editor to the clear vertical region', () => {
    const placement = placeFloatingEditor({
      target: target(100, 60), surfaceWidth: 500, surfaceHeight: 500,
      editorWidth: 414, editorHeight: 430, minHeight: 260,
    })
    expect(placement.side).toBe('below')
    expect(placement.maxHeight).toBe(354)
    expect(placement.top + placement.maxHeight).toBe(492)
  })

  it('uses a clear horizontal side when neither vertical region is usable', () => {
    const placement = placeFloatingEditor({
      target: target(240, 180, 40, 40), surfaceWidth: 900, surfaceHeight: 520,
      editorWidth: 414, editorHeight: 430, minHeight: 260,
    })
    expect(placement.side).toBe('right')
    expect(placement.left).toBe(228)
  })

  it('stays inside the frame when a large target makes overlap unavoidable', () => {
    const placement = placeFloatingEditor({
      target: target(0, 0, 480, 560), surfaceWidth: 480, surfaceHeight: 560,
      editorWidth: 414, editorHeight: 430, minHeight: 260,
    })
    expect(placement.side).toBe('overlap')
    expect(placement.left).toBeGreaterThanOrEqual(8)
    expect(placement.top).toBeGreaterThanOrEqual(8)
    expect(placement.top + placement.maxHeight).toBeLessThanOrEqual(552)
  })
})

describe('clampFloatingEditorPosition', () => {
  it('keeps a manually moved editor inside the eight-pixel surface margin', () => {
    expect(clampFloatingEditorPosition({
      position: { left: -40, top: 900 },
      surfaceWidth: 500,
      surfaceHeight: 600,
      editorWidth: 300,
      editorHeight: 240,
    })).toEqual({ left: 8, top: 352 })
  })

  it('keeps the toolbar origin reachable when the editor is larger than the surface', () => {
    expect(clampFloatingEditorPosition({
      position: { left: 100, top: 100 },
      surfaceWidth: 280,
      surfaceHeight: 200,
      editorWidth: 320,
      editorHeight: 240,
    })).toEqual({ left: 8, top: 8 })
  })
})
