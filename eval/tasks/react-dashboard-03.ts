import { loadFrozen } from './frozen.ts'
import type { EvalTask } from '../types.ts'

const { snapshot, captureMeta } = loadFrozen('react-dashboard-03', import.meta.url)

export const task: EvalTask = {
  id: 'react-dashboard-03',
  fixture: 'react-dashboard',
  fixtureKind: 'react',
  category: 'size',
  difficulty: 'medium',
  title: '将用户头像放大到 48px',
  instruction: '把用户头像的尺寸改成 48px',
  capture: {
    target: '.avatar',
    comment: '把用户头像的尺寸改成 48px',
    adjusts: [{ property: 'width', after: '48px' }],
  },
  snapshot,
  captureMeta,
  grader: {
    pass: [{ kind: 'dom', selector: '.avatar', style: { width: '48px', height: '48px' } }],
    noRegression: [{ kind: 'dom', selector: '.avatar', style: { 'border-radius': '50%' } }],
  },
  golden: { kind: 'git-patch', patchFile: 'golden.patch' },
}
