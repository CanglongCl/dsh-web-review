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
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Width', exact: true }), { target: { value: '200px' } })
    expect(height).toHaveBeenCalledWith('100px')
    expect(width).toHaveBeenCalledWith('200px')
  })

  it('offers the configured sizing keywords on both dimensions', () => {
    const width = vi.fn()
    const height = vi.fn()
    render(
      <SizeControl
        width="100px"
        height="50px"
        options={['auto', 'min-content']}
        presetLabel="Choose preset"
        labels={{ width: 'Width', height: 'Height', link: 'Link values', unlink: 'Unlink values' }}
        onWidthChange={width}
        onHeightChange={height}
      />,
    )
    expect(screen.getByRole('button', { name: 'Width · Choose preset' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Height · Choose preset' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Width · Choose preset' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'auto' }))
    expect(width).toHaveBeenCalledWith('auto')
    expect(height).not.toHaveBeenCalled()
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
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Top left', exact: true }), { target: { value: '12px' } })
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
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Top left', exact: true }), { target: { value: '12px' } })
    expect(change).toHaveBeenLastCalledWith('12px 8px 8px 8px')
  })

  it('renders corners as a spatial matrix while preserving CSS serialization order', () => {
    const change = vi.fn()
    render(
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
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Translate X', exact: true }), { target: { value: '10px' } })
    expect(change).toHaveBeenCalledWith('translateX(10px)')
  })
})
