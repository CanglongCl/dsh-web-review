import { loadFrozenRound } from './frozen.ts'
import type { EvalTask } from '../types.ts'

const frozen = loadFrozenRound('landing-01', 1, import.meta.url)

export const task: EvalTask = {
  id: 'landing-01',
  fixture: 'landing',
  fixtureKind: 'static',
  category: 'protocol-smoke',
  difficulty: 'easy',
  title: 'Darken the primary button',
  arms: ['full'],
  rounds: [{
    prompt: '请根据页面批注修改前端实现。',
    capture: [{
      target: 'button.btn-primary',
      comment: '把首页主按钮的背景颜色改深一点，改成 #224466',
      adjusts: [{ property: 'background-color', after: '#224466' }],
    }],
    ...frozen,
  }],
  grader: {
    pass: [{ kind: 'dom', selector: 'button.btn-primary', style: { 'background-color': '#224466' } }],
    noRegression: [{ kind: 'dom', selector: 'button.btn-ghost', style: { 'background-color': '#eef0f3' } }],
  },
  golden: { kind: 'html-dir', dir: 'golden' },
}
