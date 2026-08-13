import { loadFrozenRound } from './frozen.ts'
import type { EvalTask } from '../types.ts'

const frozen = loadFrozenRound('vue-blog-01', 1, import.meta.url)

export const task: EvalTask = {
  id: 'vue-blog-01',
  fixture: 'vue-blog',
  fixtureKind: 'vue',
  category: 'protocol-smoke',
  difficulty: 'easy',
  title: 'Rename the blog heading',
  arms: ['full'],
  rounds: [{
    prompt: '请根据页面批注修改前端实现。',
    capture: [{
      target: 'h1.title',
      comment: '把博客主标题 My Blog 改成 Daily Notes',
    }],
    ...frozen,
  }],
  grader: {
    pass: [{ kind: 'dom', selector: 'h1.title', text: 'Daily Notes' }],
  },
  golden: { kind: 'git-patch', patchFile: 'golden.patch' },
}
