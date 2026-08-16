import { loadFrozenRound } from './frozen.ts'
import type { EvalTask } from '../types.ts'
import { task as forms01 } from './forms-01.ts'
import { task as forms02 } from './forms-02.ts'
import { task as forms03 } from './forms-03.ts'
import { task as forms04 } from './forms-04.ts'
import { task as forms05 } from './forms-05.ts'
import { task as forms06 } from './forms-06.ts'
import { task as forms07 } from './forms-07.ts'
import { task as forms08 } from './forms-08.ts'
import { task as forms09 } from './forms-09.ts'
import { task as forms10 } from './forms-10.ts'

const parts = [forms01, forms02, forms03, forms04, forms05, forms06, forms07, forms08, forms09, forms10]
const frozen = loadFrozenRound('forms-combo', 1, import.meta.url)

export const task: EvalTask = {
  id: 'forms-combo',
  fixture: 'forms',
  fixtureKind: 'static',
  category: 'multi-target',
  difficulty: 'long',
  title: '统一处理表单页面的七条批注',
  tokenBudget: { expected: 60000, warnAbove: 80000 },
  arms: ['full'],
  rounds: [{
    prompt: '请根据页面批注修改前端实现。',
    capture: [{
      target: 'button[type="submit"]',
      comment: '把提交按钮文案从“提交”改成“立即提交”，鼠标悬停时背景加深为 #3b5bdb',
    }, {
      target: 'input[type="search"]',
      comment: '给顶部搜索输入框补上可访问名称“搜索”',
    }, {
      target: '.error',
      comment: '把错误提示文字的颜色改成 #d64545，并把邮箱错误提示文案改成“请填写有效的邮箱地址”',
    }, {
      target: '.form-field',
      comment: '加大表单项之间的垂直间距',
    }, {
      target: '.form',
      comment: '让表单容器水平居中并限制最大宽度为 480px',
      targetPosition: { xRatio: 0.5, yRatio: 0.02 },
    }, {
      target: '#email',
      comment: '给输入框聚焦时增加淡蓝色阴影，并把所有输入框的圆角统一改成 8px',
    }, {
      target: 'label',
      comment: '把表单标签的字号加大到 15px 并加粗到 600',
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
