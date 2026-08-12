import { loadFrozen } from './frozen.ts'
import type { EvalTask } from '../types.ts'

const { snapshot, captureMeta } = loadFrozen('forms-07', import.meta.url)

export const task: EvalTask = {
  id: 'forms-07',
  fixture: 'forms',
  fixtureKind: 'static',
  category: 'text',
  difficulty: 'medium',
  title: 'Update the email error message',
  instruction: '把邮箱错误提示文案改成“请填写有效的邮箱地址”',
  capture: {
    target: '.error',
    comment: '把邮箱错误提示文案改成“请填写有效的邮箱地址”',
  },
  snapshot,
  captureMeta,
  grader: {
    pass: [{ kind: 'dom', selector: '.error', text: '请填写有效的邮箱地址' }],
  },
  golden: { kind: 'html-dir', dir: 'golden' },
}
