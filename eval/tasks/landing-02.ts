import { loadFrozen } from './frozen.ts'
import type { EvalTask } from '../types.ts'

const { snapshot, captureMeta } = loadFrozen('landing-02', import.meta.url)

export const task: EvalTask = {
  id: 'landing-02',
  fixture: 'landing',
  fixtureKind: 'static',
  category: 'text',
  difficulty: 'easy',
  title: '修改了解更多按钮文案',
  instruction: '把第三个卡片里的“了解更多”按钮文案改成“查看详情”',
  capture: {
    target: '.card:nth-of-type(3) button.btn-ghost',
    comment: '把第三个卡片里的“了解更多”按钮文案改成“查看详情”',
  },
  snapshot,
  captureMeta,
  grader: {
    pass: [{ kind: 'dom', selector: '.card:nth-of-type(3) button.btn-ghost', text: '查看详情' }],
  },
  golden: { kind: 'html-dir', dir: 'golden' },
}
