import { loadFrozen } from './frozen.ts'
import type { EvalTask } from '../types.ts'

const { snapshot, captureMeta } = loadFrozen('landing-08', import.meta.url)

export const task: EvalTask = {
  id: 'landing-08',
  fixture: 'landing',
  fixtureKind: 'static',
  category: 'spacing',
  difficulty: 'medium',
  title: '加宽主按钮内边距',
  instruction: '把主按钮的内边距加大到上下 10px、左右 24px',
  capture: {
    target: 'button.btn-primary',
    comment: '把主按钮的内边距加大到上下 10px、左右 24px',
  },
  snapshot,
  captureMeta,
  grader: {
    pass: [{ kind: 'dom', selector: 'button.btn-primary', style: { 'padding-top': '10px', 'padding-right': '24px', 'padding-bottom': '10px', 'padding-left': '24px' } }],
  },
  golden: { kind: 'html-dir', dir: 'golden' },
}
