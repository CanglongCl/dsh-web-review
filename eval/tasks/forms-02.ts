import { loadFrozen } from './frozen.ts'
import type { EvalTask } from '../types.ts'

const { snapshot, captureMeta } = loadFrozen('forms-02', import.meta.url)

export const task: EvalTask = {
  id: 'forms-02',
  fixture: 'forms',
  fixtureKind: 'static',
  category: 'accessibility',
  difficulty: 'medium',
  title: '为搜索输入框添加可访问名称',
  instruction: '给顶部搜索输入框补上可访问名称“搜索”',
  capture: {
    target: 'input[type="search"]',
    comment: '给顶部搜索输入框补上可访问名称“搜索”',
  },
  snapshot,
  captureMeta,
  grader: {
    pass: [{ kind: 'dom', selector: 'input[type="search"]', accessibleName: '搜索' }],
  },
  golden: { kind: 'html-dir', dir: 'golden' },
}
