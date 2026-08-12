/**
 * Bank integrity gate (`pnpm eval:smoke`, LLM-free):
 * - grader checks: baseline must fail, golden must pass, for every task;
 * - capture drift checks (with --capture): re-capture through the real GUI
 *   and diff the live snapshot against the frozen one.
 * Nonzero exit on any violation.
 */
import { spawnSync } from 'node:child_process'
import { verifyTaskGrader } from './runner/run-one.ts'
import { loadTasks } from './tasks/register.ts'

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const withCapture = argv.includes('--capture')
  const taskIds = argv.filter(arg => arg !== '--' && !arg.startsWith('--'))
  const tasks = (await loadTasks()).filter(task => taskIds.length === 0 || taskIds.includes(task.id))
  console.log(`smoke: ${tasks.length} task(s)${withCapture ? ' with capture verification' : ' (grader checks only)'}`)
  let failures = 0
  for (const task of tasks) {
    const outcome = await verifyTaskGrader(task)
    for (const detail of outcome.details) console.log(`  [${task.id}] ${detail}`)
    if (!outcome.ok) failures += 1
  }
  if (withCapture) {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'eval/capture/capture.ts', '--verify', ...taskIds],
      { cwd: process.cwd(), stdio: 'inherit' },
    )
    if (result.status !== 0) failures += 1
  }
  if (failures > 0) {
    console.error(`smoke FAILED: ${failures} violation(s)`)
    process.exit(1)
  }
  console.log('smoke passed: every task baseline-fails, golden-passes, and (when requested) captures drift-free')
}

void main()
