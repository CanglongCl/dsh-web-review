import { loadFrozen } from './frozen.ts'
import type { EvalTask } from '../types.ts'

const { snapshot, captureMeta } = loadFrozen('forms-09', import.meta.url)

export const task: EvalTask = {
  id: 'forms-09',
  fixture: 'forms',
  fixtureKind: 'static',
  category: 'typography',
  difficulty: 'medium',
  title: '放大并加粗表单标签',
  instruction: '把表单标签的字号加大到 15px 并加粗到 600',
  capture: {
    target: 'label',
    comment: '把表单标签的字号加大到 15px 并加粗到 600',
    adjusts: [{ property: 'font-size', after: '15px' }],
  },
  snapshot,
  captureMeta,
  grader: {
    pass: [{ kind: 'dom', selector: 'label', style: { 'font-size': '15px', 'font-weight': '600' }, all: true }],
    noRegression: [{ kind: 'dom', selector: 'input[type="text"]', style: { 'font-size': '14px' } }],
  },
  golden: { kind: 'html-dir', dir: 'golden' },
}
