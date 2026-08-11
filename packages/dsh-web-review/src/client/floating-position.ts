export interface FloatingRect {
  top: number
  right: number
  bottom: number
  left: number
  width: number
  height: number
}

export interface FloatingEditorPlacement {
  left: number
  top: number
  maxHeight: number
  side: 'above' | 'below' | 'left' | 'right' | 'overlap'
}

/** User-controlled editor coordinates in the preview surface. */
export interface FloatingEditorPosition {
  left: number
  top: number
}

/** User-controlled editor dimensions in the preview surface. */
export interface FloatingEditorSize {
  width: number
  height: number
}

export type FloatingEditorResizeEdge = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'

const MARGIN = 8
const GAP = 8

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

/** Keep a manually positioned editor fully inside the preview surface. */
export function clampFloatingEditorPosition({
  position,
  surfaceWidth,
  surfaceHeight,
  editorWidth,
  editorHeight,
}: {
  position: FloatingEditorPosition
  surfaceWidth: number
  surfaceHeight: number
  editorWidth: number
  editorHeight: number
}): FloatingEditorPosition {
  return {
    left: clamp(position.left, MARGIN, surfaceWidth - editorWidth - MARGIN),
    top: clamp(position.top, MARGIN, surfaceHeight - editorHeight - MARGIN),
  }
}

/** Resize from any edge while keeping the opposite edge fixed and in bounds. */
export function resizeFloatingEditor({
  edge,
  position,
  size,
  deltaX,
  deltaY,
  surfaceWidth,
  surfaceHeight,
  minWidth,
  minHeight,
}: {
  edge: FloatingEditorResizeEdge
  position: FloatingEditorPosition
  size: FloatingEditorSize
  deltaX: number
  deltaY: number
  surfaceWidth: number
  surfaceHeight: number
  minWidth: number
  minHeight: number
}): { position: FloatingEditorPosition; size: FloatingEditorSize } {
  const maxSurfaceWidth = Math.max(0, surfaceWidth - MARGIN * 2)
  const maxSurfaceHeight = Math.max(0, surfaceHeight - MARGIN * 2)
  const boundedMinWidth = Math.min(minWidth, maxSurfaceWidth)
  const boundedMinHeight = Math.min(minHeight, maxSurfaceHeight)
  const right = position.left + size.width
  const bottom = position.top + size.height
  let left = position.left
  let top = position.top
  let width = size.width
  let height = size.height

  if (edge.includes('w')) {
    left = clamp(position.left + deltaX, MARGIN, right - boundedMinWidth)
    width = right - left
  } else if (edge.includes('e')) {
    width = clamp(size.width + deltaX, boundedMinWidth, surfaceWidth - MARGIN - position.left)
  }
  if (edge.includes('n')) {
    top = clamp(position.top + deltaY, MARGIN, bottom - boundedMinHeight)
    height = bottom - top
  } else if (edge.includes('s')) {
    height = clamp(size.height + deltaY, boundedMinHeight, surfaceHeight - MARGIN - position.top)
  }

  return { position: { left, top }, size: { width, height } }
}

/** Place a host editor beside its iframe-local target, shrinking before overlap. */
export function placeFloatingEditor({
  target,
  surfaceWidth,
  surfaceHeight,
  editorWidth,
  editorHeight,
  minHeight,
}: {
  target: FloatingRect
  surfaceWidth: number
  surfaceHeight: number
  editorWidth: number
  editorHeight: number
  minHeight: number
}): FloatingEditorPlacement {
  const boundedHeight = Math.min(editorHeight, Math.max(minHeight, surfaceHeight - MARGIN * 2))
  const leftAligned = clamp(target.left, MARGIN, surfaceWidth - editorWidth - MARGIN)
  const aboveSpace = target.top - GAP - MARGIN
  const belowSpace = surfaceHeight - target.bottom - GAP - MARGIN

  // Prefer the roomier vertical side. A scrollable editor may shrink to fit,
  // but never below its compact usable height.
  const vertical = belowSpace > aboveSpace
    ? [{ side: 'below' as const, space: belowSpace }, { side: 'above' as const, space: aboveSpace }]
    : [{ side: 'above' as const, space: aboveSpace }, { side: 'below' as const, space: belowSpace }]
  for (const candidate of vertical) {
    if (candidate.space < minHeight) continue
    const maxHeight = Math.min(boundedHeight, candidate.space)
    return {
      left: leftAligned,
      top: candidate.side === 'above' ? target.top - GAP - maxHeight : target.bottom + GAP,
      maxHeight,
      side: candidate.side,
    }
  }

  // Side placement keeps full height and is useful in wide preview panels.
  const rightSpace = surfaceWidth - target.right - GAP - MARGIN
  const leftSpace = target.left - GAP - MARGIN
  if (rightSpace >= editorWidth || leftSpace >= editorWidth) {
    const side = rightSpace >= leftSpace ? 'right' as const : 'left' as const
    return {
      left: side === 'right' ? target.right + GAP : target.left - GAP - editorWidth,
      top: clamp(target.top + (target.height - boundedHeight) / 2, MARGIN, surfaceHeight - boundedHeight - MARGIN),
      maxHeight: boundedHeight,
      side,
    }
  }

  // A large target can leave no clear side. Keep the editor within the frame
  // and anchor it toward the larger remaining region; overlap is unavoidable.
  const preferBelow = belowSpace >= aboveSpace
  return {
    left: leftAligned,
    top: preferBelow
      ? clamp(target.bottom + GAP, MARGIN, surfaceHeight - boundedHeight - MARGIN)
      : clamp(target.top - GAP - boundedHeight, MARGIN, surfaceHeight - boundedHeight - MARGIN),
    maxHeight: boundedHeight,
    side: 'overlap',
  }
}
