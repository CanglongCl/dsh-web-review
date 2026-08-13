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
    pass: [{ kind: 'dom', selector: '.form', centered: { maxWidthPx: 528, tolerancePx: 2 } }],
  },
  golden: { kind: 'html-dir', dir: 'golden' },
}
