import { loadFrozen } from './frozen.ts'
import type { EvalTask } from '../types.ts'

const { snapshot, captureMeta } = loadFrozen('vue-blog-01', import.meta.url)

export const task: EvalTask = {
  id: 'vue-blog-01',
  fixture: 'vue-blog',
  fixtureKind: 'vue',
  category: 'text',
  difficulty: 'easy',
  title: 'Rename the blog heading',
  instruction: '把博客主标题 My Blog 改成 Daily Notes',
  capture: {
    target: 'h1.title',
    comment: '把博客主标题 My Blog 改成 Daily Notes',
  },
  snapshot,
  captureMeta,
  grader: {
    pass: [{ kind: 'dom', selector: 'h1.title', text: 'Daily Notes' }],
  },
  golden: { kind: 'git-patch', patchFile: 'golden.patch' },
}
