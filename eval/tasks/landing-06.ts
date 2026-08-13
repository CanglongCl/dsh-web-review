import { loadFrozen } from './frozen.ts'
import type { EvalTask } from '../types.ts'

const { snapshot, captureMeta } = loadFrozen('landing-06', import.meta.url)

export const task: EvalTask = {
  id: 'landing-06',
  fixture: 'landing',
  fixtureKind: 'static',
  category: 'effects',
  difficulty: 'medium',
  title: '增强卡片阴影',
  instruction: '给卡片增加更明显的阴影',
  capture: {
    target: '.card',
    comment: '给卡片增加更明显的阴影',
  },
  snapshot,
  captureMeta,
  grader: {
    pass: [{ kind: 'dom', selector: 'div:nth-of-type(1).card', boxShadow: { minExtentPx: 5 } }],
  },
  golden: { kind: 'html-dir', dir: 'golden' },
}
