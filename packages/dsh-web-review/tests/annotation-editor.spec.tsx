// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { AnnotationEditor } from '../src/client/AnnotationEditor.tsx'
import { createLivePatch } from '../src/client/live-patch.ts'
import { zh, type WebviewKey } from '../src/client/locales.ts'

const t: Translate<WebviewKey> = (key, params) => {
  const template = zh[key]
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => (params[name] as string | undefined) ?? match)
}

function fixture(): { frame: HTMLIFrameElement; element: HTMLElement } {
  const frame = document.createElement('iframe')
  document.body.appendChild(frame)
  frame.contentDocument!.write('<!doctype html><html><body><h1 style="font-size: 16px">Example Domain</h1></body></html>')
  frame.contentDocument!.close()
  return { frame, element: frame.contentDocument!.querySelector('h1') as HTMLElement }
}

afterEach(() => { document.body.innerHTML = '' })

describe('AnnotationEditor', () => {
  it('uses a solid host surface, previews fields/text, resets fields and confirms only diffs', () => {
    const { frame, element } = fixture()
    const confirm = vi.fn()
    render(
      <AnnotationEditor
        id="p1"
        patch={createLivePatch(element)}
        frame={frame}
        comment=""
        changes={[]}
        textChange={null}
        t={t}
        onCancel={vi.fn()}
        onConfirm={confirm}
      />,
    )
    const editor = document.querySelector('[data-webview-annotation-editor]') as HTMLDivElement
    expect(editor).toBeTruthy()
    expect((screen.getByRole('button', { name: zh['editor.confirm'] }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: zh['editor.adjust'] }))
    expect(editor.querySelector('select')).toBeNull()
    expect(editor.querySelectorAll('[data-webview-text-content]')).toHaveLength(1)
    expect(editor.querySelector('[data-webview-target-title]')).toBeNull()

    const fontSize = screen.getByLabelText(zh['editor.property.fontSize'])
    fireEvent.change(fontSize, { target: { value: '24px' } })
    expect(element.style.getPropertyValue('font-size')).toBe('24px')
    const text = screen.getByLabelText(zh['editor.text'])
    fireEvent.change(text, { target: { value: 'Updated heading' } })
    expect(element.textContent).toBe('Updated heading')

    fireEvent.click(screen.getByRole('button', { name: `${zh['editor.reset']} · ${zh['editor.property.fontSize']}` }))
    expect(element.style.getPropertyValue('font-size')).toBe('16px')
    fireEvent.click(screen.getByRole('button', { name: zh['editor.confirm'] }))
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      changes: [],
      textChange: { before: 'Example Domain', after: 'Updated heading' },
    }))
  })

  it('cancels back to the committed transaction baseline', () => {
    const { frame, element } = fixture()
    const cancel = vi.fn()
    const patch = createLivePatch(element)
    render(
      <AnnotationEditor
        id="p1"
        patch={patch}
        frame={frame}
        comment="Existing"
        changes={[{ property: 'font-size', before: '16px', after: '20px' }]}
        textChange={null}
        t={t}
        onCancel={cancel}
        onConfirm={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: zh['editor.adjust'] }))
    fireEvent.change(screen.getByLabelText(zh['editor.property.fontSize']), { target: { value: '30px' } })
    fireEvent.click(screen.getByRole('button', { name: zh['editor.cancel'] }))
    expect(element.style.getPropertyValue('font-size')).toBe('20px')
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('uses familiar B/I/U controls, percent opacity and field-level Escape rollback', () => {
    const { frame, element } = fixture()
    element.style.fontWeight = '500'
    element.style.textDecoration = 'line-through'
    render(
      <AnnotationEditor
        id="p1"
        patch={createLivePatch(element)}
        frame={frame}
        comment=""
        changes={[]}
        textChange={null}
        t={t}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: zh['editor.adjust'] }))

    const bold = screen.getByRole('button', { name: zh['editor.action.bold'] })
    fireEvent.click(bold)
    expect(element.style.fontWeight).toBe('700')
    fireEvent.click(bold)
    expect(element.style.fontWeight).toBe('500')

    const underline = screen.getByRole('button', { name: zh['editor.action.underline'] })
    fireEvent.click(underline)
    expect(element.style.textDecoration).toContain('line-through')
    expect(element.style.textDecoration).toContain('underline')

    const opacity = screen.getByLabelText(zh['editor.property.opacity'])
    expect((opacity as HTMLInputElement).value).toBe('100%')
    fireEvent.change(opacity, { target: { value: '50%' } })
    expect(element.style.opacity).toBe('0.5')

    const fontMenu = document.querySelector(`[aria-haspopup="menu"][aria-label="${zh['editor.property.fontFamily']}"]`) as HTMLButtonElement
    expect(fontMenu).toBeTruthy()
    fireEvent.click(fontMenu)
    fireEvent.click(screen.getByText('Arial, sans-serif'))
    expect(element.style.fontFamily).toBe('Arial, sans-serif')

    const fontSize = screen.getByLabelText(zh['editor.property.fontSize'])
    fireEvent.focus(fontSize)
    fireEvent.change(fontSize, { target: { value: '31px' } })
    expect(element.style.fontSize).toBe('31px')
    fireEvent.keyDown(fontSize, { key: 'Escape' })
    expect(element.style.fontSize).toBe('16px')
  })
})
