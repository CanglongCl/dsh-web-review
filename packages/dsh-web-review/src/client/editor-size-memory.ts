import type { FloatingEditorSize } from './floating-position.ts'

export const EDITOR_SIZE_STORAGE_KEY = 'dsh-web-review.editor-size.v1'

function validDimension(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 10_000
}

/** Read a user preference defensively; corrupt or unavailable storage is ignored. */
export function readEditorSize(storage: Pick<Storage, 'getItem'>): FloatingEditorSize | null {
  try {
    const raw = storage.getItem(EDITOR_SIZE_STORAGE_KEY)
    if (raw === null) return null
    const value = JSON.parse(raw) as Partial<FloatingEditorSize>
    if (!validDimension(value.width) || !validDimension(value.height)) return null
    return { width: value.width, height: value.height }
  } catch {
    return null
  }
}

/** Persist only committed geometry; transient pointer moves never write here. */
export function writeEditorSize(
  storage: Pick<Storage, 'setItem'>,
  size: FloatingEditorSize,
): void {
  try {
    storage.setItem(EDITOR_SIZE_STORAGE_KEY, JSON.stringify(size))
  } catch {
    // Storage can be disabled or full; resizing remains functional in memory.
  }
}
