import { loadFrozen } from './frozen.ts'
import type { EvalTask } from '../types.ts'

const { snapshot, captureMeta } = loadFrozen('react-dashboard-01', import.meta.url)

export const task: EvalTask = {
  id: 'react-dashboard-01',
  fixture: 'react-dashboard',
  fixtureKind: 'react',
  category: 'layout',
  difficulty: 'hard',
  title: 'Evenly distribute the stat cards',
  instruction: '让统计卡片区域在页面上均匀分布并对齐',
  capture: {
    target: '.stats',
    comment: '让统计卡片区域在页面上均匀分布并对齐',
  },
  snapshot,
  captureMeta,
  grader: {
    pass: [{ kind: 'dom', selector: '.stats', style: { 'justify-content': 'space-between' } }],
    noRegression: [{ kind: 'dom', selector: '.stat-card', style: { 'border-radius': '12px' } }],
  },
  golden: { kind: 'git-patch', patchFile: 'golden.patch' },
}
