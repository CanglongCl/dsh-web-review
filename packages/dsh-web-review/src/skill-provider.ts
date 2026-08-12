/** Bundled UI optimization Skill provider and Cordis configuration. */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Context } from 'cordis'
import {
  BUNDLED_SKILL_RANK,
  type SkillCandidate,
  type SkillDefinition,
  type SkillProvider,
} from '@deepseek-ai/dsh-skill'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import {
  DEFAULT_AUTO_LOAD_SKILLS,
  UI_SKILLS,
  type UiSkillName,
} from './ui-skills.ts'

const PROVIDER_NAME = 'dsh-web-review-ui'
const UPSTREAM_COMMIT = 'd01493b0a7b976a74bfcedc80c783d60c7995910'

/** Deployment-controlled model visibility for the bundled UI optimization Skills. */
export interface Config {
  /** Skills advertised to the model-facing catalog; every bundled Skill remains user-invocable. */
  autoLoadSkills: UiSkillName[]
}

const uiSkillName = z.union([
  z.const('better-ui'),
  z.const('better-typography'),
  z.const('better-layout'),
  z.const('better-writing'),
  z.const('better-accessibility'),
  z.const('better-colors'),
  z.const('better-interface'),
  z.const('interface-review'),
])

/** Runtime Cordis validator for this plugin's deployment configuration. */
export const Config: Schema<Config> = z.object({
  autoLoadSkills: z.array(uiSkillName)
    .default([...DEFAULT_AUTO_LOAD_SKILLS]),
})

function skillDirectory(name: UiSkillName): URL {
  return new URL(`../skills/${name}/`, import.meta.url)
}

function skillFile(name: UiSkillName): URL {
  return new URL('SKILL.md', skillDirectory(name))
}

/** Strip the trusted upstream YAML frontmatter; DSH owns provider metadata. */
export function skillBody(source: string): string {
  const normalized = source.replaceAll('\r\n', '\n')
  if (!normalized.startsWith('---\n')) throw new Error('bundled Skill is missing YAML frontmatter')
  const end = normalized.indexOf('\n---\n', 4)
  if (end < 0) throw new Error('bundled Skill has unterminated YAML frontmatter')
  return normalized.slice(end + 5).replace(/^\n/u, '')
}

/** Register the packaged provider for the lifetime of this plugin fiber. */
export function registerUiSkillProvider(ctx: Context, config: Config): void {
  if (new Set(config.autoLoadSkills).size !== config.autoLoadSkills.length) {
    throw new Error('autoLoadSkills must not contain duplicate names')
  }
  const modelVisible = new Set<UiSkillName>(config.autoLoadSkills)
  const candidates: readonly SkillCandidate[] = UI_SKILLS.map(skill => ({
    name: skill.name,
    description: skill.description,
    invocation: {
      modelInvocable: modelVisible.has(skill.name),
      userInvocable: true,
    },
    provider: PROVIDER_NAME,
    source: 'bundled',
    resourceBase: { kind: 'directory', path: fileURLToPath(skillDirectory(skill.name)) },
    rank: BUNDLED_SKILL_RANK,
    locator: skill.name,
    metadata: { upstreamCommit: UPSTREAM_COMMIT },
  }))
  const byName = new Map(candidates.map(candidate => [candidate.name, candidate]))
  const provider: SkillProvider = {
    name: PROVIDER_NAME,
    list: () => Promise.resolve(candidates),
    async get(candidate): Promise<SkillDefinition | undefined> {
      const owned = byName.get(candidate.name)
      if (owned !== candidate) return undefined
      const name = candidate.name as UiSkillName
      return {
        name,
        description: candidate.description,
        invocation: candidate.invocation,
        provider: PROVIDER_NAME,
        source: 'bundled',
        resourceBase: { kind: 'directory', path: fileURLToPath(skillDirectory(name)) },
        content: skillBody(await readFile(skillFile(name), 'utf8')),
        ...(candidate.metadata === undefined ? {} : { metadata: candidate.metadata }),
      }
    },
  }
  ctx.skills.registerProvider(() => provider)
}
