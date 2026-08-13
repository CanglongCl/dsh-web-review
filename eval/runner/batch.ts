/**
 * Batch runner CLI (`pnpm eval:run`): loads the task bank, filters it, and
 * runs tasks with bounded concurrency, appending one JSON record per run to
 * eval/results/results.jsonl. Existing completed records are skipped unless
 * --force is given, so interrupted batches resume.
 *
 * Flags: --task id (repeatable) --category --difficulty --fixture
 * --concurrency N --provider --model --reasoning --timeout-ms N
 * --force --skip-launch --skip-grading
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { resolveHarnessRoot } from '../../scripts/harness-path.ts'
import { loadTasks } from '../tasks/register.ts'
import { executionRevision, experimentId, graderRevision, taskRevision } from '../identity.ts'
import { runTaskOnce } from './run-one.ts'
import { ARTIFACTS_ROOT, REPO_ROOT, RESULTS_PATH } from './runner.ts'
import type { EvalArm, LoadedEvalTask, RunRecord } from '../types.ts'

interface Flags {
  taskIds: string[]
  category?: string
  difficulty?: string
  fixture?: string
  concurrency: number
  provider: string
  model: string
  reasoningEffort?: string
  timeoutMs: number
  force: boolean
  skipLaunch: boolean
  skipGrading: boolean
  arms: EvalArm[]
  repeat: number
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = {
    taskIds: [],
    concurrency: 4,
    provider: process.env.EVAL_PROVIDER ?? 'deepseek-official',
    model: process.env.EVAL_MODEL ?? 'deepseek-v4-flash',
    reasoningEffort: process.env.EVAL_REASONING ?? 'high',
    timeoutMs: 300_000,
    force: false,
    skipLaunch: false,
    skipGrading: false,
    arms: ['full'],
    repeat: 1,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!
    const next = (): string => {
      const value = argv[index + 1]
      if (value === undefined) throw new Error(`flag ${arg} needs a value`)
      index += 1
      return value
    }
    if (arg === '--') continue
    if (arg === '--task') flags.taskIds.push(next())
    else if (arg === '--category') flags.category = next()
    else if (arg === '--difficulty') flags.difficulty = next()
    else if (arg === '--fixture') flags.fixture = next()
    else if (arg === '--concurrency') flags.concurrency = Number(next())
    else if (arg === '--provider') flags.provider = next()
    else if (arg === '--model') flags.model = next()
    else if (arg === '--reasoning') flags.reasoningEffort = next()
    else if (arg === '--timeout-ms') flags.timeoutMs = Number(next())
    else if (arg === '--force') flags.force = true
    else if (arg === '--skip-launch') flags.skipLaunch = true
    else if (arg === '--skip-grading') flags.skipGrading = true
    else if (arg === '--arm') {
      const value = next()
      flags.arms = value === 'all' ? ['full', 'text-only', 'oracle'] : [value as EvalArm]
    }
    else if (arg === '--repeat') flags.repeat = Number(next())
    else throw new Error(`unknown flag ${arg}`)
  }
  if (flags.arms.some(arm => !['full', 'text-only', 'oracle'].includes(arm))) throw new Error(`invalid --arm ${flags.arms.join(',')}`)
  if (!Number.isInteger(flags.repeat) || flags.repeat < 1) throw new Error('--repeat must be a positive integer')
  return flags
}

function matches(task: LoadedEvalTask, flags: Flags): boolean {
  if (flags.taskIds.length > 0 && !flags.taskIds.includes(task.id)) return false
  if (flags.category !== undefined && task.category !== flags.category) return false
  if (flags.difficulty !== undefined && task.difficulty !== flags.difficulty) return false
  if (flags.fixture !== undefined && task.fixture !== flags.fixture) return false
  return true
}

const RESULTS_FILE = join(RESULTS_PATH, 'results.jsonl')

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2))
  const harnessRoot = resolveHarnessRoot()
  const tasks = await loadTasks()
  const selected = tasks.filter(task => matches(task, flags))
  if (selected.length === 0) {
    console.error('no tasks match the filter')
    process.exit(2)
  }
  if (!flags.skipLaunch) {
    console.log('building the self-contained eval runner bundle')
    execFileSync('pnpm', ['--filter', '@dsh-web-review-dev/eval-runner', 'build'], { cwd: REPO_ROOT, stdio: 'inherit' })
  }
  const currentRepoCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim()
  const currentHarnessCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: harnessRoot, encoding: 'utf8' }).trim()
  const model = { provider: flags.provider, model: flags.model, ...(flags.reasoningEffort === undefined ? {} : { reasoningEffort: flags.reasoningEffort }) }
  const finished = new Set<string>()
  if (!flags.force && existsSync(RESULTS_FILE)) {
    for (const line of readFileSync(RESULTS_FILE, 'utf8').split('\n')) {
      if (line.trim() === '') continue
      const record = JSON.parse(line) as RunRecord
      if (record.experimentId !== undefined && record.executionStatus === 'completed') finished.add(record.experimentId)
    }
  }
  const queue = selected.flatMap(task => flags.arms
    .filter(arm => task.arms.includes(arm))
    .flatMap(arm => Array.from({ length: flags.repeat }, (_, index) => ({ task, arm, repetition: index + 1 }))))
    .filter(run => !finished.has(experimentId({ task: run.task, arm: run.arm, repetition: run.repetition, model, repoCommit: currentRepoCommit, harnessCommit: currentHarnessCommit })))
  console.log(`${selected.length} task(s) selected, ${queue.length} to run, ${flags.concurrency} concurrent`)
  mkdirSync(ARTIFACTS_ROOT, { recursive: true })
  mkdirSync(RESULTS_PATH, { recursive: true })

  let cursor = 0
  const failures: string[] = []
  const workers = Array.from({ length: Math.max(1, flags.concurrency) }, async () => {
    while (true) {
      const index = cursor
      cursor += 1
      const queued = queue[index]
      if (queued === undefined) return
      const { task, arm, repetition } = queued
      const started = Date.now()
      console.log(`[run] ${task.id}/${arm}/r${repetition} start (${task.fixtureKind}/${task.category}/${task.difficulty})`)
      try {
        const record = await runTaskOnce(task, {
          harnessRoot,
          provider: flags.provider,
          model: flags.model,
          ...(flags.reasoningEffort === undefined ? {} : { reasoningEffort: flags.reasoningEffort }),
          timeoutMs: flags.timeoutMs,
          skipLaunch: flags.skipLaunch,
          skipGrading: flags.skipGrading,
          arm,
          repetition,
        })
        appendFileSync(RESULTS_FILE, `${JSON.stringify(record)}\n`)
        const tokens = record.process?.tokens
        console.log(
          `[run] ${task.id}/${arm}/r${repetition} ${record.status}`,
          tokens === undefined
            ? ''
            : `(in ${tokens.input} / out ${tokens.output} / reasoning ${tokens.reasoning}, ${record.process?.steps ?? 0} steps, ${Math.round((Date.now() - started) / 1000)}s)`,
        )
        if (record.status !== 'pass') failures.push(task.id)
      } catch (error) {
        const record: RunRecord = {
          experimentId: experimentId({ task, arm, repetition, model, repoCommit: currentRepoCommit, harnessCommit: currentHarnessCommit }),
          taskRevision: taskRevision(task),
          executionRevision: executionRevision(),
          graderRevision: graderRevision(task),
          gradedAt: new Date().toISOString(),
          executionStatus: 'error',
          originalStatus: 'error',
          taskId: task.id,
          fixture: task.fixture,
          fixtureKind: task.fixtureKind,
          category: task.category,
          difficulty: task.difficulty,
          title: task.title,
          arm,
          repetition,
          status: 'error',
          attribution: 'runtime-error',
          model,
          durationMs: Date.now() - started,
          startedAt: new Date().toISOString(),
          exitCode: null,
          modifiedFiles: [],
          runDir: '',
          repoCommit: 'unknown',
          harnessCommit: 'unknown',
        }
        appendFileSync(RESULTS_FILE, `${JSON.stringify(record)}\n`)
        console.error(`[run] ${task.id} orchestration error: ${String(error)}`)
        failures.push(task.id)
      }
    }
  })
  await Promise.all(workers)
  console.log(`batch done; ${failures.length} non-passing: ${failures.join(', ') || 'none'}`)
  if (!flags.skipLaunch && !flags.skipGrading) {
    writeFileSync(join(RESULTS_PATH, 'run-summary.json'), JSON.stringify({
      model: { provider: flags.provider, model: flags.model, ...(flags.reasoningEffort === undefined ? {} : { reasoningEffort: flags.reasoningEffort }) },
      ranAt: new Date().toISOString(),
      taskCount: queue.length,
    }, null, 2))
  }
}

void main()
