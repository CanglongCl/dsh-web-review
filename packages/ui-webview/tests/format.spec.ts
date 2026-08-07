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
  fullPath: 'html > body > main:nth-of-type(1) > div.card:nth-of-type(1) > button.btn-primary:nth-of-type(1)',
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
  it('composes the XML annotation block: page, elements with selector + full path, and the instruction', () => {
    const out = formatAnnotation('http://localhost:5173/', '魔法 UI 演示页', [pick('按钮颜色太暗')], t)
    expect(out).toContain(zh['annotation.open'])
    expect(out).toContain('  <page url="http://localhost:5173/" title="魔法 UI 演示页"/>')
    expect(out).toContain('  <element index="1" selector="button.btn-primary"')
    expect(out).toContain('path="html > body > main:nth-of-type(1) > div.card:nth-of-type(1) > button.btn-primary:nth-of-type(1)"')
    expect(out).toContain('    <snapshot><![CDATA[<button class="btn-primary">提交</button>]]></snapshot>')
    expect(out).toContain('    <comment><![CDATA[按钮颜色太暗]]></comment>')
    expect(out).toContain(zh['annotation.close'])
    expect(out).toContain(zh['annotation.instruction'])
  })

  it('marks entries without a comment explicitly', () => {
    const out = formatAnnotation('http://h/', '', [pick('   ')], t)
    expect(out).toContain(zh['annotation.noComment'])
    expect(out).not.toContain(']]></comment>')
  })

  it('numbers multiple entries', () => {
    const out = formatAnnotation('http://h/', '', [pick('a'), pick('b')], t)
    expect(out).toContain('index="1"')
    expect(out).toContain('index="2"')
  })
})
