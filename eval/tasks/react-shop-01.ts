import { loadFrozen } from './frozen.ts'
import type { EvalTask } from '../types.ts'

const { snapshot, captureMeta } = loadFrozen('react-shop-01', import.meta.url)

export const task: EvalTask = {
  id: 'react-shop-01',
  fixture: 'react-shop',
  fixtureKind: 'react',
  category: 'color',
  difficulty: 'easy',
  title: '修改商品价格颜色',
  instruction: '把价格文字的颜色改成 #e8590c',
  capture: {
    target: '.price',
    comment: '把价格文字的颜色改成 #e8590c',
    adjusts: [{ property: 'color', after: '#e8590c' }],
  },
  snapshot,
  captureMeta,
  grader: {
    pass: [{ kind: 'dom', selector: '.price', style: { color: '#e8590c' }, all: true }],
    noRegression: [{ kind: 'dom', selector: '.product-title', style: { color: '#24292f' } }],
  },
  golden: { kind: 'git-patch', patchFile: 'golden.patch' },
}
