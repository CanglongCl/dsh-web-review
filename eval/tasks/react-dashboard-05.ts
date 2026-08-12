import { loadFrozen } from './frozen.ts'
import type { EvalTask } from '../types.ts'

const { snapshot, captureMeta } = loadFrozen('react-dashboard-05', import.meta.url)

export const task: EvalTask = {
  id: 'react-dashboard-05',
  fixture: 'react-dashboard',
  fixtureKind: 'react',
  category: 'effects',
  difficulty: 'medium',
  title: 'Strengthen the stat card shadow',
  instruction: '给统计卡片加上更明显的阴影',
  capture: {
    target: '.stat-card',
    comment: '给统计卡片加上更明显的阴影',
  },
  snapshot,
  captureMeta,
  grader: {
    pass: [{ kind: 'code', file: 'src/styles.css', contains: ['0 8px 24px rgba(0, 0, 0, 0.15)'] }],
    noRegression: [{ kind: 'dom', selector: '.stat-card', style: { padding: '20px' } }],
  },
  golden: { kind: 'git-patch', patchFile: 'golden.patch' },
}
