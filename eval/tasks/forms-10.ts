import { loadFrozen } from './frozen.ts'
import type { EvalTask } from '../types.ts'

const { snapshot, captureMeta } = loadFrozen('forms-10', import.meta.url)

export const task: EvalTask = {
  id: 'forms-10',
  fixture: 'forms',
  fixtureKind: 'static',
  category: 'batch',
  difficulty: 'hard',
  title: '统一输入框圆角',
  instruction: '把所有输入框的圆角统一改成 8px',
  capture: {
    target: 'input',
    comment: '把所有输入框的圆角统一改成 8px',
  },
  snapshot,
  captureMeta,
  grader: {
    pass: [{ kind: 'dom', selector: 'input', all: true, style: { 'border-radius': '8px' } }],
    noRegression: [{ kind: 'dom', selector: 'button[type="submit"]', style: { 'border-radius': '6px' } }],
  },
  golden: { kind: 'html-dir', dir: 'golden' },
}
