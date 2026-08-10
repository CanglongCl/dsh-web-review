import { describe, expect, it } from 'vitest'
import {
  expandQuad,
  parseSimpleShadow,
  parseSimpleTransform,
  serializeQuad,
  serializeSimpleShadow,
  serializeSimpleTransform,
} from '../src/client/composite-properties.ts'

describe('composite property parsing', () => {
  it('expands and serializes CSS quad shorthands', () => {
    expect(expandQuad('8px')).toEqual(['8px', '8px', '8px', '8px'])
    expect(expandQuad('4px 8px 12px')).toEqual(['4px', '8px', '12px', '8px'])
    expect(expandQuad('4px / 8px')).toBeNull()
    expect(serializeQuad(['1px', '2px', '3px', '4px'], false)).toBe('1px 2px 3px 4px')
  })

  it('parses one shadow without flattening shadow lists', () => {
    const shadow = parseSimpleShadow('rgba(0, 0, 0, 0.2) 0px 4px 12px 0px')
    expect(shadow).toEqual({
      inset: false,
      color: 'rgba(0, 0, 0, 0.2)',
      colorFirst: true,
      lengths: ['0px', '4px', '12px', '0px'],
      arity: 4,
    })
    expect(serializeSimpleShadow({ ...shadow!, inset: true })).toBe('rgba(0, 0, 0, 0.2) 0px 4px 12px 0px inset')
    expect(parseSimpleShadow('0 1px 2px #000, 0 2px 4px #fff')).toBeNull()
  })

  it('preserves supported transform operation order and rejects matrices', () => {
    const transform = parseSimpleTransform('rotate(10deg) translateX(4px) scaleY(1.2)')
    expect(transform?.order).toEqual(['rotate', 'translateX', 'scaleY'])
    expect(serializeSimpleTransform(transform!)).toBe('rotate(10deg) translateX(4px) scaleY(1.2)')
    expect(serializeSimpleTransform({ ...transform!, values: { ...transform!.values, translateY: '8px' } }))
      .toBe('rotate(10deg) translateX(4px) scaleY(1.2) translateY(8px)')
    expect(parseSimpleTransform('matrix(1, 0, 0, 1, 0, 0)')).toBeNull()
  })
})
