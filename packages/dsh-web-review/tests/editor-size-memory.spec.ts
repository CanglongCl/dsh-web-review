import { describe, expect, it, vi } from 'vitest'
import {
  EDITOR_SIZE_STORAGE_KEY,
  readEditorSize,
  writeEditorSize,
} from '../src/client/editor-size-memory.ts'

describe('editor size memory', () => {
  it('round-trips a committed preferred size', () => {
    let saved: string | null = null
    const storage = {
      getItem: vi.fn(() => saved),
      setItem: vi.fn((_key: string, value: string) => { saved = value }),
    }
    writeEditorSize(storage, { width: 438, height: 512 })
    expect(storage.setItem).toHaveBeenCalledWith(
      EDITOR_SIZE_STORAGE_KEY,
      '{"width":438,"height":512}',
    )
    expect(readEditorSize(storage)).toEqual({ width: 438, height: 512 })
  })

  it('ignores corrupt, unsafe, and unavailable storage', () => {
    expect(readEditorSize({ getItem: () => '{bad json' })).toBeNull()
    expect(readEditorSize({ getItem: () => '{"width":0,"height":300}' })).toBeNull()
    expect(readEditorSize({ getItem: () => '{"width":320,"height":10001}' })).toBeNull()
    expect(readEditorSize({ getItem: () => { throw new Error('blocked') } })).toBeNull()
    expect(() => {
      writeEditorSize({ setItem: () => { throw new Error('full') } }, { width: 400, height: 500 })
    }).not.toThrow()
  })
})
