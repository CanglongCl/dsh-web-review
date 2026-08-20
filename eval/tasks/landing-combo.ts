import { loadFrozenRound } from './frozen.ts'
import type { EvalTask } from '../types.ts'
import { task as landing01 } from './landing-01.ts'
import { task as landing02 } from './landing-02.ts'
import { task as landing03 } from './landing-03.ts'
import { task as landing04 } from './landing-04.ts'
import { task as landing05 } from './landing-05.ts'
import { task as landing06 } from './landing-06.ts'
import { task as landing07 } from './landing-07.ts'
import { task as landing08 } from './landing-08.ts'
import { task as landing09 } from './landing-09.ts'
import { task as landing10 } from './landing-10.ts'

const parts = [landing01, landing02, landing03, landing04, landing05, landing06, landing07, landing08, landing09, landing10]
const frozen = loadFrozenRound('landing-combo', 1, import.meta.url)

export const task: EvalTask = {
  id: 'landing-combo',
  fixture: 'landing',
  fixtureKind: 'static',
  category: 'multi-target',
  difficulty: 'long',
  title: '统一处理落地页的八条批注',
  tokenBudget: { expected: 60000, warnAbove: 80000 },
  arms: ['full'],
  rounds: [{
    prompt: '请根据页面批注修改前端实现。',
    capture: [{
      target: 'button.btn-primary',
      comment: '把首页主按钮的背景颜色改深一点，改成 #224466，并把内边距加大到上下 10px、左右 24px',
      adjusts: [{ property: 'background-color', after: '#224466' }],
    }, {
      target: '.card:nth-of-type(3) button.btn-ghost',
      comment: '把第三个卡片里的“了解更多”按钮文案改成“查看详情”',
    }, {
      target: '.hero h1',
      comment: '把首页主标题的字号从 28px 加大到 32px',
    }, {
      target: '.cards',
      comment: '把卡片之间的间距从 16px 加大到 24px',
    }, {
      target: '.hero',
      comment: '让首页宣传区的内容改为左对齐',
      targetPosition: { xRatio: 0.08, yRatio: 0.9 },
    }, {
      target: '.card',
      comment: '给卡片增加更明显的阴影，并把所有卡片的圆角从 12px 改成 8px',
    }, {
      target: '.card:nth-of-type(2) button.btn-ghost',
      comment: '把“取消”按钮的背景改成浅灰色 #d7dbe0',
    }, {
      target: '.card h3',
      comment: '把卡片标题的字重加粗到 600',
    }],
    ...frozen,
  }],
  grader: {
    pass: parts.flatMap(part => part.grader.pass),
    noRegression: parts.flatMap(part => part.grader.noRegression ?? []),
    negative: parts.flatMap(part => part.grader.negative ?? []),
  },
  golden: { kind: 'html-dir', dir: 'golden' },
}
