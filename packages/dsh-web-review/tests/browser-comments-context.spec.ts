import { describe, expect, it } from 'vitest'
import type { AnnotationSnapshot } from '../src/annotation-contract.ts'
import { AnnotationSnapshotId } from '../src/annotation-contract.ts'
import {
  browserCommentsContextSourceOf,
  browserCommentsPresentationOf,
} from '../src/browser-comments-context.ts'

function snapshot(): AnnotationSnapshot {
  return {
    sessionId: 'session-1',
    selectedSkills: [],
    page: { url: 'http://localhost:5173/magic', title: '魔法 UI 演示页' },
    comments: [{
      id: 'pick-1',
      comment: '标题再克制一点。',
      tagName: 'h1',
      role: 'heading',
      label: '魔法 UI',
      cssPath: '#app > h1',
      fullPath: 'html > body > #app > h1',
      stableClasses: ['hero_title'],
      textContent: '魔法 UI',
      inToolChrome: false,
      anchor: { framework: 'react', component: 'Hero', file: 'src/Hero.tsx', line: 18 },
      changes: [{ property: 'font-size', before: '48px', after: '40px' }],
      textChange: { before: '魔法 UI', after: '魔法界面' },
      viewport: { width: 1280, height: 800 },
    }],
  }
}

describe('Browser Comments durable presentation', () => {
  it('keeps user-relevant fields and excludes selector, full path, viewport, and tool state', () => {
    const presentation = browserCommentsPresentationOf(snapshot())
    expect(presentation).toMatchObject({
      page: { title: '魔法 UI 演示页' },
      comments: [{ comment: '标题再克制一点。', anchor: { file: 'src/Hero.tsx' } }],
    })
    expect(JSON.stringify(presentation)).not.toContain('cssPath')
    expect(JSON.stringify(presentation)).not.toContain('fullPath')
    expect(JSON.stringify(presentation)).not.toContain('viewport')
    expect(JSON.stringify(presentation)).not.toContain('inToolChrome')
  })

  it('accepts only the exact plugin/form payload and declines malformed or foreign records', () => {
    const source = {
      kind: 'plugin',
      plugin: 'dsh-web-review',
      form: 'browser-comments',
      snapshotId: AnnotationSnapshotId('snapshot-1'),
      presentation: browserCommentsPresentationOf(snapshot()),
    }
    expect(browserCommentsContextSourceOf(source)).toEqual(source)
    expect(browserCommentsContextSourceOf({ ...source, plugin: 'foreign' })).toBeUndefined()
    expect(browserCommentsContextSourceOf({ ...source, extra: true })).toBeUndefined()
    expect(browserCommentsContextSourceOf({
      ...source,
      presentation: { ...source.presentation, comments: [{ ...source.presentation.comments[0], changes: [] }] },
    })).toBeDefined()
    expect(browserCommentsContextSourceOf({
      ...source,
      presentation: { ...source.presentation, comments: [{ ...source.presentation.comments[0], id: '' }] },
    })).toBeUndefined()
  })
})
