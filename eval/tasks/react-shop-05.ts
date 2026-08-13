import { loadFrozen } from './frozen.ts'
import type { EvalTask } from '../types.ts'

const { snapshot, captureMeta } = loadFrozen('react-shop-05', import.meta.url)

export const task: EvalTask = {
  id: 'react-shop-05',
  fixture: 'react-shop',
  fixtureKind: 'react',
  category: 'batch',
  difficulty: 'hard',
  title: 'Unify add-to-cart button radius',
  instruction: '把所有“加入购物车”按钮的圆角统一改成 999px',
  capture: {
    target: '.buy',
    comment: '把所有“加入购物车”按钮的圆角统一改成 999px',
  },
  snapshot,
  captureMeta,
  grader: {
    pass: [{ kind: 'dom', selector: '.buy', all: true, style: { 'border-radius': '999px' } }],
    noRegression: [{ kind: 'dom', selector: '.product-card', style: { 'border-radius': '12px' } }],
  },
  golden: { kind: 'git-patch', patchFile: 'golden.patch' },
}
