import { loadFrozen } from './frozen.ts'
import type { EvalTask } from '../types.ts'

const { snapshot, captureMeta } = loadFrozen('react-todo-01', import.meta.url)

export const task: EvalTask = {
  id: 'react-todo-01',
  fixture: 'react-todo',
  fixtureKind: 'react',
  category: 'interaction',
  difficulty: 'hard',
  title: 'Hover highlight for sidebar items',
  instruction: '让侧边栏列表项在鼠标悬停时背景高亮为 #eef2ff',
  capture: {
    target: 'li.nav-item',
    comment: '让侧边栏列表项在鼠标悬停时背景高亮为 #eef2ff',
  },
  snapshot,
  captureMeta,
  grader: {
    pass: [{ kind: 'dom', selector: 'li.nav-item', hover: true, style: { 'background-color': '#eef2ff' } }],
    noRegression: [{ kind: 'dom', selector: '.add-button', style: { 'background-color': '#4c6ef5' } }],
  },
  golden: { kind: 'git-patch', patchFile: 'golden.patch' },
}
