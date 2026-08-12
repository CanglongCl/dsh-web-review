/** Map the rich picker store into the bounded browser-to-host wire shape. */
import {
  ANNOTATION_LIMITS,
  MAX_ANNOTATION_CHANGES,
  MAX_ANNOTATIONS,
  type AnnotationDraft,
} from '../annotation-contract.ts'
import type { UiSkillName } from '../ui-skills.ts'
import type { PickItem } from './contract.ts'

function bounded(value: string, cap: number): string {
  if (value.length <= cap) return value
  return `${value.slice(0, Math.max(0, cap - 1))}…`
}

/** User-authored intent must fail visibly instead of being silently rewritten. */
function exactIntent(value: string, cap: number, field: string): string {
  if (value.length > cap) throw new RangeError(`${field} exceeds ${String(cap)} characters`)
  return value
}

export function annotationDraft(
  url: string,
  title: string,
  picks: readonly PickItem[],
  selectedSkills: readonly UiSkillName[] = [],
): AnnotationDraft {
  if (picks.length > MAX_ANNOTATIONS) throw new RangeError(`annotations exceed ${String(MAX_ANNOTATIONS)}`)
  return {
    selectedSkills: [...selectedSkills],
    page: {
      url: bounded(url, ANNOTATION_LIMITS.pageUrl),
      title: bounded(title, ANNOTATION_LIMITS.pageTitle),
    },
    comments: picks.map(({ id, comment, snapshot, changes, textChange, viewport }) => ({
      id: bounded(id, ANNOTATION_LIMITS.id),
      comment: exactIntent(comment, ANNOTATION_LIMITS.comment, 'comment'),
      tagName: bounded(snapshot.tagName, ANNOTATION_LIMITS.tagName),
      role: bounded(snapshot.role, ANNOTATION_LIMITS.role),
      label: bounded(snapshot.label, ANNOTATION_LIMITS.label),
      cssPath: bounded(snapshot.cssPath, ANNOTATION_LIMITS.cssPath),
      fullPath: bounded(snapshot.fullPath, ANNOTATION_LIMITS.fullPath),
      stableClasses: snapshot.stableClasses
        .slice(0, ANNOTATION_LIMITS.stableClasses)
        .map(value => bounded(value, ANNOTATION_LIMITS.stableClass)),
      anchor: snapshot.anchor === null ? null : {
        ...snapshot.anchor,
        file: bounded(snapshot.anchor.file, ANNOTATION_LIMITS.anchorFile),
        component: bounded(snapshot.anchor.component, ANNOTATION_LIMITS.anchorComponent),
      },
      changes: (() => {
        if (changes.length > MAX_ANNOTATION_CHANGES) {
          throw new RangeError(`changes exceed ${String(MAX_ANNOTATION_CHANGES)}`)
        }
        return changes.map(change => ({
          property: change.property,
          before: bounded(change.before, ANNOTATION_LIMITS.styleValue),
          after: exactIntent(change.after, ANNOTATION_LIMITS.styleValue, `change.${change.property}`),
        }))
      })(),
      textChange: textChange === null
        ? null
        : {
            before: bounded(textChange.before, ANNOTATION_LIMITS.textValue),
            after: exactIntent(textChange.after, ANNOTATION_LIMITS.textValue, 'textChange.after'),
          },
      viewport,
    })),
  }
}
