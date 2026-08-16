import type { EvalArm, LoadedEvalTask } from '../types.ts'

export interface RunnerTaskPayload {
  taskId: string
  arm: EvalArm
  rounds: {
    prompt: string
    snapshot: unknown
    oracleContext?: string
    /** Staged snapshot archive directory (snapshot arm only). */
    snapshotDir?: string
  }[]
}

/** Preserve scenario round order while selecting one diagnostic arm. */
export function runnerTaskPayload(
  task: LoadedEvalTask,
  arm: EvalArm,
  snapshotDirs: readonly string[] = [],
): RunnerTaskPayload {
  if (arm === 'snapshot') {
    if (task.rounds.some(round => round.snapshot === undefined)) {
      throw new Error('task ' + task.id + ': snapshot arm needs frozen snapshots; run pnpm eval:capture first')
    }
    if (snapshotDirs.length !== task.rounds.length) {
      throw new Error('task ' + task.id + ': snapshot arm needs one staged archive per round')
    }
  } else if (!task.arms.includes(arm)) {
    throw new Error('task ' + task.id + ' does not declare arm ' + arm)
  }
  return {
    taskId: task.id,
    arm,
    rounds: task.rounds.map((round, index) => ({
      prompt: round.prompt,
      snapshot: round.snapshot,
      ...(round.oracleContext === undefined ? {} : { oracleContext: round.oracleContext }),
      ...(arm === 'snapshot' ? { snapshotDir: snapshotDirs[index] } : {}),
    })),
  }
}
