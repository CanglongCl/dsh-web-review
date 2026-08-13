/**
 * Task bank registry: scans eval/tasks/*.ts and imports every module that
 * exports `task: EvalTask`. The bank is the source of truth for eval:run,
 * eval:smoke, and eval:capture.
 */
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import type { EvalTask, LoadedEvalTask } from '../types.ts'

const TASKS_DIR = dirname(fileURLToPath(import.meta.url))

/** Load every committed task module, sorted by id. */
function normalizeTask(task: EvalTask): LoadedEvalTask {
  if (task.rounds !== undefined) {
    if (task.arms === undefined || task.arms.length === 0) throw new Error(`eval task ${task.id} has rounds but no arms`)
    return { ...task, category: task.category as LoadedEvalTask['category'], arms: task.arms, rounds: task.rounds }
  }
  if (task.capture === undefined) throw new Error(`legacy eval task ${task.id} has no capture`)
  return {
    ...task,
    category: 'protocol-smoke',
    arms: ['full'],
    rounds: [{
      prompt: '请根据页面批注修改前端实现。',
      capture: [task.capture],
      snapshot: task.snapshot,
      captureMeta: task.captureMeta,
    }],
  }
}

export async function loadTasks(options: { tolerant?: boolean } = {}): Promise<LoadedEvalTask[]> {
  const files = readdirSync(TASKS_DIR)
    .filter(name => name.endsWith('.ts') && name !== 'register.ts' && name !== 'frozen.ts')
    .sort()
  const tasks: LoadedEvalTask[] = []
  for (const file of files) {
    try {
      const module = await import(pathToFileURL(join(TASKS_DIR, file)).href) as { task?: EvalTask }
      if (module.task === undefined) {
        throw new Error(`eval task module ${file} does not export "task"`)
      }
      tasks.push(normalizeTask(module.task))
    } catch (error) {
      // Tolerant mode tolerates in-flight modules authored concurrently by
      // workflow agents (frozen captures may not exist yet).
      if (options.tolerant !== true) throw error
      console.warn(`[register] skipping in-flight task module ${file}: ${String(error)}`)
    }
  }
  tasks.sort((a, b) => a.id.localeCompare(b.id))
  return tasks
}

/** Load one task by id (throws when absent). */
export async function loadTask(id: string): Promise<LoadedEvalTask> {
  const tasks = await loadTasks()
  const task = tasks.find(candidate => candidate.id === id)
  if (task === undefined) throw new Error(`unknown eval task "${id}"`)
  return task
}
