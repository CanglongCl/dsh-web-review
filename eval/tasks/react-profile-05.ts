import { loadFrozen } from './frozen.ts'
import type { EvalTask } from '../types.ts'

const { snapshot, captureMeta } = loadFrozen('react-profile-05', import.meta.url)

export const task: EvalTask = {
  id: 'react-profile-05',
  fixture: 'react-profile',
  fixtureKind: 'react',
  category: 'layout',
  difficulty: 'medium',
  title: '纵向排列并居中个人信息',
  instruction: '让个人信息行改为上下排列并居中',
  capture: {
    target: '.info',
    comment: '让个人信息行改为上下排列并居中',
  },
  snapshot,
  captureMeta,
  grader: {
    pass: [{ kind: 'dom', selector: '.info', style: { 'flex-direction': 'column', 'align-items': 'center' } }],
    noRegression: [{ kind: 'dom', selector: '.name', text: '李雷' }],
  },
  golden: { kind: 'git-patch', patchFile: 'golden.patch' },
}
