import { loadFrozen } from './frozen.ts'
import type { EvalTask } from '../types.ts'

const { snapshot, captureMeta } = loadFrozen('react-todo-05', import.meta.url)

export const task: EvalTask = {
  id: 'react-todo-05',
  fixture: 'react-todo',
  fixtureKind: 'react',
  category: 'anchor',
  difficulty: 'hard',
  title: 'Rename the drafts nav item',
  instruction: '把侧边栏"草稿"这一项改成"草稿箱"',
  capture: {
    target: 'li.nav-item:nth-of-type(3)',
    comment: '把侧边栏"草稿"这一项改成"草稿箱"',
  },
  snapshot,
  captureMeta,
  grader: {
    pass: [{ kind: 'dom', selector: 'li.nav-item:nth-of-type(3)', text: '草稿箱' }],
    noRegression: [
      { kind: 'dom', selector: 'li.nav-item:nth-of-type(1)', text: '收件箱' },
      { kind: 'dom', selector: 'li.nav-item:nth-of-type(2)', text: '已加星标' },
    ],
  },
  golden: { kind: 'git-patch', patchFile: 'golden.patch' },
}
