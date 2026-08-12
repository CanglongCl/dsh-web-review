import type { EvalArm, EvalTask } from '../types.ts'

export interface RunnerTaskPayload {
  taskId: string
  arm: EvalArm
  rounds: {
    prompt: string
    snapshot: unknown
    oracleContext?: string
  }[]
}

/** Preserve scenario round order while selecting one diagnostic arm. */
export function runnerTaskPayload(task: EvalTask, arm: EvalArm): RunnerTaskPayload {
  if (!task.arms.includes(arm)) throw new Error(`task ${task.id} does not declare arm ${arm}`)
  return {
    taskId: task.id,
    arm,
    rounds: task.rounds.map(round => ({
      prompt: round.prompt,
      snapshot: round.snapshot,
      ...(round.oracleContext === undefined ? {} : { oracleContext: round.oracleContext }),
    })),
  }
}
