import { loadFrozen } from './frozen.ts'
import type { EvalTask } from '../types.ts'

const { snapshot, captureMeta } = loadFrozen('landing-04', import.meta.url)

export const task: EvalTask = {
  id: 'landing-04',
  fixture: 'landing',
  fixtureKind: 'static',
  category: 'spacing',
  difficulty: 'easy',
  title: 'Increase spacing between cards',
  instruction: '把卡片之间的间距从 16px 加大到 24px',
  capture: {
    target: '.cards',
    comment: '把卡片之间的间距从 16px 加大到 24px',
    adjusts: [{ property: 'gap', after: '24px' }],
  },
  snapshot,
  captureMeta,
  grader: {
    pass: [{ kind: 'dom', selector: '.cards', style: { gap: '24px' } }],
  },
  golden: { kind: 'html-dir', dir: 'golden' },
}
