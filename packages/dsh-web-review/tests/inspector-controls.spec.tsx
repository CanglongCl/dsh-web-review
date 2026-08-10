// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ColorControl,
  parseColor,
  parseNumeric,
  ScrubNumber,
  SegmentedControl,
  TextField,
} from '../src/client/InspectorControls.tsx'

afterEach(cleanup)

describe('Inspector controls', () => {
  it('parses unit-bearing numbers and CSS colors without coercing invalid input', () => {
    expect(parseNumeric(' 12.5px ')).toEqual({ number: 12.5, unit: 'px' })
    expect(parseNumeric('auto')).toBeNull()
    expect(parseColor('#613838')).toEqual({ r: 97, g: 56, b: 56, a: 1 })
    expect(parseColor('rgba(1, 2, 3, .5)')).toEqual({ r: 1, g: 2, b: 3, a: 0.5 })
    expect(parseColor('currentColor')).toBeNull()
  })

  it('increments scrub values with keyboard modifiers and restores the focus value on Escape', () => {
    const change = vi.fn()
    const view = render(<ScrubNumber label="Size" value="12px" step={1} onChange={change} />)
    const input = screen.getByLabelText('Size')
    fireEvent.keyDown(input, { key: 'ArrowUp', shiftKey: true })
    expect(change).toHaveBeenLastCalledWith('22px')

    view.rerender(<ScrubNumber label="Size" value="22px" step={1} onChange={change} />)
    fireEvent.focus(input)
    view.rerender(<ScrubNumber label="Size" value="31px" step={1} onChange={change} />)
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(change).toHaveBeenLastCalledWith('22px')
  })

  it('converts CSS keyword baselines into numeric values on the first adjustment', () => {
    const change = vi.fn()
    render(<ScrubNumber label="Line height" value="normal" fallbackValue="19.2px" step={1} onChange={change} />)
    fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'Line height' }), { key: 'ArrowUp' })
    expect(change).toHaveBeenCalledWith('20.2px')
  })

  it('restores text fields on Escape and supports arrow navigation in segmented controls', () => {
    const textChange = vi.fn()
    const view = render(<TextField label="Raw" value="normal" onChange={textChange} />)
    const input = screen.getByLabelText('Raw')
    fireEvent.focus(input)
    view.rerender(<TextField label="Raw" value="edited" onChange={textChange} />)
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(textChange).toHaveBeenLastCalledWith('normal')

    const segmentChange = vi.fn()
    view.rerender(
      <SegmentedControl
        label="Alignment"
        value="left"
        options={[
          { value: 'left', label: 'Left', content: 'L' },
          { value: 'center', label: 'Center', content: 'C' },
          { value: 'right', label: 'Right', content: 'R' },
        ]}
        onChange={segmentChange}
      />,
    )
    fireEvent.keyDown(screen.getByRole('button', { name: 'Left' }), { key: 'ArrowRight' })
    expect(segmentChange).toHaveBeenCalledWith('center')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Center' }))
  })

  it('opens the color popover and preserves alpha while changing the spectrum', () => {
    const change = vi.fn()
    render(<ColorControl label="Text color" value="rgba(97, 56, 56, .5)" onChange={change} />)
    fireEvent.click(screen.getByRole('button', { name: 'Text color' }))
    fireEvent.change(screen.getByLabelText('Text color · 色谱'), { target: { value: '#112233' } })
    expect(change).toHaveBeenCalledWith('rgba(17, 34, 51, 0.5)')
  })

  it('closes the color popover with Escape without bubbling to the editor', () => {
    const outerKey = vi.fn()
    render(<div onKeyDown={outerKey}><ColorControl label="Text color" value="#613838" onChange={vi.fn()} /></div>)
    const trigger = screen.getByRole('button', { name: 'Text color' })
    fireEvent.click(trigger)
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Text color · 颜色选择器' }), { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Text color · 颜色选择器' })).toBeNull()
    expect(outerKey).not.toHaveBeenCalled()
  })
})
