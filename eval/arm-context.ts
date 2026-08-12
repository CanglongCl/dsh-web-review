/** Arm-specific model context derived from a production-validated snapshot. */
import type { EvalArm } from './types.ts'

interface ValidatedSnapshot {
  comments: {
    comment: string
    changes: { property: string; before: string; after: string }[]
    textChange: { before: string; after: string } | null
  }[]
}

export interface ArmContextText {
  plugin: string
  text: string
}

/** Render user intent while deliberately excluding every localization field. */
export function formatTextOnlyContext(snapshot: ValidatedSnapshot): string {
  const lines = [
    '# Browser comments (text-only eval arm)',
    '',
    'Apply the following user-authored comments and requested values.',
    'Target selectors, paths, labels, source anchors, page evidence, viewports, and original values are intentionally unavailable.',
  ]
  snapshot.comments.forEach((comment, index) => {
    lines.push('', `## User Comment ${index + 1}`)
    const text = comment.comment.trim()
    if (text !== '') lines.push('', 'Comment (user-authored):', ...text.split(/\r\n?|\n|\u2028|\u2029/u).map(line => `> ${line}`))
    if (comment.changes.length > 0 || comment.textChange !== null) {
      lines.push('', 'Requested changes (user-authored):')
      for (const change of comment.changes) lines.push(`- ${change.property}: ${change.after}`)
      if (comment.textChange !== null) lines.push(`- text: ${JSON.stringify(comment.textChange.after)}`)
    }
  })
  return lines.join('\n')
}

/** Produce the logged plugin context messages for one diagnostic arm. */
export function armContextTexts(arm: EvalArm, snapshot: ValidatedSnapshot, productionContext: string, oracleContext?: string): ArmContextText[] {
  const primary = arm === 'text-only'
    ? { plugin: 'dsh-web-review-eval-text-only', text: formatTextOnlyContext(snapshot) }
    : { plugin: 'dsh-web-review', text: productionContext }
  if (arm !== 'oracle') return [primary]
  if (oracleContext === undefined || oracleContext.trim() === '') throw new Error('oracle arm needs source hints')
  return [primary, {
    plugin: 'dsh-web-review-eval-oracle',
    text: ['# Eval oracle source hints', '', 'Use these localization hints as supporting evidence. They do not prescribe the implementation.', '', oracleContext].join('\n'),
  }]
}
