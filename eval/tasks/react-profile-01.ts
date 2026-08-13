import { loadFrozen } from './frozen.ts'
import type { EvalTask } from '../types.ts'

const { snapshot, captureMeta } = loadFrozen('react-profile-01', import.meta.url)

export const task: EvalTask = {
  id: 'react-profile-01',
  fixture: 'react-profile',
  fixtureKind: 'react',
  category: 'text',
  difficulty: 'easy',
  title: 'Update the bio text',
  instruction: '把简介文案改成“热爱前端工程与界面设计”',
  capture: {
    target: '.bio',
    comment: '把简介文案改成“热爱前端工程与界面设计”',
  },
  snapshot,
  captureMeta,
  grader: {
    pass: [{ kind: 'dom', selector: '.bio', text: '热爱前端工程与界面设计' }],
    noRegression: [{ kind: 'dom', selector: '.name', text: '李雷' }],
  },
  golden: { kind: 'git-patch', patchFile: 'golden.patch' },
}
