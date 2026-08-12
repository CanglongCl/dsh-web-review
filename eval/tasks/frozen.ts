/**
 * Shared frozen-capture loader for task modules: the snapshot and capture
 * meta are written by eval/capture.ts, never hand-authored.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CaptureMeta, FrozenSnapshot } from '../types.ts'

/** Load one round, accepting the original single-round file names for round one. */
export function loadFrozenRound(taskId: string, round: number, moduleUrl: string): {
  snapshot: FrozenSnapshot | undefined
  captureMeta: CaptureMeta | undefined
} {
  const here = dirname(fileURLToPath(moduleUrl))
  const stem = round === 1 ? taskId : `${taskId}.round-${round}`
  const snapshotPath = join(here, 'frozen', `${stem}.snapshot.json`)
  const metaPath = join(here, 'frozen', `${stem}.meta.json`)
  if (!existsSync(snapshotPath) || !existsSync(metaPath)) {
    // The bank task loads before its first capture; runs and verify mode
    // enforce presence explicitly.
    return { snapshot: undefined, captureMeta: undefined }
  }
  return {
    snapshot: JSON.parse(readFileSync(snapshotPath, 'utf8')) as FrozenSnapshot,
    captureMeta: JSON.parse(readFileSync(metaPath, 'utf8')) as CaptureMeta,
  }
}
