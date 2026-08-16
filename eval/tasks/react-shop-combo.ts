import { loadFrozenRound } from './frozen.ts'
import type { EvalTask } from '../types.ts'
import { task as shop01 } from './react-shop-01.ts'
import { task as shop02 } from './react-shop-02.ts'
import { task as shop03 } from './react-shop-03.ts'
import { task as shop04 } from './react-shop-04.ts'
import { task as shop05 } from './react-shop-05.ts'

const parts = [shop01, shop02, shop03, shop04, shop05]
const frozen = loadFrozenRound('react-shop-combo', 1, import.meta.url)

export const task: EvalTask = {
  id: 'react-shop-combo',
  fixture: 'react-shop',
  fixtureKind: 'react',
  category: 'multi-target',
  difficulty: 'long',
  title: '统一处理商品页面的四条批注',
  tokenBudget: { expected: 45000, warnAbove: 60000 },
  arms: ['full'],
  rounds: [{
    prompt: '请根据页面批注修改前端实现。',
    capture: [{
      target: '.price',
      comment: '把价格文字的颜色改成 #e8590c',
    }, {
      target: '.product-title',
      comment: '把商品标题的字重加粗到 700',
    }, {
      target: '.products',
      comment: '加大商品卡片之间的间距，并把商品网格改成每行三列',
    }, {
      target: '.buy',
      comment: '把所有“加入购物车”按钮的圆角统一改成 999px',
    }],
    ...frozen,
  }],
  grader: {
    pass: parts.flatMap(part => part.grader.pass),
    noRegression: parts.flatMap(part => part.grader.noRegression ?? []),
    negative: parts.flatMap(part => part.grader.negative ?? []),
  },
  golden: { kind: 'git-patch', patchFile: 'golden.patch' },
}
