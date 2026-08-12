import { loadFrozen } from './frozen.ts'
import type { EvalTask } from '../types.ts'

const { snapshot, captureMeta } = loadFrozen('forms-01', import.meta.url)

export const task: EvalTask = {
  id: 'forms-01',
  fixture: 'forms',
  fixtureKind: 'static',
  category: 'text',
  difficulty: 'easy',
  title: 'Rename the submit button',
  instruction: '把提交按钮文案从“提交”改成“立即提交”',
  capture: {
    target: 'button[type="submit"]',
    comment: '把提交按钮文案从“提交”改成“立即提交”',
  },
  snapshot,
  captureMeta,
  grader: {
    pass: [{ kind: 'dom', selector: 'button[type="submit"]', text: '立即提交' }],
    noRegression: [{ kind: 'dom', selector: 'button[type="submit"]', style: { 'background-color': '#4c6ef5' } }],
  },
  golden: { kind: 'html-dir', dir: 'golden' },
}
