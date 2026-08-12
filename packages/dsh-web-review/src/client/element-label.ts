import type { ElementSnapshot } from './contract.ts'

/** Compact fallback identity for an element without an accessible label. */
export function elementLabel(snapshot: ElementSnapshot): string {
  const id = snapshot.id === '' ? '' : `#${snapshot.id}`
  const classes = snapshot.className === ''
    ? ''
    : `.${snapshot.className.trim().split(/\s+/u).filter(Boolean).join('.')}`
  return `${snapshot.tagName}${id}${classes}`
}
