import { loadFrozen } from './frozen.ts'
import type { EvalTask } from '../types.ts'

const { snapshot, captureMeta } = loadFrozen('react-dashboard-02', import.meta.url)

export const task: EvalTask = {
  id: 'react-dashboard-02',
  fixture: 'react-dashboard',
  fixtureKind: 'react',
  category: 'color',
  difficulty: 'medium',
  title: 'Lighten the stat card background',
  instruction: '把统计卡片的背景改成 #f1f5ff',
  capture: {
    target: '.stat-card',
    comment: '把统计卡片的背景改成 #f1f5ff',
    adjusts: [{ property: 'background-color', after: '#f1f5ff' }],
  },
  snapshot,
  captureMeta,
  grader: {
    pass: [{ kind: 'dom', selector: '.stat-card', style: { 'background-color': '#f1f5ff' } }],
    noRegression: [{ kind: 'dom', selector: '.stat-value', style: { color: '#1f2937' } }],
  },
  golden: { kind: 'git-patch', patchFile: 'golden.patch' },
}
