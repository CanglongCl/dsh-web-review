import { loadFrozen } from './frozen.ts'
import type { EvalTask } from '../types.ts'

const { snapshot, captureMeta } = loadFrozen('react-dashboard-05', import.meta.url)

export const task: EvalTask = {
  id: 'react-dashboard-05',
  fixture: 'react-dashboard',
  fixtureKind: 'react',
  category: 'effects',
  difficulty: 'medium',
  title: '增强统计卡片阴影',
  instruction: '给统计卡片加上更明显的阴影',
  capture: {
    target: '.stat-card',
    comment: '给统计卡片加上更明显的阴影',
  },
  snapshot,
  captureMeta,
  grader: {
    pass: [{ kind: 'dom', selector: '.stat-card', boxShadow: { minExtentPx: 5 }, all: true }],
    noRegression: [{ kind: 'dom', selector: '.stat-card', style: { padding: '20px' } }],
  },
  golden: { kind: 'git-patch', patchFile: 'golden.patch' },
}
