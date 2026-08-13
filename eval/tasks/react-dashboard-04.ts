import { loadFrozen } from './frozen.ts'
import type { EvalTask } from '../types.ts'

const { snapshot, captureMeta } = loadFrozen('react-dashboard-04', import.meta.url)

export const task: EvalTask = {
  id: 'react-dashboard-04',
  fixture: 'react-dashboard',
  fixtureKind: 'react',
  category: 'responsive',
  difficulty: 'hard',
  title: '在窄屏下纵向排列统计卡片',
  instruction: '窗口宽度小于 768px 时统计卡片堆叠成单列',
  capture: {
    target: '.stats',
    comment: '窗口宽度小于 768px 时统计卡片堆叠成单列',
  },
  snapshot,
  captureMeta,
  grader: {
    pass: [{ kind: 'dom', selector: '.stats', viewport: { width: 375, height: 800 }, itemsPerRow: { childSelector: '.stat-card', count: 1 } }],
    noRegression: [{ kind: 'dom', selector: '.stats', itemsPerRow: { childSelector: '.stat-card', count: 4 } }],
  },
  golden: { kind: 'git-patch', patchFile: 'golden.patch' },
}
