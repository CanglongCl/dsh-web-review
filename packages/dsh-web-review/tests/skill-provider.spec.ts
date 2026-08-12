import { Context } from 'cordis'
import SkillService from '@deepseek-ai/dsh-skill'
import { describe, expect, it } from 'vitest'
import { registerUiSkillProvider, skillBody } from '../src/skill-provider.ts'
import { DEFAULT_AUTO_LOAD_SKILLS, UI_SKILL_NAMES } from '../src/ui-skills.ts'

describe('bundled UI optimization Skill provider', () => {
  it('publishes all eight as user-invocable and only the Cordis selection as model-visible', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillService)
    registerUiSkillProvider(ctx, { autoLoadSkills: [...DEFAULT_AUTO_LOAD_SKILLS] })

    const candidates = await ctx.skills.list()
    expect(candidates.map(candidate => candidate.name)).toEqual([...UI_SKILL_NAMES].sort())
    expect(candidates.every(candidate => candidate.invocation.userInvocable)).toBe(true)
    expect(candidates.filter(candidate => candidate.invocation.modelInvocable).map(candidate => candidate.name))
      .toEqual([...DEFAULT_AUTO_LOAD_SKILLS].sort())

    const writing = await ctx.skills.get('better-writing')
    expect(writing?.content).toContain('# Writing that disappears into the interface')
    expect(writing?.content).not.toMatch(/^---$/mu)
    expect(writing?.resourceBase).toMatchObject({ kind: 'directory' })
    await ctx.fiber.dispose()
  })

  it('honors a dynamically supplied selection and rejects duplicates', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillService)
    registerUiSkillProvider(ctx, { autoLoadSkills: ['better-colors'] })
    expect((await ctx.skills.list()).filter(candidate => candidate.invocation.modelInvocable).map(candidate => candidate.name))
      .toEqual(['better-colors'])
    expect(() => registerUiSkillProvider(ctx, { autoLoadSkills: ['better-ui', 'better-ui'] }))
      .toThrow('must not contain duplicate names')
    await ctx.fiber.dispose()
  })

  it('requires valid bundled frontmatter before exposing a body', () => {
    expect(skillBody('---\nname: x\n---\n\n# Body')).toBe('# Body')
    expect(() => skillBody('# Body')).toThrow('missing YAML frontmatter')
    expect(() => skillBody('---\nname: x')).toThrow('unterminated YAML frontmatter')
  })
})
