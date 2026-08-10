// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BoxModelControl,
  ColorControl,
  parseColor,
  parseNumeric,
  ScrubNumber,
  SegmentedControl,
  TextField,
  updateBoxModelLinks,
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

  it('reports the complete pointer scrub lifecycle after the drag threshold', () => {
    const change = vi.fn()
    const scrub = vi.fn()
    const view = render(<ScrubNumber label="Size" value="12px" step={1} onChange={change} onScrubChange={scrub} />)
    const handle = screen.getByRole('button', { name: 'Size · 拖动调整' })
    const pointer = (type: string, clientX: number) => { fireEvent(handle, new MouseEvent(type, { bubbles: true, clientX })) }

    pointer('pointerdown', 100)
    pointer('pointermove', 102)
    expect(scrub).not.toHaveBeenCalled()
    pointer('pointermove', 104)
    expect(scrub.mock.calls).toEqual([[true]])
    expect(change).toHaveBeenLastCalledWith('16px')
    pointer('pointerup', 104)
    expect(scrub.mock.calls).toEqual([[true], [false]])

    scrub.mockClear()
    pointer('pointerdown', 40)
    pointer('pointermove', 50)
    pointer('pointercancel', 50)
    expect(change).toHaveBeenLastCalledWith('12px')
    expect(scrub.mock.calls).toEqual([[true], [false]])

    scrub.mockClear()
    pointer('pointerdown', 20)
    pointer('pointermove', 25)
    pointer('lostpointercapture', 25)
    expect(scrub.mock.calls).toEqual([[true], [false]])

    scrub.mockClear()
    pointer('pointerdown', 20)
    pointer('pointermove', 25)
    view.unmount()
    expect(scrub.mock.calls).toEqual([[true], [false]])
  })

  it('scrubs each margin or padding side from its directional handle', () => {
    const change = vi.fn()
    render(
      <BoxModelControl
        label="Margin"
        sideLabels={['Margin top', 'Margin right', 'Margin bottom', 'Margin left']}
        values={['4px', '8px', '12px', '16px']}
        links={{ vertical: false, horizontal: false, all: false }}
        linkLabel="Link values"
        unlinkLabel="Unlink values"
        linkAllLabel="Link all sides"
        unlinkAllLabel="Unlink all sides"
        onLinkChange={vi.fn()}
        onChange={change}
      />,
    )

    const handle = screen.getByRole('button', { name: 'Margin top · 拖动调整' })
    const pointer = (type: string, clientX: number) => {
      const event = new MouseEvent(type, { bubbles: true, clientX })
      Object.defineProperty(event, 'pointerId', { value: 1 })
      fireEvent(handle, event)
    }
    expect(handle.textContent).toBe('↑')
    pointer('pointerdown', 20)
    pointer('pointermove', 28)
    pointer('pointerup', 28)

    expect(change).toHaveBeenLastCalledWith(0, '12px')
    expect(screen.getByRole('button', { name: 'Margin right · 拖动调整' }).textContent).toBe('→')
    expect(screen.getByRole('button', { name: 'Margin bottom · 拖动调整' }).textContent).toBe('↓')
    expect(screen.getByRole('button', { name: 'Margin left · 拖动调整' }).textContent).toBe('←')
    expect(screen.getAllByRole('spinbutton').map(field => field.getAttribute('aria-label'))).toEqual([
      'Margin top', 'Margin bottom', 'Margin left', 'Margin right',
    ])
  })

  it('locks opposite box-model sides independently by axis', () => {
    const change = vi.fn()
    const linkChange = vi.fn()
    render(
      <BoxModelControl
        label="Padding"
        sideLabels={['Padding top', 'Padding right', 'Padding bottom', 'Padding left']}
        values={['4px', '8px', '12px', '16px']}
        links={{ vertical: true, horizontal: false, all: false }}
        min={0}
        linkLabel="Link values"
        unlinkLabel="Unlink values"
        linkAllLabel="Link all sides"
        unlinkAllLabel="Unlink all sides"
        onLinkChange={linkChange}
        onChange={change}
      />,
    )

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Padding top' }), { target: { value: '20px' } })
    expect(change.mock.calls).toEqual([[0, '20px'], [2, '20px']])

    change.mockClear()
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Padding right' }), { target: { value: '24px' } })
    expect(change).toHaveBeenCalledOnce()
    expect(change).toHaveBeenCalledWith(1, '24px')

    const verticalLink = screen.getByRole('button', { name: /Unlink values · Padding top \/ Padding bottom/u })
    expect(verticalLink.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('spinbutton', { name: 'Padding top' }).getAttribute('aria-valuemin')).toBe('0')
    fireEvent.click(verticalLink)
    fireEvent.click(screen.getByRole('button', { name: 'Link values · Padding left / Padding right' }))
    expect(linkChange.mock.calls).toEqual([['vertical', false], ['horizontal', true]])
  })

  it('offers a merge action for two axis locks and synchronizes all four sides', () => {
    const linkChange = vi.fn()
    const change = vi.fn()
    const view = render(
      <BoxModelControl
        label="Margin"
        sideLabels={['Margin top', 'Margin right', 'Margin bottom', 'Margin left']}
        values={['4px', '8px', '12px', '16px']}
        links={{ vertical: true, horizontal: true, all: false }}
        linkLabel="Link values"
        unlinkLabel="Unlink values"
        linkAllLabel="Link all sides"
        unlinkAllLabel="Unlink all sides"
        onLinkChange={linkChange}
        onChange={change}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Link all sides' }))
    expect(linkChange).toHaveBeenCalledWith('all', true)

    view.rerender(
      <BoxModelControl
        label="Margin"
        sideLabels={['Margin top', 'Margin right', 'Margin bottom', 'Margin left']}
        values={['4px', '8px', '12px', '16px']}
        links={{ vertical: true, horizontal: true, all: true }}
        linkLabel="Link values"
        unlinkLabel="Unlink values"
        linkAllLabel="Link all sides"
        unlinkAllLabel="Unlink all sides"
        onLinkChange={linkChange}
        onChange={change}
      />,
    )

    expect(screen.queryByRole('button', { name: /Margin top \/ Margin bottom/u })).toBeNull()
    expect(screen.getByRole('button', { name: 'Unlink all sides' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Margin left' }), { target: { value: '24px' } })
    expect(change.mock.calls).toEqual([[3, '24px'], [0, '24px'], [1, '24px'], [2, '24px']])
    fireEvent.click(screen.getByRole('button', { name: 'Unlink all sides' }))
    expect(linkChange).toHaveBeenLastCalledWith('all', false)
  })

  it('falls back from the four-side lock to both axis locks', () => {
    expect(updateBoxModelLinks(
      { vertical: true, horizontal: true, all: true },
      'all',
      false,
    )).toEqual({ vertical: true, horizontal: true, all: false })
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
