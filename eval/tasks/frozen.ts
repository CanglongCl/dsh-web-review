/**
 * Shared frozen-capture loader for task modules: the snapshot and capture
 * meta are written by eval/capture.ts, never hand-authored.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CaptureMeta, EvalTask } from '../types.ts'

export function loadFrozen(taskId: string, moduleUrl: string): { snapshot: EvalTask['snapshot']; captureMeta: EvalTask['captureMeta'] } {
  const here = dirname(fileURLToPath(moduleUrl))
  const snapshotPath = join(here, 'frozen', `${taskId}.snapshot.json`)
  const metaPath = join(here, 'frozen', `${taskId}.meta.json`)
  if (!existsSync(snapshotPath) || !existsSync(metaPath)) {
    // The bank task loads before its first capture; runs and verify mode
    // enforce presence explicitly.
    return { snapshot: undefined, captureMeta: undefined }
  }
  return {
    snapshot: JSON.parse(readFileSync(snapshotPath, 'utf8')) as EvalTask['snapshot'],
    captureMeta: JSON.parse(readFileSync(metaPath, 'utf8')) as CaptureMeta,
  }
}
