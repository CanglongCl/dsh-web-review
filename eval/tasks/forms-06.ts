import { loadFrozen } from './frozen.ts'
import type { EvalTask } from '../types.ts'

const { snapshot, captureMeta } = loadFrozen('forms-06', import.meta.url)

export const task: EvalTask = {
  id: 'forms-06',
  fixture: 'forms',
  fixtureKind: 'static',
  category: 'interaction',
  difficulty: 'medium',
  title: 'Darken submit button on hover',
  instruction: '鼠标悬停提交按钮时背景加深为 #3b5bdb',
  capture: {
    target: 'button[type="submit"]',
    comment: '鼠标悬停提交按钮时背景加深为 #3b5bdb',
  },
  snapshot,
  captureMeta,
  grader: {
    pass: [{ kind: 'dom', selector: 'button[type="submit"]', hover: true, style: { 'background-color': '#3b5bdb' } }],
    noRegression: [{ kind: 'dom', selector: 'button[type="submit"]', style: { 'background-color': '#4c6ef5' } }],
  },
  golden: { kind: 'html-dir', dir: 'golden' },
}
