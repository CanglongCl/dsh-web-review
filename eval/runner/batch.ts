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
import { join } from 'node:path'
import { resolveHarnessRoot } from '../../scripts/harness-path.ts'
import { loadTasks } from '../tasks/register.ts'
import { runTaskOnce } from './run-one.ts'
import { ARTIFACTS_ROOT, RESULTS_PATH } from './runner.ts'
import type { EvalTask, RunRecord } from '../types.ts'

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
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = {
    taskIds: [],
    concurrency: 4,
    provider: process.env.EVAL_PROVIDER ?? 'deepseek',
    model: process.env.EVAL_MODEL ?? 'deepseek-v4-flash',
    ...(process.env.EVAL_REASONING === undefined ? {} : { reasoningEffort: process.env.EVAL_REASONING }),
    timeoutMs: 300_000,
    force: false,
    skipLaunch: false,
    skipGrading: false,
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
    else throw new Error(`unknown flag ${arg}`)
  }
  return flags
}

function matches(task: EvalTask, flags: Flags): boolean {
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
  const finished = new Set<string>()
  if (!flags.force && existsSync(RESULTS_FILE)) {
    for (const line of readFileSync(RESULTS_FILE, 'utf8').split('\n')) {
      if (line.trim() === '') continue
      const record = JSON.parse(line) as RunRecord
      finished.add(record.taskId)
    }
  }
  const queue = selected.filter(task => !finished.has(task.id))
  console.log(`${selected.length} task(s) selected, ${queue.length} to run, ${flags.concurrency} concurrent`)
  mkdirSync(ARTIFACTS_ROOT, { recursive: true })
  mkdirSync(RESULTS_PATH, { recursive: true })

  let cursor = 0
  const failures: string[] = []
  const workers = Array.from({ length: Math.max(1, flags.concurrency) }, async () => {
    while (true) {
      const index = cursor
      cursor += 1
      const task = queue[index]
      if (task === undefined) return
      const started = Date.now()
      console.log(`[run] ${task.id} start (${task.fixtureKind}/${task.category}/${task.difficulty})`)
      try {
        const record = await runTaskOnce(task, {
          harnessRoot,
          provider: flags.provider,
          model: flags.model,
          ...(flags.reasoningEffort === undefined ? {} : { reasoningEffort: flags.reasoningEffort }),
          timeoutMs: flags.timeoutMs,
          skipLaunch: flags.skipLaunch,
          skipGrading: flags.skipGrading,
        })
        appendFileSync(RESULTS_FILE, `${JSON.stringify(record)}\n`)
        const tokens = record.process?.tokens
        console.log(
          `[run] ${task.id} ${record.status}`,
          tokens === undefined
            ? ''
            : `(in ${tokens.input} / out ${tokens.output} / reasoning ${tokens.reasoning}, ${record.process?.steps ?? 0} steps, ${Math.round((Date.now() - started) / 1000)}s)`,
        )
        if (record.status !== 'pass') failures.push(task.id)
      } catch (error) {
        const record: RunRecord = {
          taskId: task.id,
          fixture: task.fixture,
          fixtureKind: task.fixtureKind,
          category: task.category,
          difficulty: task.difficulty,
          title: task.title,
          status: 'error',
          attribution: 'runtime-error',
          model: { provider: flags.provider, model: flags.model, ...(flags.reasoningEffort === undefined ? {} : { reasoningEffort: flags.reasoningEffort }) },
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
