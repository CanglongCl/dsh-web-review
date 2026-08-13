import { loadFrozen } from './frozen.ts'
import type { EvalTask } from '../types.ts'

const { snapshot, captureMeta } = loadFrozen('landing-05', import.meta.url)

export const task: EvalTask = {
  id: 'landing-05',
  fixture: 'landing',
  fixtureKind: 'static',
  category: 'layout',
  difficulty: 'hard',
  title: '将首屏内容左对齐',
  instruction: '让首页宣传区的内容改为左对齐',
  capture: {
    target: '.hero',
    comment: '让首页宣传区的内容改为左对齐',
  },
  snapshot,
  captureMeta,
  grader: {
    pass: [{ kind: 'dom', selector: '.hero', style: { 'text-align': 'left' } }],
  },
  golden: { kind: 'html-dir', dir: 'golden' },
}
