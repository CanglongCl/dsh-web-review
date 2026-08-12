// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UiSkillSelector } from '../src/client/UiSkillSelector.tsx'
import { zh, type WebviewKey } from '../src/client/locales.ts'

const t: Translate<WebviewKey> = (key, params) => {
  const template = zh[key]
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/gu, (match, name: string) => (params[name] as string | undefined) ?? match)
}

afterEach(cleanup)

describe('UiSkillSelector', () => {
  it('expands like an Inspector section and opens the Skill choices from a field', () => {
    render(<UiSkillSelector selected={['better-ui', 'better-writing']} t={t} onToggle={vi.fn()} />)
    const sectionTrigger = screen.getByRole('button', { name: '内置 Skill', exact: true })
    expect(sectionTrigger.getAttribute('aria-expanded')).toBe('false')
    expect(sectionTrigger.querySelector('svg')).toBeTruthy()
    expect(sectionTrigger.textContent).not.toContain('✦')
    expect(screen.queryByText(zh['editor.skills.command'])).toBeNull()

    fireEvent.click(sectionTrigger)
    expect(screen.getByText(zh['editor.skills.command'])).toBeTruthy()
    const field = screen.getByRole('button', { name: zh['editor.skills.field'] })
    expect(field.nextElementSibling?.textContent).toBe(zh['editor.skills.command'])
    expect(field.textContent).toContain('better-ui, better-writing')
    expect(field.textContent).toContain('2 个')
    expect(document.querySelector('[data-webview-ui-skill-popover]')).toBeNull()

    fireEvent.click(field)
    const panel = document.querySelector('[data-webview-ui-skill-popover]') as HTMLElement
    expect(panel.hasAttribute('data-webview-ui-skill-popover')).toBe(true)
    expect(within(panel).getAllByRole('checkbox')).toHaveLength(8)
  })

  it('reports the exact checked Skill', () => {
    const onToggle = vi.fn()
    render(<UiSkillSelector selected={[]} t={t} onToggle={onToggle} />)
    fireEvent.click(screen.getByRole('button', { name: '内置 Skill', exact: true }))
    fireEvent.click(screen.getByRole('button', { name: zh['editor.skills.field'] }))
    fireEvent.click(screen.getByRole('checkbox', { name: /better-layout/u }))
    expect(onToggle).toHaveBeenCalledWith('better-layout')
  })

  it('dismisses the floating panel on outside pointer input or Escape', () => {
    render(<UiSkillSelector selected={[]} t={t} onToggle={vi.fn()} />)
    const sectionTrigger = screen.getByRole('button', { name: '内置 Skill', exact: true })

    fireEvent.click(sectionTrigger)
    const field = screen.getByRole('button', { name: zh['editor.skills.field'] })
    fireEvent.click(field)
    fireEvent.pointerDown(document.body)
    expect(sectionTrigger.getAttribute('aria-expanded')).toBe('true')
    expect(field.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(field)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(sectionTrigger.getAttribute('aria-expanded')).toBe('true')
    expect(field.getAttribute('aria-expanded')).toBe('false')
  })
})
