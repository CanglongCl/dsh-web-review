import { loadFrozen } from './frozen.ts'
import type { EvalTask } from '../types.ts'

const { snapshot, captureMeta } = loadFrozen('landing-06', import.meta.url)

export const task: EvalTask = {
  id: 'landing-06',
  fixture: 'landing',
  fixtureKind: 'static',
  category: 'effects',
  difficulty: 'medium',
  title: 'Strengthen the card shadow',
  instruction: '给卡片增加更明显的阴影',
  capture: {
    target: '.card',
    comment: '给卡片增加更明显的阴影',
  },
  snapshot,
  captureMeta,
  grader: {
    pass: [{ kind: 'code', file: 'index.html', contains: ['0 8px 24px rgba(0, 0, 0, 0.15)'] }],
  },
  golden: { kind: 'html-dir', dir: 'golden' },
}
