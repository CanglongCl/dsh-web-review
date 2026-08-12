import { loadFrozen } from './frozen.ts'
import type { EvalTask } from '../types.ts'

const { snapshot, captureMeta } = loadFrozen('react-profile-04', import.meta.url)

export const task: EvalTask = {
  id: 'react-profile-04',
  fixture: 'react-profile',
  fixtureKind: 'react',
  category: 'accessibility',
  difficulty: 'medium',
  title: 'Add accessible name to the avatar',
  instruction: '给头像补充可访问名称“用户头像”',
  capture: {
    target: '.avatar',
    comment: '给头像补充可访问名称“用户头像”',
  },
  snapshot,
  captureMeta,
  grader: {
    pass: [{ kind: 'dom', selector: '.avatar', accessibleName: '用户头像' }],
    noRegression: [{ kind: 'dom', selector: '.name', text: '李雷' }],
  },
  golden: { kind: 'git-patch', patchFile: 'golden.patch' },
}
