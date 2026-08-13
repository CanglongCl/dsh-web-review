import { loadFrozenRound } from './frozen.ts'
import type { EvalTask } from '../types.ts'

const frozen = loadFrozenRound('react-todo-01', 1, import.meta.url)

export const task: EvalTask = {
  id: 'react-todo-01',
  fixture: 'react-todo',
  fixtureKind: 'react',
  category: 'protocol-smoke',
  difficulty: 'hard',
  title: '为侧栏项目添加悬停高亮',
  arms: ['full'],
  rounds: [{
    prompt: '请根据页面批注修改前端实现。',
    capture: [{
      target: 'li.nav-item',
      comment: '让侧边栏列表项在鼠标悬停时背景高亮为 #eef2ff',
    }],
    ...frozen,
  }],
  grader: {
    pass: [{ kind: 'dom', selector: 'li.nav-item', hover: true, style: { 'background-color': '#eef2ff' }, all: true }],
    noRegression: [{ kind: 'dom', selector: '.add-button', style: { 'background-color': '#4c6ef5' } }],
  },
  golden: { kind: 'git-patch', patchFile: 'golden.patch' },
}
