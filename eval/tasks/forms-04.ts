import { loadFrozen } from './frozen.ts'
import type { EvalTask } from '../types.ts'

const { snapshot, captureMeta } = loadFrozen('forms-04', import.meta.url)

export const task: EvalTask = {
  id: 'forms-04',
  fixture: 'forms',
  fixtureKind: 'static',
  category: 'spacing',
  difficulty: 'medium',
  title: 'Increase spacing between form fields',
  instruction: '加大表单项之间的垂直间距',
  capture: {
    target: '.form-field',
    comment: '加大表单项之间的垂直间距',
  },
  snapshot,
  captureMeta,
  grader: {
    pass: [{ kind: 'dom', selector: '.form-field', style: { 'margin-bottom': '24px' } }],
    noRegression: [{ kind: 'dom', selector: '.form', style: { 'background-color': '#fff' } }],
  },
  golden: { kind: 'html-dir', dir: 'golden' },
}
