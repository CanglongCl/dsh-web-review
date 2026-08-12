import { loadFrozen } from './frozen.ts'
import type { EvalTask } from '../types.ts'

const { snapshot, captureMeta } = loadFrozen('react-todo-04', import.meta.url)

export const task: EvalTask = {
  id: 'react-todo-04',
  fixture: 'react-todo',
  fixtureKind: 'react',
  category: 'effects',
  difficulty: 'medium',
  title: 'Add a soft shadow to the add button',
  instruction: '给添加按钮加上柔和阴影',
  capture: {
    target: '.add-button',
    comment: '给添加按钮加上柔和阴影',
  },
  snapshot,
  captureMeta,
  grader: {
    pass: [{ kind: 'code', file: 'src/styles.css', contains: ['box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15)'] }],
    noRegression: [{ kind: 'dom', selector: '.add-button', style: { 'background-color': '#4c6ef5' } }],
  },
  golden: { kind: 'git-patch', patchFile: 'golden.patch' },
}
