import { loadFrozen } from './frozen.ts'
import type { EvalTask } from '../types.ts'

const { snapshot, captureMeta } = loadFrozen('react-shop-04', import.meta.url)

export const task: EvalTask = {
  id: 'react-shop-04',
  fixture: 'react-shop',
  fixtureKind: 'react',
  category: 'layout',
  difficulty: 'medium',
  title: 'Switch the product grid to three columns',
  instruction: '把商品网格改成每行三列',
  capture: {
    target: '.products',
    comment: '把商品网格改成每行三列',
  },
  snapshot,
  captureMeta,
  grader: {
    // The grid's used track sizes resolve to pixels at render time, so a dom
    // style assertion on grid-template-columns would be brittle; assert the
    // source declaration for three equal flexible columns instead.
    pass: [{ kind: 'code', file: 'src/styles.css', contains: ['repeat(3, 1fr)'] }],
  },
  golden: { kind: 'git-patch', patchFile: 'golden.patch' },
}
