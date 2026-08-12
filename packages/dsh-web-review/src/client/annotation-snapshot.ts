/** Map the rich picker store into the bounded browser-to-host wire shape. */
import { ANNOTATION_LIMITS, MAX_ANNOTATION_CHANGES, type AnnotationDraft } from '../annotation-contract.ts'
import type { UiSkillName } from '../ui-skills.ts'
import type { PickItem } from './contract.ts'

function bounded(value: string, cap: number): string {
  if (value.length <= cap) return value
  return `${value.slice(0, Math.max(0, cap - 1))}…`
}

export function annotationDraft(
  url: string,
  title: string,
  picks: readonly PickItem[],
  selectedSkills: readonly UiSkillName[] = [],
): AnnotationDraft {
  return {
    selectedSkills: [...selectedSkills],
    page: {
      url: bounded(url, ANNOTATION_LIMITS.pageUrl),
      title: bounded(title, ANNOTATION_LIMITS.pageTitle),
    },
    comments: picks.map(({
      id, comment, snapshot, changes = [], textChange = null,
      viewport = { width: 0, height: 0 },
    }) => ({
      id: bounded(id, ANNOTATION_LIMITS.id),
      comment: bounded(comment, ANNOTATION_LIMITS.comment),
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
      changes: changes
        .slice(0, MAX_ANNOTATION_CHANGES)
        .map(change => ({
          property: change.property,
          before: bounded(change.before, ANNOTATION_LIMITS.styleValue),
          after: bounded(change.after, ANNOTATION_LIMITS.styleValue),
        })),
      textChange: textChange === null
        ? null
        : {
            before: bounded(textChange.before, ANNOTATION_LIMITS.textValue),
            after: bounded(textChange.after, ANNOTATION_LIMITS.textValue),
          },
      viewport,
    })),
  }
}
