/**
 * Annotation message assembly suite: exact template composition from the
 * pinned locale strings, covering both location tiers (with/without a source
 * anchor) and URL shortening.
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

function baseSnapshot(): PickItem['snapshot'] {
  return {
    tagName: 'button',
    id: '',
    className: 'btn-primary m-2',
    cssPath: 'button.btn-primary',
    fullPath: 'html > body > main > div.card > button.btn-primary',
    label: '提交',
    role: 'button',
    stableClasses: ['btn-primary'],
    anchor: null,
    outerHTML: '<button class="btn-primary m-2">提交</button>',
    textContent: '提交',
    rect: { x: 12, y: 34, width: 80, height: 32 },
    computed: {
      display: 'inline-block', position: 'static', fontSize: '13px', color: '#fff',
      backgroundColor: '#4c6ef5', margin: '0px', padding: '6px 14px', width: '80px', height: '32px',
    },
  }
}

function pick(comment: string, snapshot: PickItem['snapshot'] = baseSnapshot()): PickItem {
  return { id: 'p1', snapshot, comment }
}

describe('formatAnnotation', () => {
  it('no anchor: text identity + stable classes + full path, no DOM artifacts', () => {
    const out = formatAnnotation('http://localhost:5173/', '魔法 UI 演示页', [pick('按钮颜色太暗')], t)
    expect(out).toContain(zh['annotation.open'])
    expect(out).toContain('  <page url="http://localhost:5173/" title="魔法 UI 演示页"/>')
    expect(out).toContain('  <element index="1" text="button &quot;提交&quot;" classes="btn-primary"')
    expect(out).toContain('path="html > body > main > div.card > button.btn-primary"')
    expect(out).toContain('    <comment><![CDATA[按钮颜色太暗]]></comment>')
    expect(out).toContain(zh['annotation.close'])
    expect(out).toContain(zh['annotation.instruction'])
    // Location-oriented: no selector, no outerHTML snapshot, no rect/computed.
    expect(out).not.toContain('selector=')
    expect(out).not.toContain('snapshot')
    expect(out).not.toContain('computed')
    expect(out).not.toContain('rect')
  })

  it('with a source anchor: text + source file:line + component, no classes/path', () => {
    const snap = baseSnapshot()
    snap.anchor = { framework: 'react', component: 'Layout › Hero', file: 'src/components/Hero.tsx', line: 12 }
    const out = formatAnnotation('http://localhost:5173/', '', [pick('', snap)], t)
    expect(out).toContain('  <element index="1" text="button &quot;提交&quot;" source="src/components/Hero.tsx:12" component="Layout › Hero">')
    // The anchor tier drops the DOM-location fields.
    expect(out).not.toContain('classes=')
    expect(out).not.toContain('path=')
  })

  it('shortens long URLs into route + compact query summary', () => {
    const out = formatAnnotation('http://localhost:3000/campaigns/abc/settlement?date_from=2026-05-23&date_to=2026-06-22&sort=desc&page=2', '', [pick('x')], t)
    expect(out).toContain('url="http://localhost:3000/campaigns/abc/settlement"')
    expect(out).toContain('query="date_from=2026-05-23, date_to=2026-06-22, sort=desc, +1 more"')
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

  it('escapes quotes and angle brackets in attribute values', () => {
    const snap = baseSnapshot()
    snap.label = '标题 <h1> & "引号"'
    const out = formatAnnotation('http://h/', '', [pick('', snap)], t)
    // `"` and `<` are escaped; `>` stays readable in attribute values.
    expect(out).toContain('text="button &quot;标题 &lt;h1> &amp; &quot;引号&quot;&quot;"')
  })
})
