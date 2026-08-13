/**
 * Headless runner core: workspace staging, per-run overlay, DSH launch with
 * timeout, session-log collection, and workspace diffing. One task per run;
 * batch orchestration lives in batch.ts.
 */
import { spawn, execFileSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join, relative } from 'node:path'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { resolveHarnessCli } from '../../scripts/harness-path.ts'
import type { EvalArm, FixtureKind, LoadedEvalTask, ModelSelectionRecord } from '../types.ts'
import { runnerTaskPayload } from './payload.ts'

export const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
export const FIXTURES_ROOT = join(REPO_ROOT, 'eval', 'fixtures')
export const ARTIFACTS_ROOT = join(REPO_ROOT, '.artifacts', 'eval-runs')
export const RESULTS_PATH = join(REPO_ROOT, 'eval', 'results')

/** Fixture metadata per app. */
const FIXTURE_KINDS: Record<string, FixtureKind> = {
  landing: 'static',
  forms: 'static',
  'static-catalog': 'static',
  'react-todo': 'react',
  'react-shop': 'react',
  'react-dashboard': 'react',
  'react-profile': 'react',
  'react-operations': 'react',
  'vue-blog': 'vue',
  'vue-kanban': 'vue',
  'vue-chat': 'vue',
  'vue-settings': 'vue',
}

export function fixtureKindOf(fixture: string): FixtureKind {
  const kind = FIXTURE_KINDS[fixture]
  if (kind === undefined) throw new Error(`unknown fixture "${fixture}"`)
  return kind
}

/** Baseline directory served to the agent as its workspace. */
export function baselineDir(fixture: string): string {
  return join(FIXTURES_ROOT, fixture, 'baseline')
}

/** Content hash of a directory (sorted relative paths → sha1). */
export function hashDir(dir: string): string {
  const hash = createHash('sha1')
  const walk = (current: string): void => {
    for (const entry of readdirSync(current).sort()) {
      const path = join(current, entry)
      const stat = statSync(path)
      if (stat.isDirectory()) walk(path)
      else {
        hash.update(relative(dir, path))
        hash.update(readFileSync(path))
      }
    }
  }
  walk(dir)
  return hash.digest('hex')
}

/** Stage a clean workspace copy of the fixture baseline. */
export function stageWorkspace(task: LoadedEvalTask, workspaceDir: string): void {
  const source = baselineDir(task.fixture)
  mkdirSync(workspaceDir, { recursive: true })
  cpSync(source, workspaceDir, {
    recursive: true,
    filter: (path) => !path.endsWith('.patch'),
  })
  if (task.fixtureKind !== 'static') {
    const sharedModules = join(FIXTURES_ROOT, 'node_modules')
    if (!existsSync(sharedModules)) {
      throw new Error('eval fixture node_modules missing; run pnpm install inside eval/fixtures first')
    }
    symlinkSync(sharedModules, join(workspaceDir, 'node_modules'), 'dir')
  }
}

/** OS-assigned free port (released before use). */
export function probeFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      if (address === null || typeof address === 'string') {
        probe.close(() => { reject(new Error('port probe returned no address')) })
        return
      }
      probe.close(() => { resolvePort(address.port) })
    })
  })
}

export interface CredentialOutcome {
  stagedCredentials: boolean
}

/**
 * Preserve the product credential chain without logging secrets: inherited
 * environment first, then repo `.env`, then `~/.dsh/.env`, then a copy of the
 * default DSH credentials file staged mode 0600 into the isolated home.
 */
export function resolveCredentials(dshHome: string): CredentialOutcome {
  if (process.env.DEEPSEEK_API_KEY !== undefined) return { stagedCredentials: false }
  for (const candidate of [join(REPO_ROOT, '.env'), join(homedir(), '.dsh', '.env')]) {
    try {
      process.loadEnvFile(candidate)
      if (process.env.DEEPSEEK_API_KEY !== undefined) return { stagedCredentials: false }
    } catch {
      // Candidate absent — try the next.
    }
  }
  const defaultCredentials = join(homedir(), '.dsh', '.credentials.yaml')
  if (existsSync(defaultCredentials)) {
    const staged = join(dshHome, '.credentials.yaml')
    copyFileSync(defaultCredentials, staged)
    chmodSync(staged, 0o600)
    return { stagedCredentials: true }
  }
  return { stagedCredentials: false }
}

export interface RunOptions {
  provider: string
  model: string
  reasoningEffort?: string
  timeoutMs: number
  harnessRoot?: string
  /** Published DSH CLI entry; takes precedence over a source checkout. */
  dshCli?: string
  /** Source commit or published package version used in experiment identity. */
  runtimeRevision?: string
  arm: EvalArm
  repetition: number
}

/** Write the per-run headless overlay into the run dir. */
export function writeOverlay(
  runDir: string,
  task: LoadedEvalTask,
  options: RunOptions,
  skillRoot = join(REPO_ROOT, 'packages', 'dsh-web-review', 'skills'),
): string {
  const taskJson = JSON.stringify(runnerTaskPayload(task, options.arm))
  const overlay = [
    '- id: headless-runner',
    '  disabled: true',
    '- insert:',
    '    - id: dsh-web-review-eval-runner',
    "      name: '@dsh-web-review-dev/eval-runner'",
    '      config:',
    '        taskJson: |-',
    ...taskJson.split('\n').map(line => `          ${line}`),
    `        skillRoot: ${skillRoot}`,
    `        provider: ${options.provider}`,
    `        model: ${options.model}`,
    ...(options.reasoningEffort === undefined ? [] : [`        reasoningEffort: ${options.reasoningEffort}`]),
    '- id: session-persistence-jsonl',
    '  config:',
    `    root: ${join(runDir, 'sessions')}`,
    '    packChunks: false',
    '    compression: none',
    '- id: telemetry-otel',
    '  disabled: true',
    '',
  ].join('\n')
  const path = join(runDir, 'eval.cordis.yml')
  writeFileSync(path, overlay)
  return path
}

export interface LaunchResult {
  exitCode: number | null
  timedOut: boolean
  stdout: string
  stderr: string
}

/** Launch one headless task run with a bounded timeout and SIGTERM grace. */
export async function launchHeadless(
  workspaceDir: string,
  overlayPath: string,
  task: LoadedEvalTask,
  dshHome: string,
  options: RunOptions,
): Promise<LaunchResult> {
  let bin: string
  if (options.dshCli !== undefined) bin = options.dshCli
  else {
    if (options.harnessRoot === undefined) throw new Error('eval requires harnessRoot or dshCli')
    bin = resolveHarnessCli(options.harnessRoot)
  }
  resolveCredentials(dshHome)
  // Headless has no UI to answer approval prompts; the harness-sanctioned
  // (sandbox: danger-full-access, approval: never) preset keeps the composed
  // knobs valid and the run interactive-free. The workspace is a disposable
  // copy staged per task.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DSH_HOME: dshHome,
    DSH_TOOLS_MODE: 'native',
    DSH_TELEMETRY_DISABLED: '1',
    DSH_PERMISSION_MODE: 'danger-full-access',
  }
  const child = spawn(process.execPath, [
    bin,
    '--profile', 'headless',
    '--patch', overlayPath,
    task.rounds[0]?.prompt ?? '请根据页面批注修改前端实现。',
  ], { cwd: workspaceDir, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
  child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    child.kill('SIGTERM')
    setTimeout(() => { child.kill('SIGKILL') }, 10_000).unref()
  }, options.timeoutMs)
  const exitCode: number | null = await new Promise(resolveExit => {
    child.once('exit', (code) => {
      clearTimeout(timer)
      resolveExit(code)
    })
  })
  return { exitCode, timedOut, stdout, stderr }
}

/** Copy the newest persisted session log from the overlay root into the run dir. */
export function collectSessionLog(sourceRoot: string, destinationRoot = sourceRoot): string | undefined {
  const sessionsRoot = join(sourceRoot, 'sessions')
  let newest: { path: string; mtimeMs: number } | undefined
  const walk = (current: string): void => {
    if (!existsSync(current)) return
    for (const entry of readdirSync(current)) {
      const path = join(current, entry)
      const stat = statSync(path)
      if (stat.isDirectory()) walk(path)
      else if (entry.endsWith('.jsonl')) {
        if (newest === undefined || stat.mtimeMs > newest.mtimeMs) newest = { path, mtimeMs: stat.mtimeMs }
      }
    }
  }
  walk(sessionsRoot)
  if (newest === undefined) return undefined
  const destination = join(destinationRoot, 'session.jsonl')
  cpSync(newest.path, destination)
  return destination
}

export interface WorkspaceDiff {
  modifiedFiles: string[]
  text: string
}

/** Diff the workspace copy against the fixture baseline (capped text). */
export function diffWorkspace(task: LoadedEvalTask, workspaceDir: string): WorkspaceDiff {
  const baseline = baselineDir(task.fixture)
  const modified: string[] = []
  const lines: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const path = join(dir, entry)
      const rel = relative(workspaceDir, path)
      const baselinePath = join(baseline, rel)
      const stat = statSync(path)
      if (stat.isDirectory()) {
        if (entry === 'node_modules' || entry === '.vite') continue
        if (!existsSync(baselinePath)) {
          lines.push(`A ${rel}/`)
        }
        walk(path)
        continue
      }
      if (!existsSync(baselinePath)) {
        modified.push(rel)
        lines.push(`A ${rel}`)
        continue
      }
      if (readFileSync(path, 'utf8') !== readFileSync(baselinePath, 'utf8')) {
        modified.push(rel)
        lines.push(`M ${rel}`)
      }
    }
    // Deletions in baseline relative to workspace.
    if (existsSync(baseline) && dir === workspaceDir) {
      const baselineWalk = (baseDir: string): void => {
        for (const entry of readdirSync(baseDir).sort()) {
          const basePath = join(baseDir, entry)
          const baseRel = relative(baseline, basePath)
          const rel = relative(workspaceDir, join(workspaceDir, baseRel))
          if (statSync(basePath).isDirectory()) {
            if (!existsSync(join(workspaceDir, baseRel))) {
              modified.push(rel)
              lines.push(`D ${rel}/`)
            } else baselineWalk(basePath)
            continue
          }
          if (entry.endsWith('.patch')) continue
          if (!existsSync(join(workspaceDir, baseRel))) {
            modified.push(rel)
            lines.push(`D ${rel}`)
          }
        }
      }
      baselineWalk(baseline)
    }
  }
  walk(workspaceDir)
  const text = lines.slice(0, 400).join('\n') + (lines.length > 400 ? `\n… ${lines.length - 400} more lines` : '')
  return { modifiedFiles: modified.slice(0, 200), text }
}

export function repoCommit(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim()
}

export function harnessCommit(harnessRoot: string): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: harnessRoot, encoding: 'utf8' }).trim()
}

export function modelRecord(options: RunOptions): ModelSelectionRecord {
  return {
    provider: options.provider,
    model: options.model,
    ...(options.reasoningEffort === undefined ? {} : { reasoningEffort: options.reasoningEffort }),
  }
}

export function cleanRunDir(runDir: string): void {
  rmSync(runDir, { recursive: true, force: true })
}
