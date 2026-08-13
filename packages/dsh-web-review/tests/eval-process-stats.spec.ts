import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { analyzeSession } from '../../../eval/process-stats.ts'

describe('eval process statistics', () => {
  it('recognizes native read/edit tools and the durable Harness session id', () => {
    const directory = mkdtempSync(join(tmpdir(), 'eval-process-stats-'))
    const session = join(directory, 'session.jsonl')
    const trace = join(directory, 'trace.md')
    const events = [
      { type: 'session', version: 0, id: 'session-eval-test', createdAt: 1, cwd: '/workspace' },
      { type: 'turn/start', seq: 0, time: 2, data: { turn: 1 } },
      { type: 'step/start', seq: 1, time: 3, data: { turn: 1, step: 1 } },
      { type: 'tool/call', seq: 2, time: 4, data: { turn: 1, step: 1, name: 'bash', arguments: '{"command":"ls -la"}' } },
      { type: 'tool/call', seq: 3, time: 5, data: { turn: 1, step: 1, name: 'read', arguments: '{"file_path":"/workspace/index.html"}' } },
      { type: 'step/start', seq: 4, time: 6, data: { turn: 1, step: 2 } },
      { type: 'tool/call', seq: 5, time: 7, data: { turn: 1, step: 2, name: 'edit', arguments: '{"file_path":"/workspace/index.html"}' } },
      { type: 'turn/end', seq: 6, time: 8, data: { reason: { kind: 'completed' } } },
    ]
    writeFileSync(session, `${events.map(event => JSON.stringify(event)).join('\n')}\n`)
    const stats = analyzeSession(session, trace)
    expect(stats.sessionId).toBe('session-eval-test')
    expect(stats.firstToolCallStep).toBe(1)
    expect(stats.firstWriteStep).toBe(2)
    expect(stats.filesRead).toEqual(['/workspace/index.html'])
    expect(stats.toolCalls).toEqual({ bash: 1, read: 1, edit: 1 })
    expect(readFileSync(trace, 'utf8')).toContain('tool: `read`')
  })
})
