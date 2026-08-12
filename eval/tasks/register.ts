/**
 * Task bank registry: scans eval/tasks/*.ts and imports every module that
 * exports `task: EvalTask`. The bank is the source of truth for eval:run,
 * eval:smoke, and eval:capture.
 */
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import type { EvalTask } from '../types.ts'

const TASKS_DIR = dirname(fileURLToPath(import.meta.url))

/** Load every committed task module, sorted by id. */
export async function loadTasks(): Promise<EvalTask[]> {
  const files = readdirSync(TASKS_DIR)
    .filter(name => name.endsWith('.ts') && name !== 'register.ts' && name !== 'frozen.ts')
    .sort()
  const tasks: EvalTask[] = []
  for (const file of files) {
    const module = await import(pathToFileURL(join(TASKS_DIR, file)).href) as { task?: EvalTask }
    if (module.task === undefined) {
      throw new Error(`eval task module ${file} does not export "task"`)
    }
    tasks.push(module.task)
  }
  tasks.sort((a, b) => a.id.localeCompare(b.id))
  return tasks
}

/** Load one task by id (throws when absent). */
export async function loadTask(id: string): Promise<EvalTask> {
  const tasks = await loadTasks()
  const task = tasks.find(candidate => candidate.id === id)
  if (task === undefined) throw new Error(`unknown eval task "${id}"`)
  return task
}
