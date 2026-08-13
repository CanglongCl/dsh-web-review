import { loadFrozen } from './frozen.ts'
import type { EvalTask } from '../types.ts'

const { snapshot, captureMeta } = loadFrozen('forms-08', import.meta.url)

export const task: EvalTask = {
  id: 'forms-08',
  fixture: 'forms',
  fixtureKind: 'static',
  category: 'effects',
  difficulty: 'medium',
  title: '为文本输入框添加聚焦阴影',
  instruction: '给输入框聚焦时增加淡蓝色阴影',
  capture: {
    target: 'input[type="text"]',
    comment: '给输入框聚焦时增加淡蓝色阴影',
  },
  snapshot,
  captureMeta,
  grader: {
    pass: [{ kind: 'dom', selector: 'input[type="text"]', focus: true, boxShadow: { minExtentPx: 2, colorDominance: 'blue', margin: 20, requireFocusChange: true } }],
  },
  golden: { kind: 'html-dir', dir: 'golden' },
}
