/** Re-evaluate persisted workspaces after grader/statistics calibration. */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { grade, serveFixtureDir } from './grader.ts'
import { analyzeSession } from './process-stats.ts'
import { loadTasks } from './tasks/register.ts'
import { RESULTS_PATH } from './runner/runner.ts'
import { graderRevision } from './identity.ts'
import type { RunRecord } from './types.ts'

const RESULTS_FILE = join(RESULTS_PATH, 'results.jsonl')

async function main(): Promise<void> {
  if (!existsSync(RESULTS_FILE)) throw new Error(`no results at ${RESULTS_FILE}`)
  const ids = process.argv.slice(2).filter(argument => argument !== '--' && !argument.startsWith('--'))
  const tasks = new Map((await loadTasks()).map(task => [task.id, task]))
  const latest = new Map<string, RunRecord>()
  const firstStatusByRunDir = new Map<string, RunRecord['status']>()
  for (const line of readFileSync(RESULTS_FILE, 'utf8').split('\n')) {
    if (line.trim() === '') continue
    const record = JSON.parse(line) as RunRecord
    if (record.runDir !== '' && !firstStatusByRunDir.has(record.runDir)) firstStatusByRunDir.set(record.runDir, record.originalStatus ?? record.status)
    latest.set(record.experimentId ?? `${record.taskId}:${record.arm}:${record.repetition}:${record.model.provider}:${record.model.model}:${record.model.reasoningEffort ?? 'unknown'}:${record.repoCommit}:${record.harnessCommit}`, record)
  }
  const records = [...latest.values()].filter(record => ids.length === 0 || ids.includes(record.taskId))
  for (const record of records) {
    const task = tasks.get(record.taskId)
    if (task === undefined || record.runDir === '') continue
    const workspace = join(record.runDir, 'workspace')
    if (!existsSync(workspace)) continue
    const session = join(record.runDir, 'session.jsonl')
    mkdirSync(join(record.runDir, 'evidence'), { recursive: true })
    const process = existsSync(session)
      ? analyzeSession(session, join(record.runDir, 'trace.md'))
      : record.process
    if (process !== undefined) writeFileSync(join(record.runDir, 'process.json'), JSON.stringify(process, null, 2))
    const served = await serveFixtureDir(task, workspace)
    let grader
    try {
      grader = await grade(task, served.url, workspace, join(record.runDir, 'evidence'))
    } finally {
      await served.stop()
    }
    writeFileSync(join(record.runDir, 'grader.json'), JSON.stringify(grader, null, 2))
    const runtimeOk = record.exitCode === 0 && process?.endReason === 'completed'
    const updated: RunRecord = {
      ...record,
      title: task.title,
      category: task.category,
      graderRevision: graderRevision(task),
      gradedAt: new Date().toISOString(),
      originalStatus: record.originalStatus ?? firstStatusByRunDir.get(record.runDir) ?? record.status,
      executionStatus: record.executionStatus ?? (runtimeOk ? 'completed' : record.status === 'timeout' ? 'timeout' : 'error'),
      status: runtimeOk ? (grader.pass ? 'pass' : 'fail') : 'error',
      attribution: runtimeOk ? grader.attribution : 'runtime-error',
      grader,
      ...(process === undefined ? {} : { process }),
    }
    appendFileSync(RESULTS_FILE, `${JSON.stringify(updated)}\n`)
    console.log(`[regrade] ${record.taskId}/${record.arm}/r${record.repetition}: ${record.status} -> ${updated.status}`)
  }
}

void main()
