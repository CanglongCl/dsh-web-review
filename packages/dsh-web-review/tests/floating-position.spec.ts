import { describe, expect, it } from 'vitest'
import { placeFloatingEditor, type FloatingRect } from '../src/client/floating-position.ts'

const target = (top: number, left: number, width = 60, height = 30): FloatingRect => ({
  top,
  left,
  width,
  height,
  right: left + width,
  bottom: top + height,
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
