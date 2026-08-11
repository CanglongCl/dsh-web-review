import { describe, expect, it } from 'vitest'
import { EDITABLE_STYLE_PROPERTIES } from '../src/annotation-properties.ts'
import { PROPERTY_BY_NAME, PROPERTY_GROUPS } from '../src/client/property-editor-config.ts'

describe('rich annotation property registry', () => {
  it('exposes every allowed property exactly once in the inspector', () => {
    const controls = PROPERTY_GROUPS.flatMap(group => group.controls.map(control => control.property))
    expect(new Set(controls).size).toBe(controls.length)
    expect([...controls].sort()).toEqual([...EDITABLE_STYLE_PROPERTIES].sort())
  })

  it('maps every mixed numeric property to its stable CSS keyword suggestions', () => {
    const suggestions = Object.fromEntries(
      [...PROPERTY_BY_NAME].flatMap(([property, control]) => control.kind === 'number' && control.options !== undefined
        ? [[property, control.options]]
        : []),
    )
    expect(suggestions).toEqual({
      'font-size': ['xx-small', 'x-small', 'small', 'medium', 'large', 'x-large', 'xx-large', 'xxx-large', 'smaller', 'larger'],
      'line-height': ['normal'],
      'letter-spacing': ['normal'],
      width: ['auto', 'min-content', 'max-content', 'fit-content'],
      height: ['auto', 'min-content', 'max-content', 'fit-content'],
      'min-width': ['auto', 'min-content', 'max-content', 'fit-content'],
      'max-width': ['none', 'min-content', 'max-content', 'fit-content'],
      'min-height': ['auto', 'min-content', 'max-content', 'fit-content'],
      'max-height': ['none', 'min-content', 'max-content', 'fit-content'],
      top: ['auto'], right: ['auto'], bottom: ['auto'], left: ['auto'], 'z-index': ['auto'],
      gap: ['normal'], 'row-gap': ['normal'], 'column-gap': ['normal'],
      'margin-top': ['auto'], 'margin-right': ['auto'], 'margin-bottom': ['auto'], 'margin-left': ['auto'],
      'border-width': ['thin', 'medium', 'thick'],
    })
    expect(PROPERTY_BY_NAME.get('padding-top')).toMatchObject({ kind: 'number' })
    expect('options' in PROPERTY_BY_NAME.get('padding-top')!).toBe(false)
    expect(PROPERTY_BY_NAME.get('display')).toMatchObject({ kind: 'menu' })
  })
})
