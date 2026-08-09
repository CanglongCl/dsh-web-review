/** Map the rich picker store into the bounded browser-to-host wire shape. */
import { ANNOTATION_LIMITS, type AnnotationDraft } from '../annotation-contract.ts'
import type { PickItem } from './contract.ts'

function bounded(value: string, cap: number): string {
  if (value.length <= cap) return value
  return `${value.slice(0, Math.max(0, cap - 1))}…`
}

export function annotationDraft(
  url: string,
  title: string,
  picks: readonly PickItem[],
): AnnotationDraft {
  return {
    page: {
      url: bounded(url, ANNOTATION_LIMITS.pageUrl),
      title: bounded(title, ANNOTATION_LIMITS.pageTitle),
    },
    comments: picks.map(({ id, comment, snapshot }) => ({
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
    })),
  }
}
