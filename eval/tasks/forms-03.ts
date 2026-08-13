import { loadFrozen } from './frozen.ts'
import type { EvalTask } from '../types.ts'

const { snapshot, captureMeta } = loadFrozen('forms-03', import.meta.url)

export const task: EvalTask = {
  id: 'forms-03',
  fixture: 'forms',
  fixtureKind: 'static',
  category: 'color',
  difficulty: 'easy',
  title: '修改错误提示文字颜色',
  instruction: '把错误提示文字的颜色改成 #d64545',
  capture: {
    target: '.error',
    comment: '把错误提示文字的颜色改成 #d64545',
    adjusts: [{ property: 'color', after: '#d64545' }],
  },
  snapshot,
  captureMeta,
  grader: {
    pass: [{ kind: 'dom', selector: '.error', style: { color: '#d64545' } }],
    noRegression: [{ kind: 'dom', selector: 'label', style: { color: '#24292f' } }],
  },
  golden: { kind: 'html-dir', dir: 'golden' },
}
