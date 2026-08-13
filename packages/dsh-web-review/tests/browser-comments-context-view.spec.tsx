// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ComponentProps } from 'react'
import { AnnotationSnapshotId } from '../src/annotation-contract.ts'
import { BrowserCommentsContext } from '../src/client/BrowserCommentsContext.tsx'

afterEach(cleanup)

const copy: Record<string, string> = {
  'context.title': '页面批注',
  'context.commentCount': '{count} 处批注',
  'context.changeSummary': '批注变更摘要',
  'context.styleCount': '{count} 项样式',
  'context.textCount': '{count} 项文本',
  'context.text': '文本',
  'context.userInput': '用户输入',
}

function t(key: string, values?: Record<string, unknown>): string {
  let value = copy[key] ?? key
  for (const [name, replacement] of Object.entries(values ?? {})) {
    value = value.replace(`{${name}}`, String(replacement))
  }
  return value
}

describe('BrowserCommentsContext', () => {
  it('matches native disclosure hierarchy without delivery status or audit tail', () => {
    const props = {
      matched: {
        kind: 'plugin', plugin: 'dsh-web-review', form: 'browser-comments',
        snapshotId: AnnotationSnapshotId('snapshot-1'),
        presentation: {
          page: { url: 'http://localhost:5173/magic', title: '魔法 UI 演示页' },
          comments: [{
            id: 'pick-1', comment: '标题再克制一点。', tagName: 'h1', role: 'heading',
            label: '魔法 UI', textContent: '魔法 UI',
            anchor: { framework: 'react', component: 'Hero', file: 'src/Hero.tsx', line: 18 },
            changes: [{ property: 'font-size', before: '48px', after: '40px' }],
            textChange: { before: '魔法 UI', after: '魔法界面' },
          }],
        },
      },
      t,
    } as unknown as ComponentProps<typeof BrowserCommentsContext>
    render(<BrowserCommentsContext {...props} />)

    const disclosure = screen.getByRole('button')
    expect(disclosure.textContent).toContain('页面批注')
    expect(disclosure.textContent).toContain('魔法 UI 演示页')
    expect(disclosure.textContent).toContain('1 处批注')
    expect(screen.queryByText('标题再克制一点。')).toBeNull()

    fireEvent.click(disclosure)
    expect(screen.getByText('标题再克制一点。')).toBeTruthy()
    expect(document.querySelector('[data-browser-comment-tag]')?.textContent).toBe('<h1>')
    expect(document.querySelector('[data-browser-comment-content]')?.textContent).toBe('魔法 UI')
    expect(screen.getByText('用户输入')).toBeTruthy()
    expect(screen.getByText('标题再克制一点。').className).toContain('intentText')
    expect(screen.getByText('font-size')).toBeTruthy()
    expect(screen.getByText('48px')).toBeTruthy()
    expect(screen.getByText('40px')).toBeTruthy()
    expect(screen.getByText('Hero · src/Hero.tsx:18')).toBeTruthy()
    expect(screen.getByText('1 项样式')).toBeTruthy()
    expect(screen.getByText('1 项文本')).toBeTruthy()
    expect(document.body.textContent).not.toContain('已发送')
    expect(document.body.textContent).not.toContain('snapshot-1')
    expect(document.body.textContent).not.toContain('查看发送给模型的完整内容')
  })
})
