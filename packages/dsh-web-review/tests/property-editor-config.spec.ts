import { describe, expect, it } from 'vitest'
import { EDITABLE_STYLE_PROPERTIES } from '../src/annotation-properties.ts'
import { PROPERTY_GROUPS } from '../src/client/property-editor-config.ts'

describe('rich annotation property registry', () => {
  it('exposes every allowed property exactly once in the inspector', () => {
    const controls = PROPERTY_GROUPS.flatMap(group => group.controls.map(control => control.property))
    expect(new Set(controls).size).toBe(controls.length)
    expect([...controls].sort()).toEqual([...EDITABLE_STYLE_PROPERTIES].sort())
  })
})
