import { loadFrozen } from './frozen.ts'
import type { EvalTask } from '../types.ts'

const { snapshot, captureMeta } = loadFrozen('react-todo-04', import.meta.url)

export const task: EvalTask = {
  id: 'react-todo-04',
  fixture: 'react-todo',
  fixtureKind: 'react',
  category: 'effects',
  difficulty: 'medium',
  title: '为添加按钮增加柔和阴影',
  instruction: '给添加按钮加上柔和阴影',
  capture: {
    target: '.add-button',
    comment: '给添加按钮加上柔和阴影',
  },
  snapshot,
  captureMeta,
  grader: {
    pass: [{ kind: 'dom', selector: '.add-button', boxShadow: { minExtentPx: 5 } }],
    noRegression: [{ kind: 'dom', selector: '.add-button', style: { 'background-color': '#4c6ef5' } }],
  },
  golden: { kind: 'git-patch', patchFile: 'golden.patch' },
}
