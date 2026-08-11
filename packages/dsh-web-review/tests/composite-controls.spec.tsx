// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RadiusControl, SizeControl, TransformControl } from '../src/client/CompositeControls.tsx'

afterEach(cleanup)

describe('Composite inspector controls', () => {
  it('links width and height using the current aspect ratio', () => {
    const width = vi.fn()
    const height = vi.fn()
    render(
      <SizeControl
        width="100px"
        height="50px"
        labels={{ width: 'Width', height: 'Height', link: 'Link values', unlink: 'Unlink values' }}
        onWidthChange={width}
        onHeightChange={height}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Link values' }))
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Width' }), { target: { value: '200px' } })
    expect(height).toHaveBeenCalledWith('100px')
    expect(width).toHaveBeenCalledWith('200px')
  })

  it('edits radius as linked or independent corners', () => {
    const change = vi.fn()
    const view = render(
      <RadiusControl
        label="Radius"
        value="8px"
        cornerLabels={['Top left', 'Top right', 'Bottom right', 'Bottom left']}
        linkLabel="Link values"
        unlinkLabel="Unlink values"
        rawHint="Raw"
        onChange={change}
      />,
    )
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Top left' }), { target: { value: '12px' } })
    expect(change).toHaveBeenLastCalledWith('12px')
    fireEvent.click(screen.getByRole('button', { name: 'Unlink values' }))
    view.rerender(
      <RadiusControl
        label="Radius"
        value="8px"
        cornerLabels={['Top left', 'Top right', 'Bottom right', 'Bottom left']}
        linkLabel="Link values"
        unlinkLabel="Unlink values"
        rawHint="Raw"
        onChange={change}
      />,
    )
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Top left' }), { target: { value: '12px' } })
    expect(change).toHaveBeenLastCalledWith('12px 8px 8px 8px')
  })

  it('renders corners as a spatial matrix while preserving CSS serialization order', () => {
    const change = vi.fn()
    const view = render(
      <RadiusControl
        label="Radius"
        value="1px 2px 3px 4px"
        cornerLabels={['Top left', 'Top right', 'Bottom right', 'Bottom left']}
        linkLabel="Link values"
        unlinkLabel="Unlink values"
        rawHint="Raw"
        onChange={change}
      />,
    )
    const fields = screen.getAllByRole('spinbutton')
    expect(fields.map(field => field.getAttribute('aria-label'))).toEqual(['Top left', 'Top right', 'Bottom left', 'Bottom right'])
    expect([...view.container.querySelectorAll('[data-corner-radius-glyph]')].map(glyph => glyph.getAttribute('data-corner-radius-glyph'))).toEqual([
      'top-left', 'top-right', 'bottom-left', 'bottom-right',
    ])
    expect([...view.container.querySelectorAll('[data-corner-radius-glyph] path')].map(path => path.getAttribute('transform'))).toEqual([
      'rotate(0 8 8)', 'rotate(90 8 8)', 'rotate(270 8 8)', 'rotate(180 8 8)',
    ])
    expect(view.container.textContent).not.toMatch(/[↖↗↙↘]/u)
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Bottom left' }), { target: { value: '9px' } })
    expect(change).toHaveBeenLastCalledWith('1px 2px 3px 9px')
  })

  it('builds a supported transform from the none baseline', () => {
    const change = vi.fn()
    render(
      <TransformControl
        label="Transform"
        value="none"
        labels={{ translateX: 'Translate X', translateY: 'Translate Y', scaleX: 'Scale X', scaleY: 'Scale Y', rotate: 'Rotate' }}
        rawHint="Raw"
        onChange={change}
      />,
    )
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Translate X' }), { target: { value: '10px' } })
    expect(change).toHaveBeenCalledWith('translateX(10px)')
  })
})
