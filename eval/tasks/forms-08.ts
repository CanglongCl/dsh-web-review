import { loadFrozen } from './frozen.ts'
import type { EvalTask } from '../types.ts'

const { snapshot, captureMeta } = loadFrozen('forms-08', import.meta.url)

export const task: EvalTask = {
  id: 'forms-08',
  fixture: 'forms',
  fixtureKind: 'static',
  category: 'effects',
  difficulty: 'medium',
  title: 'Add focus shadow to text inputs',
  instruction: '给输入框聚焦时增加淡蓝色阴影',
  capture: {
    target: 'input[type="text"]',
    comment: '给输入框聚焦时增加淡蓝色阴影',
  },
  snapshot,
  captureMeta,
  grader: {
    pass: [{ kind: 'code', file: 'index.html', contains: ['input[type="text"]:focus', 'box-shadow: 0 0 0 3px rgba(76, 110, 245, 0.25)'] }],
  },
  golden: { kind: 'html-dir', dir: 'golden' },
}
