// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
        onSelectElement={vi.fn()}
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
        onSelectElement={vi.fn()}
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
        onSelectElement={vi.fn()}
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

  it('previews mixed CSS keywords, keeps pure controls distinct, and cancels exactly', () => {
    const { frame, element } = fixture()
    element.style.width = '120px'
    const patch = createLivePatch(element)
    const cancel = vi.fn()
    render(
      <AnnotationEditor
        id="mixed-values"
        patch={patch}
        frame={frame}
        comment=""
        changes={[]}
        textChange={null}
        t={t}
        onCancel={cancel}
        onConfirm={vi.fn()}
        onSelectElement={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: zh['editor.adjust'] }))
    expect(screen.queryByRole('button', { name: `${zh['editor.property.opacity']} · ${zh['editor.action.choosePreset']}` })).toBeNull()
    expect(screen.getByRole('button', { name: zh['editor.property.display'] }).getAttribute('aria-haspopup')).toBe('menu')
    expect((screen.getByRole('spinbutton', { name: zh['editor.property.width'] }) as HTMLInputElement).value).toBe('120px')

    fireEvent.click(screen.getByRole('button', { name: `${zh['editor.property.width']} · ${zh['editor.action.choosePreset']}` }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'auto' }))
    expect(element.style.width).toBe('auto')
    expect(patch.originalStyles.get('width')?.value).toBe('120px')
    expect(screen.getByRole('button', { name: `${zh['editor.reset']} · ${zh['editor.group.size']}` })).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('spinbutton', { name: zh['editor.property.width'] }), { key: 'ArrowUp' })
    expect(element.style.width).toBe('121px')
    fireEvent.click(screen.getByRole('button', { name: `${zh['editor.property.width']} · ${zh['editor.action.choosePreset']}` }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'auto' }))

    fireEvent.click(screen.getByRole('button', { name: zh['editor.cancel'] }))
    expect(element.style.width).toBe('120px')
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('opens a mutually exclusive hierarchy selector and supports canvas shortcuts', () => {
    const frame = document.createElement('iframe')
    document.body.appendChild(frame)
    frame.contentDocument!.write('<!doctype html><html><body><main><div class="card"><h3>Title</h3><p>Copy</p></div><div>Sibling</div></main></body></html>')
    frame.contentDocument!.close()
    const card = frame.contentDocument!.querySelector('.card') as HTMLElement
    const select = vi.fn()
    render(
      <AnnotationEditor
        id="p1"
        patch={createLivePatch(card)}
        frame={frame}
        comment="Keep this comment"
        changes={[]}
        textChange={null}
        t={t}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        onSelectElement={select}
      />,
    )

    expect(screen.getByRole('button', { name: zh['editor.select'] })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh['editor.select'] }))
    expect(document.querySelector('[data-webview-element-selector]')).toBeTruthy()
    expect(screen.getByRole('button', { name: zh['editor.select.child'] })).toBeTruthy()
    expect(screen.getByRole('button', { name: zh['editor.select.child'] }).textContent).toContain(zh['editor.select.child.short'])
    expect(screen.getByRole('button', { name: zh['editor.select.previousSibling'] }).textContent).toContain(zh['editor.select.previousSibling.short'])
    expect(screen.getByRole('button', { name: zh['editor.select.sibling'] }).textContent).toContain(zh['editor.select.sibling.short'])
    expect(document.querySelectorAll('[data-webview-element-selector] kbd')).toHaveLength(4)
    expect(document.querySelector('[data-webview-element-selector]')?.textContent).not.toContain('当前元素')
    const htmlDisclosure = screen.getByRole('button', { name: '收起 html' })
    expect(htmlDisclosure.getAttribute('data-state')).toBe('expanded')
    fireEvent.click(htmlDisclosure)
    expect(screen.getByRole('button', { name: '展开 html' }).getAttribute('data-state')).toBe('collapsed')
    expect(document.querySelector('[data-webview-element-selector] [aria-selected="true"]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '展开 html' }))
    expect(document.querySelector('[data-webview-element-selector] [aria-selected="true"]')).toBeTruthy()
    expect(document.querySelector('[data-webview-element-selector]')?.textContent).not.toContain('点击元素可切换批注目标')
    const pageKeydown = vi.fn()
    frame.contentDocument!.addEventListener('keydown', pageKeydown)
    fireEvent.keyDown(frame.contentDocument!.body, { key: 'Tab', code: 'Tab' })
    expect(select).toHaveBeenLastCalledWith(frame.contentDocument!.querySelector('main > div:last-child'), 'Keep this comment', 'select', 'next-sibling')
    expect(pageKeydown).not.toHaveBeenCalled()
    const pageButton = frame.contentDocument!.createElement('button')
    card.append(pageButton)
    fireEvent.keyDown(pageButton, { key: 'Enter', code: 'Enter' })
    expect(select).toHaveBeenLastCalledWith(card.querySelector('h3'), 'Keep this comment', 'select', 'child')
    expect(pageKeydown).not.toHaveBeenCalled()
    select.mockClear()
    const currentTreeItem = document.querySelector('[data-webview-element-tree] [aria-selected="true"]') as HTMLLIElement
    currentTreeItem.focus()
    fireEvent.keyDown(currentTreeItem, { key: 'Tab', code: 'Tab' })
    expect(select).toHaveBeenLastCalledWith(frame.contentDocument!.querySelector('main > div:last-child'), 'Keep this comment', 'select')
    select.mockClear()
    fireEvent.keyDown(currentTreeItem, { key: 'Enter', code: 'Enter' })
    expect(select).toHaveBeenLastCalledWith(card.querySelector('h3'), 'Keep this comment', 'select')
    select.mockClear()
    fireEvent.keyDown(currentTreeItem, { key: 'ArrowRight', code: 'ArrowRight' })
    const focusedChild = document.activeElement as HTMLLIElement
    expect(focusedChild.textContent).toContain('h3')
    fireEvent.keyDown(focusedChild, { key: ' ', code: 'Space' })
    expect(select).toHaveBeenLastCalledWith(card.querySelector('h3'), 'Keep this comment', 'select')
    select.mockClear()
    expect(document.querySelector('[data-webview-property-inspector]')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: zh['editor.adjust'] }))
    expect(document.querySelector('[data-webview-element-selector]')).toBeNull()
    expect(document.querySelector('[data-webview-property-inspector]')).toBeTruthy()

    fireEvent.keyDown(frame.contentDocument!.body, { key: 'Enter', code: 'Enter' })
    expect(select).toHaveBeenLastCalledWith(card.querySelector('h3'), 'Keep this comment', 'adjust', 'child')
    select.mockClear()
    fireEvent.keyDown(screen.getByPlaceholderText(zh['editor.comment']), { key: 'Tab', code: 'Tab' })
    expect(select).not.toHaveBeenCalled()
  })

  it('keeps unavailable navigation keys from falling through to the iframe page', () => {
    const { frame, element } = fixture()
    const pageKeydown = vi.fn()
    const select = vi.fn()
    frame.contentDocument!.addEventListener('keydown', pageKeydown)
    render(
      <AnnotationEditor
        id="leaf"
        patch={createLivePatch(element)}
        frame={frame}
        comment=""
        changes={[]}
        textChange={null}
        t={t}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        onSelectElement={select}
      />,
    )

    expect(document.activeElement).toBe(document.querySelector('[data-webview-annotation-editor]'))

    fireEvent.keyDown(element, { key: 'Enter', code: 'Enter' })
    expect(select).not.toHaveBeenCalled()
    expect(pageKeydown).not.toHaveBeenCalled()
  })

  it('keeps the selected target visible outside the element tree', () => {
    const { frame, element } = fixture()
    const baseProps = {
      id: 'feedback', patch: createLivePatch(element), frame, comment: '', changes: [], textChange: null,
      t, onCancel: vi.fn(), onConfirm: vi.fn(), onSelectElement: vi.fn(),
    }
    const view = render(<AnnotationEditor {...baseProps} navigationFeedback={null} />)
    expect(document.querySelector('[data-webview-navigation-feedback]')?.textContent).toContain('已选择 h1')
    fireEvent.click(screen.getByRole('button', { name: zh['editor.adjust'] }))
    expect(document.querySelector('[data-webview-navigation-feedback]')?.textContent).toContain('已选择 h1')
    view.unmount()
    render(
      <AnnotationEditor
        {...baseProps}
        initialMode="select"
        navigationFeedback={{ action: 'parent', sequence: 1 }}
      />,
    )
    expect(document.querySelector('[data-webview-navigation-feedback]')).toBeNull()
  })

  it('hides every other editor surface while preserving the active scrub row', () => {
    const { frame, element } = fixture()
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
        onSelectElement={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: zh['editor.adjust'] }))
    const editor = document.querySelector('[data-webview-annotation-editor]') as HTMLDivElement
    const handle = screen.getByRole('button', { name: `${zh['editor.property.fontSize']} · 拖动调整` })
    const activeRow = handle.closest('[data-inspector-row]') as HTMLDivElement
    const compose = screen.getByPlaceholderText(zh['editor.comment']).parentElement as HTMLElement
    const pointer = (type: string, clientX: number) => { fireEvent(handle, new MouseEvent(type, { bubbles: true, clientX })) }

    pointer('pointerdown', 100)
    pointer('pointermove', 102)
    expect(editor.hasAttribute('data-scrubbing')).toBe(false)
    pointer('pointermove', 108)
    expect(editor.getAttribute('data-scrubbing')).toBe('font-size')
    expect(activeRow.hasAttribute('data-scrub-active')).toBe(true)
    expect(compose.hasAttribute('data-scrub-active')).toBe(false)
    expect(element.style.fontSize).toBe('24px')

    pointer('pointerup', 108)
    expect(editor.hasAttribute('data-scrubbing')).toBe(false)
    expect(activeRow.hasAttribute('data-scrub-active')).toBe(false)
  })

  it('temporarily collapses to the eye button without losing the edit transaction', async () => {
    const { frame, element } = fixture()
    const cancel = vi.fn()
    render(
      <AnnotationEditor
        id="p1"
        patch={createLivePatch(element)}
        frame={frame}
        comment=""
        changes={[]}
        textChange={null}
        t={t}
        onCancel={cancel}
        onConfirm={vi.fn()}
        onSelectElement={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: zh['editor.adjust'] }))
    fireEvent.change(screen.getByPlaceholderText(zh['editor.comment']), { target: { value: 'Keep this draft' } })
    fireEvent.change(screen.getByLabelText(zh['editor.property.fontSize']), { target: { value: '28px' } })
    fireEvent.click(screen.getByRole('button', { name: zh['editor.hide'] }))

    const editor = document.querySelector('[data-webview-annotation-editor]') as HTMLDivElement
    const show = screen.getByRole('button', { name: zh['editor.show'], hidden: true })
    expect(editor.hasAttribute('data-editor-hidden')).toBe(true)
    expect(editor.getAttribute('aria-hidden')).toBe('true')
    expect(element.style.fontSize).toBe('28px')
    await waitFor(() => { expect(document.activeElement).toBe(show) })

    fireEvent.click(show)
    expect(editor.hasAttribute('data-editor-hidden')).toBe(false)
    expect((screen.getByPlaceholderText(zh['editor.comment']) as HTMLInputElement).value).toBe('Keep this draft')
    expect((screen.getByLabelText(zh['editor.property.fontSize']) as HTMLInputElement).value).toBe('28px')
    expect(element.style.fontSize).toBe('28px')

    fireEvent.click(screen.getByRole('button', { name: zh['editor.hide'] }))
    fireEvent.keyDown(show, { key: 'Escape' })
    expect(element.style.fontSize).toBe('16px')
    expect(cancel).toHaveBeenCalledOnce()
  })
})
