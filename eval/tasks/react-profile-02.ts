import { loadFrozen } from './frozen.ts'
import type { EvalTask } from '../types.ts'

const { snapshot, captureMeta } = loadFrozen('react-profile-02', import.meta.url)

export const task: EvalTask = {
  id: 'react-profile-02',
  fixture: 'react-profile',
  fixtureKind: 'react',
  category: 'typography',
  difficulty: 'medium',
  title: '放大姓名字号',
  instruction: '把名字的字号加大到 24px',
  capture: {
    target: '.name',
    comment: '把名字的字号加大到 24px',
    adjusts: [{ property: 'font-size', after: '24px' }],
  },
  snapshot,
  captureMeta,
  grader: {
    pass: [{ kind: 'dom', selector: '.name', style: { 'font-size': '24px' } }],
    noRegression: [{ kind: 'dom', selector: '.bio', style: { 'font-size': '14px' } }],
  },
  golden: { kind: 'git-patch', patchFile: 'golden.patch' },
}
