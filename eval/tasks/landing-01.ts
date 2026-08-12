import { loadFrozen } from './frozen.ts'
import type { EvalTask } from '../types.ts'

const { snapshot, captureMeta } = loadFrozen('landing-01', import.meta.url)

export const task: EvalTask = {
  id: 'landing-01',
  fixture: 'landing',
  fixtureKind: 'static',
  category: 'color',
  difficulty: 'easy',
  title: 'Darken the primary button',
  instruction: '把首页主按钮的背景颜色改深一点，改成 #224466',
  capture: {
    target: 'button.btn-primary',
    comment: '把首页主按钮的背景颜色改深一点，改成 #224466',
    adjusts: [{ property: 'background-color', after: '#224466' }],
  },
  snapshot,
  captureMeta,
  grader: {
    pass: [{ kind: 'dom', selector: 'button.btn-primary', style: { 'background-color': '#224466' } }],
    noRegression: [{ kind: 'dom', selector: 'button.btn-ghost', style: { 'background-color': '#eef0f3' } }],
  },
  golden: { kind: 'html-dir', dir: 'golden' },
}
