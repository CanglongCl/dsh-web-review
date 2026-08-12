/** Fixed UI optimization Skill catalog bundled by this plugin. */
export const UI_SKILLS = [
  {
    name: 'better-ui',
    description: 'Design engineering principles for polished interfaces, including components, motion, hover states, shadows, borders, icons, and micro-interactions.',
  },
  {
    name: 'better-typography',
    description: 'Web typography guidance for fonts, type scales, hierarchy, wrapping, spacing, OpenType features, and accessible text rendering.',
  },
  {
    name: 'better-layout',
    description: 'Layout structure for web interfaces, including grouping, alignment, reading order, progressive disclosure, responsive behavior, and RTL.',
  },
  {
    name: 'better-writing',
    description: 'UX writing guidance for interface copy, button labels, errors, empty states, placeholders, notifications, voice, and tone.',
  },
  {
    name: 'better-accessibility',
    description: 'Accessibility engineering for focus, keyboard support, semantics, ARIA, forms, screen readers, hit areas, motion, and zoom.',
  },
  {
    name: 'better-colors',
    description: 'Color-system guidance for OKLCH, palettes, contrast, gamut boundaries, semantic tokens, and light and dark appearances.',
  },
  {
    name: 'better-interface',
    description: 'Cross-discipline interface review coordinating accessibility, layout, writing, typography, color, and visual-polish guidance.',
  },
  {
    name: 'interface-review',
    description: 'Change-scoped interface review for uncommitted work, branches, and pull requests, with affected-surface and regression classification.',
  },
] as const

/** Name accepted by the wire, Cordis config, UI, and bundled provider. */
export type UiSkillName = typeof UI_SKILLS[number]['name']

/** Stable ordered name list used by config defaults and validation. */
export const UI_SKILL_NAMES: readonly UiSkillName[] = UI_SKILLS.map(skill => skill.name)

/** Default model-visible catalog requested for the Cordis configuration. */
export const DEFAULT_AUTO_LOAD_SKILLS: readonly UiSkillName[] = [
  'better-ui',
  'better-typography',
  'better-layout',
  'better-writing',
]

const UI_SKILL_NAME_SET = new Set<string>(UI_SKILL_NAMES)

/** Return whether an untrusted value names one bundled UI optimization Skill. */
export function isUiSkillName(value: unknown): value is UiSkillName {
  return typeof value === 'string' && UI_SKILL_NAME_SET.has(value)
}

