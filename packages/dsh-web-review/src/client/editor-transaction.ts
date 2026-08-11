/** Lifecycle operations for one host editor's reversible DOM transaction. */
import type { AnnotationStyleChange, AnnotationTextChange } from '../annotation-contract.ts'
import { applyCommitted, restoreAll, type LiveElementPatch } from './live-patch.ts'
import { sameElement } from './element-navigation.ts'

export interface CommittedPatchBaseline {
  patch: LiveElementPatch
  changes: readonly AnnotationStyleChange[]
  textChange: AnnotationTextChange | null
}

export interface EditorPatchTransaction {
  current: LiveElementPatch
  committed: CommittedPatchBaseline | null
}

/** Cancel editor-only previews while keeping the pick's committed DOM echo. */
export function rollbackEditorTransaction(transaction: EditorPatchTransaction): void {
  restoreAll(transaction.current)
  const committed = transaction.committed
  if (committed !== null && sameElement(committed.patch.element, transaction.current.element)) {
    applyCommitted(committed.patch, committed.changes, committed.textChange)
  }
}

/** Remove both editor previews and the pick's committed DOM echo. */
export function discardEditorTransaction(transaction: EditorPatchTransaction): void {
  restoreAll(transaction.current)
  const committed = transaction.committed
  if (committed !== null && committed.patch !== transaction.current) restoreAll(committed.patch)
}
