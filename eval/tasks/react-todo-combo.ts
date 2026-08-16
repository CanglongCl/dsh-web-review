import { loadFrozenRound } from './frozen.ts'
import type { EvalTask } from '../types.ts'
import { task as todo01 } from './react-todo-01.ts'
import { task as todo02 } from './react-todo-02.ts'
import { task as todo03 } from './react-todo-03.ts'
import { task as todo04 } from './react-todo-04.ts'
import { task as todo05 } from './react-todo-05.ts'

const parts = [todo01, todo02, todo03, todo04, todo05]
const frozen = loadFrozenRound('react-todo-combo', 1, import.meta.url)

export const task: EvalTask = {
  id: 'react-todo-combo',
  fixture: 'react-todo',
  fixtureKind: 'react',
  category: 'multi-target',
  difficulty: 'long',
  title: '统一处理待办页面的四条批注',
  tokenBudget: { expected: 45000, warnAbove: 60000 },
  arms: ['full'],
  rounds: [{
    prompt: '请根据页面批注修改前端实现。',
    capture: [{
      target: 'li.nav-item',
      comment: '让侧边栏列表项在鼠标悬停时背景高亮为 #eef2ff',
    }, {
      target: '.todo-item',
      comment: '加大待办事项之间的间距',
    }, {
      target: '.add-button',
      comment: '把“添加任务”按钮文案改成“新建任务”，并给它加上柔和阴影',
      adjusts: [{ property: 'text', after: '新建任务' }],
    }, {
      target: 'li.nav-item:nth-of-type(3)',
      comment: '把侧边栏“草稿”这一项改成“草稿箱”',
    }],
    ...frozen,
  }],
  grader: {
    pass: parts.flatMap(part => part.grader.pass),
    noRegression: parts.flatMap(part => part.grader.noRegression ?? []),
    negative: parts.flatMap(part => part.grader.negative ?? []),
  },
  golden: { kind: 'git-patch', patchFile: 'golden.patch' },
}
