import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { armContextTexts } from '../../../eval/arm-context.ts'
import { runnerTaskPayload } from '../../../eval/runner/payload.ts'
import { runDirFor, stageIsolatedWorkspace } from '../../../eval/runner/run-one.ts'
import type { AnnotationSnapshot } from '../src/annotation-contract.ts'
import { formatAnnotationContext, parseAnnotationBody } from '../src/annotation-context.ts'
import type { EvalTask } from '../../../eval/types.ts'

const snapshot: AnnotationSnapshot = {
  sessionId: 'session-eval',
  selectedSkills: [],
  page: { url: 'http://127.0.0.1:5173/', title: 'Untrusted title' },
  comments: [{
    id: 'comment-1', comment: 'Make this action destructive.', tagName: 'button', role: 'button', label: 'Cancel order',
    cssPath: '.cancel-order', fullPath: 'html > body > button.cancel-order', stableClasses: ['cancel-order'],
    textContent: 'Cancel order', inToolChrome: false,
    anchor: { framework: 'react', component: 'OrderTable', file: 'src/OrderTable.tsx', line: 12 },
    changes: [{ property: 'background-color', before: 'rgb(0, 0, 255)', after: '#b4232f' }],
    textChange: null, viewport: { width: 390, height: 844 },
  }],
}

describe('plugin capability eval contexts', () => {
  it('keeps user intent but removes localization evidence in the text-only arm', () => {
    const production = formatAnnotationContext(snapshot)
    const [full] = armContextTexts('full', snapshot, production)
    const [textOnly] = armContextTexts('text-only', snapshot, production)
    expect(full?.text).toContain('Target selector: .cancel-order')
    expect(full?.text).toContain('Source: src/OrderTable.tsx:12')
    expect(textOnly?.text).toContain('Make this action destructive.')
    expect(textOnly?.text).toContain('background-color: #b4232f')
    expect(textOnly?.text).not.toContain('.cancel-order')
    expect(textOnly?.text).not.toContain('OrderTable.tsx')
    expect(textOnly?.text).not.toContain('390x844')
    expect(textOnly?.text).not.toContain('rgb(0, 0, 255)')
    expect(textOnly?.plugin).toBe(full?.plugin)
    expect(textOnly?.text).not.toMatch(/text-only|eval arm|intentionally unavailable/iu)
  })

  it('adds oracle hints after the unchanged production Browser comments', () => {
    const production = formatAnnotationContext(snapshot)
    const full = armContextTexts('full', snapshot, production)
    const oracle = armContextTexts('oracle', snapshot, production, 'Inspect src/OrderTable.tsx.')
    expect(oracle[0]).toEqual(full[0])
    expect(oracle[1]?.plugin).toBe('dsh-web-review-eval-oracle')
    expect(oracle[1]?.text).toContain('Inspect src/OrderTable.tsx.')
  })

  it('preserves generic prompts and round order in runner payloads', () => {
    const round = (id: string) => ({ prompt: '请根据页面批注修改前端实现。', capture: [], snapshot: { ...snapshot, sessionId: id }, captureMeta: undefined })
    const task = {
      id: 'iterative', fixture: 'landing', fixtureKind: 'static', category: 'iterative', difficulty: 'long', title: 'two rounds',
      tokenBudget: { expected: 20_000, warnAbove: 30_000 },
      arms: ['full', 'oracle'], rounds: [{ ...round('round-1'), oracleContext: 'First source hint.' }, { ...round('round-2'), oracleContext: 'Second source hint.' }],
      grader: { pass: [] }, golden: { kind: 'html-dir', dir: 'golden' },
    } satisfies EvalTask
    const payload = runnerTaskPayload(task, 'oracle')
    expect(payload.rounds.map(candidate => (candidate.snapshot as AnnotationSnapshot).sessionId)).toEqual(['round-1', 'round-2'])
    expect(payload.rounds.map(candidate => candidate.prompt)).toEqual([
      '请根据页面批注修改前端实现。', '请根据页面批注修改前端实现。',
    ])
  })

  it('keeps model-adjacent run paths neutral', () => {
    const path = runDirFor('secret-task', 'text-only', 7)
    expect(path).not.toContain('secret-task')
    expect(path).not.toContain('text-only')
    expect(path).not.toContain('-r7-')
    expect(path).toMatch(/\/run-[0-9a-f-]+$/u)
  })

  it('stages fixture contents inside the isolated model workspace', () => {
    const task = {
      id: 'isolation-check', fixture: 'landing', fixtureKind: 'static', category: 'protocol-smoke', difficulty: 'easy', title: 'isolation',
      tokenBudget: { expected: 20_000, warnAbove: 25_000 },
      arms: ['full'], rounds: [], grader: { pass: [] }, golden: { kind: 'html-dir', dir: 'golden' },
    } satisfies EvalTask
    const isolated = stageIsolatedWorkspace(task)
    try {
      expect(existsSync(`${isolated.workspaceDir}/index.html`)).toBe(true)
      expect(isolated.workspaceDir).toBe(`${isolated.liveRoot}/workspace`)
    } finally {
      rmSync(isolated.liveRoot, { recursive: true, force: true })
    }
  })

  it('accepts every long-task frozen snapshot through the production parser', () => {
    const frozen = (id: string): AnnotationSnapshot => {
      const path = fileURLToPath(new URL(`../../../eval/tasks/frozen/${id}.snapshot.json`, import.meta.url))
      const parsed = parseAnnotationBody(readFileSync(path, 'utf8'))
      expect(parsed, id).toBeDefined()
      return parsed!
    }
    const operations = frozen('react-operations-01')
    expect(operations.comments).toHaveLength(6)
    expect(operations.comments.every(comment => comment.anchor?.framework === 'react')).toBe(true)
    expect(operations.selectedSkills).toEqual(['better-interface'])

    const catalog = frozen('static-catalog-01')
    expect(catalog.comments).toHaveLength(5)
    expect(catalog.comments.every(comment => comment.anchor === null)).toBe(true)
    expect(catalog.selectedSkills).toEqual(['better-accessibility'])
  })
})
