import { loadFrozen } from './frozen.ts'
import type { EvalTask } from '../types.ts'

const { snapshot, captureMeta } = loadFrozen('landing-10', import.meta.url)

export const task: EvalTask = {
  id: 'landing-10',
  fixture: 'landing',
  fixtureKind: 'static',
  category: 'batch',
  difficulty: 'hard',
  title: '减小卡片圆角',
  instruction: '把所有卡片的圆角从 12px 改成 8px',
  capture: {
    target: '.card',
    comment: '把所有卡片的圆角从 12px 改成 8px',
  },
  snapshot,
  captureMeta,
  grader: {
    pass: [{ kind: 'dom', selector: '.card', all: true, style: { 'border-radius': '8px' } }],
  },
  golden: { kind: 'html-dir', dir: 'golden' },
}
