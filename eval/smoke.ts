/**
 * Bank integrity gate (`pnpm eval:smoke`, LLM-free):
 * - grader checks: baseline must fail, golden must pass, for every task;
 * - capture drift checks (with --capture): re-capture through the real GUI
 *   and diff the live snapshot against the frozen one.
 * Nonzero exit on any violation.
 */
import { spawnSync } from 'node:child_process'
import { verifyTaskGrader } from './runner/run-one.ts'
import { baselineDir, hashDir } from './runner/runner.ts'
import { loadTasks } from './tasks/register.ts'
import type { LoadedEvalTask } from './types.ts'

type ParseAnnotationBody = (body: string) => { comments: { comment: string }[]; selectedSkills: string[] } | undefined

function verifyFrozenRounds(task: LoadedEvalTask, parseAnnotationBody: ParseAnnotationBody): string[] {
  const issues: string[] = []
  const fixtureRevision = hashDir(baselineDir(task.fixture))
  task.rounds.forEach((round, index) => {
    const label = `round ${index + 1}`
    if (round.snapshot === undefined || round.captureMeta === undefined) {
      issues.push(`${label}: missing real frozen snapshot or capture metadata`)
      return
    }
    const parsed = parseAnnotationBody(JSON.stringify(round.snapshot))
    if (parsed === undefined) {
      issues.push(`${label}: snapshot rejected by production parseAnnotationBody`)
      return
    }
    if (round.captureMeta.fixtureRevision !== fixtureRevision) issues.push(`${label}: fixture revision drifted`)
    if (parsed.comments.length !== round.capture.length) issues.push(`${label}: capture/comment count differs`)
    round.capture.forEach((capture, captureIndex) => {
      if (parsed.comments[captureIndex]?.comment !== capture.comment) issues.push(`${label}: comment ${captureIndex + 1} differs from capture spec`)
    })
    const expectedSkills = [...new Set(round.capture.flatMap(capture => capture.selectedSkills ?? []))]
    if (expectedSkills.join('\0') !== parsed.selectedSkills.join('\0')) issues.push(`${label}: selected skills differ from capture spec`)
  })
  return issues
}

async function main(): Promise<void> {
  // Runtime loading preserves the scripts TypeScript project boundary while
  // still executing the production node-owned validator in this gate.
  const annotationContextUrl = new URL('../packages/dsh-web-review/src/annotation-context.ts', import.meta.url).href
  const annotationContext = await import(annotationContextUrl) as { parseAnnotationBody: ParseAnnotationBody }
  const argv = process.argv.slice(2)
  const withCapture = argv.includes('--capture')
  const taskIds = argv.filter(arg => arg !== '--' && !arg.startsWith('--'))
  const tasks = (await loadTasks({ tolerant: true })).filter(task => taskIds.length === 0 || taskIds.includes(task.id))
  console.log(`smoke: ${tasks.length} task(s)${withCapture ? ' with capture verification' : ' (grader checks only)'}`)
  let failures = 0
  for (const task of tasks) {
    const frozenIssues = verifyFrozenRounds(task, annotationContext.parseAnnotationBody)
    for (const issue of frozenIssues) console.error(`  [${task.id}] ${issue}`)
    if (frozenIssues.length > 0) failures += 1
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
