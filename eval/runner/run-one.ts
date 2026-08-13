/**
 * One task run: stage the workspace, launch headless DSH, collect the session
 * log, grade the result, and assemble the full RunRecord with evidence.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
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
import { executionRevision, experimentId, graderRevision, taskRevision } from '../identity.ts'

export interface RunOneOptions extends RunOptions {
  /** Reuse an existing staged run dir instead of creating a fresh one. */
  runDir?: string
  /** Skip grading (still records process stats). */
  skipGrading?: boolean
  /** Skip the headless launch (grade an already-run workspace). */
  skipLaunch?: boolean
}

export function runDirFor(taskId: string, arm: LoadedEvalTask['arms'][number], repetition: number): string {
  void taskId; void arm; void repetition
  return join(ARTIFACTS_ROOT, `run-${randomUUID()}`)
}

/** Create and populate the neutral live workspace used by a model launch. */
export function stageIsolatedWorkspace(task: LoadedEvalTask): { liveRoot: string; workspaceDir: string } {
  const liveRoot = mkdtempSync(join(tmpdir(), 'dsh-eval-run-'))
  const workspaceDir = join(liveRoot, 'workspace')
  stageWorkspace(task, workspaceDir)
  if (task.fixtureKind !== 'static') {
    const neutralModules = join(liveRoot, 'runtime', 'dependencies', 'node_modules')
    mkdirSync(join(liveRoot, 'runtime', 'dependencies'), { recursive: true })
    symlinkSync(join(REPO_ROOT, 'eval', 'fixtures', 'node_modules'), neutralModules, 'dir')
    unlinkSync(join(workspaceDir, 'node_modules'))
    symlinkSync(neutralModules, join(workspaceDir, 'node_modules'), 'dir')
  }
  return { liveRoot, workspaceDir }
}

/**
 * Execute one full task run. Returns the assembled record; writes all
 * artifacts under the run dir.
 */
export async function runTaskOnce(task: LoadedEvalTask, options: RunOneOptions): Promise<RunRecord> {
  const startedAt = new Date().toISOString()
  const runDir = options.runDir ?? runDirFor(task.id, options.arm, options.repetition)
  const persistedWorkspaceDir = join(runDir, 'workspace')
  const isolated = options.skipLaunch === true ? undefined : stageIsolatedWorkspace(task)
  const liveRoot = isolated?.liveRoot
  const workspaceDir = isolated?.workspaceDir ?? persistedWorkspaceDir
  const controlRoot = liveRoot ?? runDir
  const dshHome = join(controlRoot, 'dsh-home')
  if (!options.skipLaunch && task.rounds.some(round => round.snapshot === undefined)) {
    throw new Error(`task ${task.id} has an unfrozen round; run pnpm eval:capture first`)
  }
  mkdirSync(runDir, { recursive: true })
  mkdirSync(dshHome, { recursive: true })
  // mkdtemp creates liveRoot, not workspaceDir. Always stage a fresh child;
  // checking liveRoot itself previously produced an empty model workspace.
  if (liveRoot === undefined && !existsSync(workspaceDir)) stageWorkspace(task, workspaceDir)

  // Keep model-visible control files, skills, sessions, and the runner package
  // under the same neutral OS-temp root. Artifacts are copied back only after
  // the model process exits, so arm metadata is not discoverable by walking up
  // from cwd/DSH_HOME.
  const runtimeRepo = liveRoot === undefined ? REPO_ROOT : join(liveRoot, 'runtime')
  const runtimeRunner = join(runtimeRepo, 'eval', 'runner-plugin')
  const runtimeSkills = join(runtimeRepo, 'packages', 'dsh-web-review', 'skills')
  if (liveRoot !== undefined) {
    mkdirSync(runtimeRunner, { recursive: true })
    mkdirSync(join(runtimeRepo, 'packages', 'dsh-web-review'), { recursive: true })
    cpSync(join(REPO_ROOT, 'eval', 'runner-plugin', 'package.json'), join(runtimeRunner, 'package.json'))
    cpSync(join(REPO_ROOT, 'eval', 'runner-plugin', 'lib'), join(runtimeRunner, 'lib'), { recursive: true })
    cpSync(join(REPO_ROOT, 'packages', 'dsh-web-review', 'skills'), runtimeSkills, { recursive: true })
  }
  materializeEvalRunnerLink(runtimeRepo, dshHome, 'headless')

  let status: RunStatus = 'error'
  let attribution: FailureAttribution = 'unknown'
  let exitCode: number | null = null
  let grader: RunRecord['grader']
  let stats: RunRecord['process']

  if (!options.skipLaunch) {
    const overlayPath = writeOverlay(controlRoot, task, options, runtimeSkills)
    const launch = await launchHeadless(workspaceDir, overlayPath, task, dshHome, options)
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
    const session = collectSessionLog(controlRoot, runDir)
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

  if (liveRoot !== undefined) {
    cpSync(workspaceDir, persistedWorkspaceDir, { recursive: true })
    rmSync(liveRoot, { recursive: true, force: true })
  }

  const model = modelRecord(options)
  const repo = repoCommit()
  const harness = options.runtimeRevision ?? (() => {
    if (options.harnessRoot === undefined) throw new Error('missing eval runtime revision')
    return harnessCommit(options.harnessRoot)
  })()
  const executionStatus = exitCode === 0 && stats?.endReason === 'completed'
    ? 'completed'
    : status === 'timeout' ? 'timeout' : 'error'

  return {
    diagnosticValidity: 'eligible',
    experimentId: experimentId({ task, arm: options.arm, repetition: options.repetition, model, repoCommit: repo, harnessCommit: harness }),
    taskRevision: taskRevision(task),
    executionRevision: executionRevision(),
    graderRevision: graderRevision(task),
    gradedAt: new Date().toISOString(),
    originalStatus: status,
    executionStatus,
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
    model,
    durationMs: Date.now() - Date.parse(startedAt),
    startedAt,
    exitCode,
    modifiedFiles: diff.modifiedFiles,
    runDir,
    repoCommit: repo,
    harnessCommit: harness,
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
