import { loadFrozen } from './frozen.ts'
import type { EvalTask } from '../types.ts'

const { snapshot, captureMeta } = loadFrozen('react-todo-03', import.meta.url)

export const task: EvalTask = {
  id: 'react-todo-03',
  fixture: 'react-todo',
  fixtureKind: 'react',
  category: 'text',
  difficulty: 'easy',
  title: '修改添加按钮文案',
  instruction: '把"添加任务"按钮文案改成"新建任务"',
  capture: {
    target: '.add-button',
    comment: '把"添加任务"按钮文案改成"新建任务"',
  },
  snapshot,
  captureMeta,
  grader: {
    pass: [{ kind: 'dom', selector: '.add-button', text: '新建任务' }],
    noRegression: [{ kind: 'dom', selector: '.add-button', style: { 'background-color': '#4c6ef5' } }],
  },
  golden: { kind: 'git-patch', patchFile: 'golden.patch' },
}
