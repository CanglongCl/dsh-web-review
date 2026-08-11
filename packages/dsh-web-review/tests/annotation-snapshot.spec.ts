import { describe, expect, it } from 'vitest'
import { ANNOTATION_LIMITS, type AnnotationStyleChange } from '../src/annotation-contract.ts'
import { annotationDraft } from '../src/client/annotation-snapshot.ts'
import type { PickItem } from '../src/client/contract.ts'

function pick(overrides: Partial<PickItem> = {}): PickItem {
  return {
    id: 'pick-1',
    snapshot: {
      tagName: 'h1', id: '', className: 'hero', cssPath: 'h1.hero',
      fullPath: 'html > body > h1.hero', label: 'Hero', role: 'heading',
      stableClasses: ['hero'], anchor: null, outerHTML: '<h1>Hero</h1>', textContent: 'Hero',
      rect: { x: 0, y: 0, width: 100, height: 20 },
      computed: {
        display: 'block', position: 'static', fontSize: '16px', color: '#000',
        backgroundColor: 'transparent', margin: '0px', padding: '0px', width: '100px', height: '20px',
      },
    },
    comment: 'Make it smaller.', changes: [], textChange: null,
    viewport: { width: 1280, height: 720 },
    ...overrides,
  }
}

describe('annotationDraft', () => {
  it('bounds page evidence without changing user-authored intent', () => {
    const draft = annotationDraft(
      `http://localhost:5173/${'x'.repeat(ANNOTATION_LIMITS.pageUrl)}`,
      't'.repeat(ANNOTATION_LIMITS.pageTitle + 20),
      [pick()],
    )
    expect(draft.page.url).toHaveLength(ANNOTATION_LIMITS.pageUrl)
    expect(draft.page.title).toHaveLength(ANNOTATION_LIMITS.pageTitle)
    expect(draft.comments[0]?.comment).toBe('Make it smaller.')
  })

  it('rejects oversized comment, requested style and requested text instead of truncating', () => {
    expect(() => annotationDraft('', '', [pick({
      comment: 'x'.repeat(ANNOTATION_LIMITS.comment + 1),
    })])).toThrow(/comment exceeds/u)
    const change: AnnotationStyleChange = {
      property: 'color', before: '#000', after: 'x'.repeat(ANNOTATION_LIMITS.styleValue + 1),
    }
    expect(() => annotationDraft('', '', [pick({ changes: [change] })])).toThrow(/change\.color exceeds/u)
    expect(() => annotationDraft('', '', [pick({
      textChange: { before: 'Hero', after: 'x'.repeat(ANNOTATION_LIMITS.textValue + 1) },
    })])).toThrow(/textChange\.after exceeds/u)
  })
})
