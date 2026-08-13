import { loadFrozen } from './frozen.ts'
import type { EvalTask } from '../types.ts'

const { snapshot, captureMeta } = loadFrozen('forms-05', import.meta.url)

export const task: EvalTask = {
  id: 'forms-05',
  fixture: 'forms',
  fixtureKind: 'static',
  category: 'layout',
  difficulty: 'hard',
  title: '居中表单并限制最大宽度',
  instruction: '让表单容器水平居中并限制最大宽度为 480px',
  capture: {
    target: '.form',
    comment: '让表单容器水平居中并限制最大宽度为 480px',
  },
  snapshot,
  captureMeta,
  grader: {
    // margin-left/right: auto resolves to a used pixel value at the grader's
    // 1680px viewport (body padding 32px + 480px max-width + 48px padding →
    // (1680-32-528)/2 = 560px), so assert the final computed values.
    pass: [{ kind: 'dom', selector: '.form', style: { 'max-width': '480px', 'margin-left': '560px', 'margin-right': '560px' } }],
  },
  golden: { kind: 'html-dir', dir: 'golden' },
}
