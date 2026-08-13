import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { grade, serveFixtureDir } from '../../../eval/grader.ts'
import type { DomAssertion, LoadedEvalTask } from '../../../eval/types.ts'

const roots: string[] = []

async function gradeHtml(html: string, assertion: DomAssertion): Promise<boolean> {
  const root = mkdtempSync(join(tmpdir(), 'eval-grader-test-'))
  roots.push(root)
  writeFileSync(join(root, 'index.html'), html)
  const task = {
    id: 'grader-adversarial', fixture: 'forms', fixtureKind: 'static', category: 'protocol-smoke', difficulty: 'hard', title: 'grader adversarial',
    arms: ['full'], rounds: [], grader: { pass: [assertion] }, golden: { kind: 'html-dir', dir: 'golden' },
  } satisfies LoadedEvalTask
  const served = await serveFixtureDir(task, root)
  const evidence = join(root, 'evidence')
  mkdirSync(evidence)
  try {
    return (await grade(task, served.url, root, evidence)).pass
  } finally {
    await served.stop()
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('semantic eval grader adversarial boundaries', () => {
  it('rejects a fully transparent shadow but accepts a visible one', async () => {
    const assertion: DomAssertion = { kind: 'dom', selector: '#target', boxShadow: { minExtentPx: 5 } }
    await expect(gradeHtml('<style>#target{width:20px;height:20px;box-shadow:0 0 0 8px rgba(0,0,0,0)}</style><div id="target"></div>', assertion)).resolves.toBe(false)
    await expect(gradeHtml('<style>#target{width:20px;height:20px;box-shadow:0 2px 8px rgba(0,0,0,.15)}</style><div id="target"></div>', assertion)).resolves.toBe(true)
  })

  it('rejects a transparent color that only has dominant RGB channels', async () => {
    const assertion: DomAssertion = { kind: 'dom', selector: '#target', colorDominance: { property: 'background-color', channel: 'red' } }
    await expect(gradeHtml('<style>#target{background:rgba(255,0,0,0)}</style><div id="target">危险</div>', assertion)).resolves.toBe(false)
    await expect(gradeHtml('<style>#target{background:rgb(180,30,40)}</style><div id="target">危险</div>', assertion)).resolves.toBe(true)
  })

  it('accepts a destructive cue in text or border without requiring a dark red fill', async () => {
    const assertion: DomAssertion = { kind: 'dom', selector: '#target', dangerStyle: {} }
    await expect(gradeHtml('<style>#target{background:#eee;color:#222;border:1px solid #ccc}</style><button id="target">Delete</button>', assertion)).resolves.toBe(false)
    await expect(gradeHtml('<style>#target{background:#fbe9e9;color:#9c3030;border:0}</style><button id="target">Delete</button>', assertion)).resolves.toBe(true)
    await expect(gradeHtml('<style>#target{background:#fff;color:#222;border:2px solid #b4232f}</style><button id="target">Delete</button>', assertion)).resolves.toBe(true)
  })

  it('treats descendants of a display-none wrapper as effectively hidden', async () => {
    const assertion: DomAssertion = { kind: 'dom', selector: '#target', visible: false }
    await expect(gradeHtml('<div style="display:none"><button id="target">Hidden</button></div>', assertion)).resolves.toBe(true)
    await expect(gradeHtml('<button id="target">Visible</button>', assertion)).resolves.toBe(false)
  })

  it('requires a focus shadow to differ from the resting state', async () => {
    const assertion: DomAssertion = { kind: 'dom', selector: 'input', focus: true, boxShadow: { minExtentPx: 2, colorDominance: 'blue', requireFocusChange: true } }
    await expect(gradeHtml('<style>input{box-shadow:0 0 0 3px rgba(20,80,255,.3)}</style><input>', assertion)).resolves.toBe(false)
    await expect(gradeHtml('<style>input:focus{box-shadow:0 0 0 3px rgba(20,80,255,.3)}</style><input>', assertion)).resolves.toBe(true)
  })

  it('rejects overlapping cards that fake full horizontal coverage', async () => {
    const assertion: DomAssertion = { kind: 'dom', selector: '.grid', horizontalCoverage: { childSelector: '.card', minRatio: 0.98 } }
    const cards = '<i class="card"></i><i class="card"></i><i class="card"></i><i class="card"></i>'
    await expect(gradeHtml(`<style>.grid{position:relative;width:400px;height:30px}.card{position:absolute;inset:0;width:400px;height:20px}</style><div class="grid">${cards}</div>`, assertion)).resolves.toBe(false)
    await expect(gradeHtml(`<style>.grid{display:flex;width:400px;justify-content:space-between}.card{width:94px;height:20px}</style><div class="grid">${cards}</div>`, assertion)).resolves.toBe(true)
  })

  it('requires a pseudo-element accent to be on the left edge', async () => {
    const assertion: DomAssertion = { kind: 'dom', selector: '#target', leftAccentColor: '#7aa2ff' }
    const base = 'position:relative;width:100px;height:30px'
    await expect(gradeHtml(`<style>#target{${base}}#target::before{content:"";position:absolute;right:0;width:3px;height:100%;background:#7aa2ff}</style><div id="target"></div>`, assertion)).resolves.toBe(false)
    await expect(gradeHtml(`<style>#target{${base}}#target::before{content:"";position:absolute;left:0;width:3px;height:100%;background:#7aa2ff}</style><div id="target"></div>`, assertion)).resolves.toBe(true)
  })

  it('binds every accessible name to the title in its own card', async () => {
    const assertion: DomAssertion = { kind: 'dom', selector: 'button', all: true, accessibleNameFromDescendant: { ancestorSelector: 'article', descendantSelector: 'h2', prefix: '收藏' } }
    await expect(gradeHtml('<article><h2>台灯</h2><button aria-label="收藏商品"></button></article><article><h2>书桌</h2><button aria-label="收藏商品"></button></article>', assertion)).resolves.toBe(false)
    await expect(gradeHtml('<article><h2>台灯</h2><button aria-label="收藏台灯"></button></article><article><h2>书桌</h2><button aria-label="收藏书桌"></button></article>', assertion)).resolves.toBe(true)
  })
})
