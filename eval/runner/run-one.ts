/**
 * One task run: stage the workspace, launch headless DSH, collect the session
 * log, grade the result, and assemble the full RunRecord with evidence.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { analyzeSession } from '../process-stats.ts'
import { grade, gradeVariant, serveFixtureDir } from '../grader.ts'
import type { FailureAttribution, LoadedEvalTask, RunRecord, RunStatus } from '../types.ts'
import {
  ARTIFACTS_ROOT,
  collectSessionLog,
  diffWorkspace,
  harnessCommit,
  launchHeadless,
  modelRecord,
  repoCommit,
  stageWorkspace,
  writeOverlay,
  type RunOptions,
} from './runner.ts'
import { materializeEvalRunnerLink } from '../../scripts/eval-profile-link.ts'
import { REPO_ROOT } from './runner.ts'

export interface RunOneOptions extends RunOptions {
  /** Reuse an existing staged run dir instead of creating a fresh one. */
  runDir?: string
  /** Skip grading (still records process stats). */
  skipGrading?: boolean
  /** Skip the headless launch (grade an already-run workspace). */
  skipLaunch?: boolean
}

export function runDirFor(taskId: string, arm: LoadedEvalTask['arms'][number], repetition: number): string {
  return join(ARTIFACTS_ROOT, `${taskId}-${arm}-r${repetition}-${Date.now()}`)
}

/**
 * Execute one full task run. Returns the assembled record; writes all
 * artifacts under the run dir.
 */
export async function runTaskOnce(task: LoadedEvalTask, options: RunOneOptions): Promise<RunRecord> {
  const startedAt = new Date().toISOString()
  const runDir = options.runDir ?? runDirFor(task.id, options.arm, options.repetition)
  const workspaceDir = join(runDir, 'workspace')
  const dshHome = join(runDir, 'dsh-home')
  if (!options.skipLaunch && task.rounds.some(round => round.snapshot === undefined)) {
    throw new Error(`task ${task.id} has an unfrozen round; run pnpm eval:capture first`)
  }
  mkdirSync(dshHome, { recursive: true })
  if (!existsSync(workspaceDir)) stageWorkspace(task, workspaceDir)
  materializeEvalRunnerLink(REPO_ROOT, dshHome, 'headless')

  let status: RunStatus = 'error'
  let attribution: FailureAttribution = 'unknown'
  let exitCode: number | null = null
  let grader: RunRecord['grader']
  let stats: RunRecord['process']

  if (!options.skipLaunch) {
    const overlayPath = writeOverlay(runDir, task, options)
    const launch = await launchHeadless(runDir, overlayPath, task, dshHome, options)
    exitCode = launch.exitCode
    if (launch.timedOut) {
      status = 'timeout'
      attribution = 'timeout'
    } else if (launch.exitCode === 0) {
      status = 'pass'
    } else {
      status = 'error'
      attribution = 'runtime-error'
    }
    writeFileSync(join(runDir, 'stdout.txt'), launch.stdout)
    writeFileSync(join(runDir, 'stderr.txt'), launch.stderr)
    const session = collectSessionLog(runDir)
    if (session !== undefined) {
      stats = analyzeSession(session, join(runDir, 'trace.md'))
      writeFileSync(join(runDir, 'process.json'), JSON.stringify(stats, null, 2))
      if (stats.endReason !== 'completed' && !launch.timedOut) {
        status = 'error'
        attribution = 'runtime-error'
      }
    }
  }

  // Grade the agent-modified workspace (or the untouched baseline when the
  // launch was skipped).
  if (!options.skipGrading) {
    mkdirSync(join(runDir, 'evidence'), { recursive: true })
    try {
      const served = await serveFixtureDir(task, workspaceDir)
      grader = await grade(task, served.url, workspaceDir, join(runDir, 'evidence'))
      await served.stop()
    } catch (error) {
      grader = {
        pass: false,
        attribution: 'runtime-error',
        results: [{ assertion: { kind: 'runtime' }, ok: false, expected: 'grader ran', measured: String(error) }],
      }
      status = 'error'
      attribution = 'runtime-error'
    }
    if (status === 'pass' && !grader.pass) {
      status = 'fail'
      attribution = grader.attribution
    }
    if (status === 'pass' && grader.pass) {
      attribution = 'unknown'
    }
  }

  const diff = diffWorkspace(task, workspaceDir)
  writeFileSync(join(runDir, 'diff.txt'), diff.text)

  return {
    taskId: task.id,
    fixture: task.fixture,
    fixtureKind: task.fixtureKind,
    category: task.category,
    difficulty: task.difficulty,
    title: task.title,
    arm: options.arm,
    repetition: options.repetition,
    status,
    attribution,
    ...(grader === undefined ? {} : { grader }),
    ...(stats === undefined ? {} : { process: stats }),
    model: modelRecord(options),
    durationMs: Date.now() - Date.parse(startedAt),
    startedAt,
    exitCode,
    modifiedFiles: diff.modifiedFiles,
    runDir,
    repoCommit: repoCommit(),
    harnessCommit: harnessCommit(options.harnessRoot),
  }
}

/** Verify a task's grader separately: baseline must fail, golden must pass. */
export async function verifyTaskGrader(task: LoadedEvalTask): Promise<{ ok: boolean; details: string[] }> {
  const details: string[] = []
  const baseline = await gradeVariant(task, 'baseline', join(ARTIFACTS_ROOT, 'smoke-evidence', task.id))
  if (baseline.pass) {
    details.push(`baseline unexpectedly PASSED (grader too weak): ${task.id}`)
  } else {
    details.push(`baseline fails as expected (${baseline.results.filter(r => !r.ok).length} assertion(s) fail)`)
  }
  const golden = await gradeVariant(task, 'golden', join(ARTIFACTS_ROOT, 'smoke-evidence', task.id))
  if (!golden.pass) {
    details.push(`golden unexpectedly FAILED: ${task.id}: ${golden.results.filter(r => !r.ok).map(r => r.measured).join(' | ')}`)
  } else {
    details.push(`golden passes as expected`)
  }
  return { ok: !baseline.pass && golden.pass, details }
}
