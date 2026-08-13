import { loadFrozen } from './frozen.ts'
import type { EvalTask } from '../types.ts'

const { snapshot, captureMeta } = loadFrozen('react-shop-04', import.meta.url)

export const task: EvalTask = {
  id: 'react-shop-04',
  fixture: 'react-shop',
  fixtureKind: 'react',
  category: 'layout',
  difficulty: 'medium',
  title: '将商品网格改为三列',
  instruction: '把商品网格改成每行三列',
  capture: {
    target: '.products',
    comment: '把商品网格改成每行三列',
  },
  snapshot,
  captureMeta,
  grader: {
    pass: [{ kind: 'dom', selector: '.products', itemsPerRow: { childSelector: '.product-card', count: 3 } }],
  },
  golden: { kind: 'git-patch', patchFile: 'golden.patch' },
}
