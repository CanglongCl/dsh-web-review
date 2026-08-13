/** Stable identities for model executions and grader revisions. */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { LoadedEvalTask, ModelSelectionRecord } from './types.ts'

const GRADER_SOURCE = fileURLToPath(new URL('./grader.ts', import.meta.url))
const EXECUTION_SOURCES = [
  new URL('./arm-context.ts', import.meta.url),
  new URL('./runner/payload.ts', import.meta.url),
  new URL('./runner/run-one.ts', import.meta.url),
  new URL('./runner/runner.ts', import.meta.url),
  new URL('./runner-plugin/src/index.ts', import.meta.url),
]

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 20)
}

export function taskRevision(task: LoadedEvalTask): string {
  return digest(JSON.stringify(task))
}

export function graderRevision(task: LoadedEvalTask): string {
  return digest(`${readFileSync(GRADER_SOURCE, 'utf8')}\n${JSON.stringify(task.grader)}`)
}

export function executionRevision(): string {
  return digest(EXECUTION_SOURCES.map(url => readFileSync(fileURLToPath(url), 'utf8')).join('\n'))
}

export function experimentId(input: {
  task: LoadedEvalTask
  arm: string
  repetition: number
  model: ModelSelectionRecord
  repoCommit: string
  harnessCommit: string
}): string {
  return digest(JSON.stringify({
    taskId: input.task.id,
    taskRevision: taskRevision(input.task),
    arm: input.arm,
    repetition: input.repetition,
    model: input.model,
    repoCommit: input.repoCommit,
    harnessCommit: input.harnessCommit,
    executionRevision: executionRevision(),
  }))
}
