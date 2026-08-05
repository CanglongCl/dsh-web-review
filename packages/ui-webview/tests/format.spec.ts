/**
 * Annotation message assembly suite: exact template composition from the
 * pinned locale strings.
 */
import { describe, expect, it } from 'vitest'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { formatAnnotation } from '../src/client/format.ts'
import { zh, type WebviewKey } from '../src/client/locales.ts'
import type { PickItem } from '../src/client/contract.ts'

/** Minimal t over the zh dictionary with {param} interpolation. */
const t: Translate<WebviewKey> = (key, params) => {
  const template = zh[key]
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => (params[name] as string | undefined) ?? match)
}

const SNAPSHOT = {
  tagName: 'button',
  id: '',
  className: 'btn-primary',
  cssPath: 'button.btn-primary',
  outerHTML: '<button class="btn-primary">提交</button>',
  textContent: '提交',
  rect: { x: 12, y: 34, width: 80, height: 32 },
  computed: {
    display: 'inline-block', position: 'static', fontSize: '13px', color: '#fff',
    backgroundColor: '#4c6ef5', margin: '0px', padding: '6px 14px', width: '80px', height: '32px',
  },
}

function pick(comment: string): PickItem {
  return { id: 'p1', snapshot: SNAPSHOT, comment }
}

describe('formatAnnotation', () => {
  it('composes page context, entries, and the closing instruction', () => {
    const out = formatAnnotation('http://localhost:5173/', '魔法 UI 演示页', [pick('按钮颜色太暗')], t)
    expect(out).toContain(zh['annotation.header'])
    expect(out).toContain('目标页面：魔法 UI 演示页（http://localhost:5173/）')
    expect(out).toContain('1. 选中的元素')
    expect(out).toContain('CSS 选择器：button.btn-primary')
    expect(out).toContain('元素：button.btn-primary（80×32，位于 (12, 34)）')
    expect(out).toContain('<button class="btn-primary">提交</button>')
    expect(out).toContain('修改需求（你的评论）：按钮颜色太暗')
    expect(out).toContain(zh['annotation.instruction'])
  })

  it('marks entries without a comment explicitly', () => {
    const out = formatAnnotation('http://h/', '', [pick('   ')], t)
    expect(out).toContain(zh['annotation.entry.noComment'])
  })

  it('numbers multiple entries', () => {
    const out = formatAnnotation('http://h/', '', [pick('a'), pick('b')], t)
    expect(out).toContain('1. 选中的元素')
    expect(out).toContain('2. 选中的元素')
  })
})
