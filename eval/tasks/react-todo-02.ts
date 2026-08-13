import { loadFrozen } from './frozen.ts'
import type { EvalTask } from '../types.ts'

const { snapshot, captureMeta } = loadFrozen('react-todo-02', import.meta.url)

export const task: EvalTask = {
  id: 'react-todo-02',
  fixture: 'react-todo',
  fixtureKind: 'react',
  category: 'spacing',
  difficulty: 'medium',
  title: 'Increase spacing between todo items',
  instruction: '加大待办事项之间的间距',
  capture: {
    target: '.todo-item',
    comment: '加大待办事项之间的间距',
  },
  snapshot,
  captureMeta,
  grader: {
    pass: [{ kind: 'dom', selector: '.todo-item', style: { 'margin-bottom': '16px' } }],
    noRegression: [{ kind: 'dom', selector: '.todo-item', text: '写评测用例' }],
  },
  golden: { kind: 'git-patch', patchFile: 'golden.patch' },
}
