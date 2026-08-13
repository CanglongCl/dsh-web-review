import { loadFrozen } from './frozen.ts'
import type { EvalTask } from '../types.ts'

const { snapshot, captureMeta } = loadFrozen('react-shop-02', import.meta.url)

export const task: EvalTask = {
  id: 'react-shop-02',
  fixture: 'react-shop',
  fixtureKind: 'react',
  category: 'typography',
  difficulty: 'medium',
  title: '加粗商品标题',
  instruction: '把商品标题的字重加粗到 700',
  capture: {
    target: '.product-title',
    comment: '把商品标题的字重加粗到 700',
  },
  snapshot,
  captureMeta,
  grader: {
    pass: [{ kind: 'dom', selector: '.product-title', style: { 'font-weight': '700' } }],
    noRegression: [{ kind: 'dom', selector: '.price', style: { 'font-weight': '600' } }],
  },
  golden: { kind: 'git-patch', patchFile: 'golden.patch' },
}
