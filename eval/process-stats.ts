/**
 * Parse a durable session JSONL log (one SessionEvent per line) into the
 * structured process statistics the report renders, plus a human-readable
 * trace. The log is DSH's own persistence output — no custom instrumentation.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ProcessStats } from './types.ts'

interface EventLine {
  seq?: number
  type?: string
  time?: number
  data?: Record<string, unknown>
}

function textOfContent(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return (content as { type?: string; text?: string }[])
    .filter(block => block.type === 'text')
    .map(block => block.text ?? '')
    .join('')
}

function reasoningOfContent(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return (content as { type?: string; text?: string }[])
    .filter(block => block.type === 'reasoning')
    .map(block => block.text ?? '')
    .join('')
}

function isWriteishCall(name: string, args: string): boolean {
  if (name === 'bash') return true
  if (name !== 'fs' && name !== 'file') return false
  return /write|create|delete|move|patch/iu.test(args)
}

/** Aggregate one session log into statistics plus a folded markdown trace. */
export function analyzeSession(sessionPath: string, tracePath: string): ProcessStats {
  const lines = readFileSync(sessionPath, 'utf8').split('\n').filter(line => line.trim() !== '')
  const events: EventLine[] = lines.map(line => JSON.parse(line) as EventLine)

  const toolCalls: Record<string, number> = {}
  const filesRead = new Set<string>()
  const perStepTokens: ProcessStats['perStepTokens'] = []
  const stepChunkUsage = new Map<number, { input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number }>()
  const stepMessageUsage = new Set<number>()
  let turns = 0
  let steps = 0
  let errorResults = 0
  let firstToolCallStep: number | undefined
  let firstWriteStep: number | undefined
  let reasoningChars = 0
  let finalText = ''
  let endReason = 'unknown'
  const tokens: ProcessStats['tokens'] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, stepsWithUsage: 0, assistantSteps: 0 }
  const stepUsageShape = (value: unknown): { input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number } | undefined => {
    if (typeof value !== 'object' || value === null) return undefined
    const record = value as Record<string, unknown>
    if (typeof record.input !== 'number' || typeof record.output !== 'number') return undefined
    return {
      input: record.input,
      output: record.output,
      cacheRead: typeof record.cacheRead === 'number' ? record.cacheRead : 0,
      cacheWrite: typeof record.cacheWrite === 'number' ? record.cacheWrite : 0,
      reasoning: typeof record.reasoning === 'number' ? record.reasoning : 0,
    }
  }
  let firstTime: number | undefined
  let lastTime: number | undefined

  const trace: string[] = ['# Session trace', '']
  let currentTurn = 0
  let currentStep = 0

  for (const event of events) {
    if (event.time !== undefined) {
      if (firstTime === undefined || event.time < firstTime) firstTime = event.time
      if (lastTime === undefined || event.time > lastTime) lastTime = event.time
    }
    const data = event.data ?? {}
    switch (event.type) {
      case 'assistant/chunk': {
        const chunk = (data as { chunk?: { type?: string; usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; reasoningTokens?: number } } }).chunk
        if (chunk?.type === 'usage' && chunk.usage !== undefined) {
          const step = Number(data.step ?? currentStep)
          const current = stepChunkUsage.get(step) ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }
          current.input += chunk.usage.inputTokens ?? 0
          current.output += chunk.usage.outputTokens ?? 0
          current.cacheRead += chunk.usage.cacheReadTokens ?? 0
          current.cacheWrite += chunk.usage.cacheWriteTokens ?? 0
          current.reasoning += chunk.usage.reasoningTokens ?? 0
          stepChunkUsage.set(step, current)
        }
        break
      }
      case 'turn/start': {
        turns += 1
        currentTurn = Number(data.turn ?? turns)
        trace.push('', `## Turn ${currentTurn}`)
        break
      }
      case 'turn/end': {
        const reason = data.reason as { kind?: string } | undefined
        endReason = reason?.kind ?? 'unknown'
        trace.push(`_turn ended: ${endReason}_`)
        break
      }
      case 'step/start': {
        steps += 1
        currentStep = Number(data.step ?? steps)
        break
      }
      case 'user/message': {
        const source = data.source as { kind?: string; name?: string; plugin?: string } | undefined
        const label = source?.plugin !== undefined
          ? `plugin:${source.plugin}`
          : source?.kind === 'skill-invocation' ? `skill:${source?.name ?? '?'}`
            : source?.kind ?? 'user'
        const text = textOfContent(data.content)
        trace.push('', `### Turn ${currentTurn} · user message (${label})`)
        trace.push('```text')
        trace.push(text.length > 4000 ? `${text.slice(0, 4000)}…` : text)
        trace.push('```')
        break
      }
      case 'assistant/message': {
        tokens.assistantSteps += 1
        const message = data.message as { content?: unknown } | undefined
        const usage = stepUsageShape(data.usage)
        if (usage !== undefined) {
          stepMessageUsage.add(currentStep)
          tokens.stepsWithUsage += 1
          tokens.input += usage.input
          tokens.output += usage.output
          tokens.cacheRead += usage.cacheRead
          tokens.cacheWrite += usage.cacheWrite
          tokens.reasoning += usage.reasoning
          perStepTokens.push({
            step: currentStep,
            input: usage.input,
            output: usage.output,
            cacheRead: usage.cacheRead,
            cacheWrite: usage.cacheWrite,
            reasoning: usage.reasoning,
          })
        }
        const reasoning = reasoningOfContent(message?.content)
        reasoningChars += reasoning.length
        const text = textOfContent(message?.content)
        if (text !== '') finalText = text
        trace.push('', `### Turn ${currentTurn} · step ${currentStep} · assistant`)
        if (reasoning !== '') {
          trace.push('<details><summary>Thinking (reasoning block)</summary>', '')
          trace.push(reasoning.length > 3000 ? `${reasoning.slice(0, 3000)}…` : reasoning)
          trace.push('', '</details>')
        }
        if (usage !== undefined) {
          trace.push(`_usage: in ${usage.input} · out ${usage.output} · cache r/w ${usage.cacheRead}/${usage.cacheWrite} · reasoning ${usage.reasoning}_`)
        }
        if (text !== '') {
          trace.push('```text')
          trace.push(text.length > 3000 ? `${text.slice(0, 3000)}…` : text)
          trace.push('```')
        }
        break
      }
      case 'tool/call': {
        const name = String(data.name ?? '?')
        const args = String(data.arguments ?? '')
        toolCalls[name] = (toolCalls[name] ?? 0) + 1
        if (firstToolCallStep === undefined) firstToolCallStep = currentStep
        if (firstWriteStep === undefined && isWriteishCall(name, args)) firstWriteStep = currentStep
        if ((name === 'fs' || name === 'file') && /read/iu.test(args)) {
          const match = /"path"\s*:\s*"([^"]+)"/u.exec(args)
          if (match?.[1] !== undefined) filesRead.add(match[1])
        }
        trace.push('', `### Turn ${currentTurn} · step ${currentStep} · tool: \`${name}\``)
        trace.push('<details><summary>arguments</summary>', '', '```json', args.slice(0, 2000), '```', '</details>')
        break
      }
      case 'tool/result': {
        const error = data.error as { name?: string; code?: string } | undefined
        if (error !== undefined) errorResults += 1
        const text = textOfContent(data.message)
        trace.push(`<details><summary>result${error !== undefined ? ` (${error.name ?? 'error'})` : ''}</summary>`, '')
        trace.push('```text')
        trace.push(text.length > 2000 ? `${text.slice(0, 2000)}…` : text)
        trace.push('```', '</details>')
        break
      }
      default:
        break
    }
  }

  // Older session logs report usage as terminal `usage` chunks instead of
  // the assistant/message field: fold them into the same ledger.
  for (const [step, usage] of stepChunkUsage) {
    if (!stepMessageUsage.has(step)) {
      tokens.stepsWithUsage += 1
      tokens.input += usage.input
      tokens.output += usage.output
      tokens.cacheRead += usage.cacheRead
      tokens.cacheWrite += usage.cacheWrite
      tokens.reasoning += usage.reasoning
      perStepTokens.push({ step, ...usage })
      perStepTokens.sort((a, b) => a.step - b.step)
    }
  }

  writeFileSync(tracePath, trace.join('\n'))
  return {
    turns,
    steps,
    toolCalls,
    errorResults,
    ...(firstToolCallStep === undefined ? {} : { firstToolCallStep }),
    ...(firstWriteStep === undefined ? {} : { firstWriteStep }),
    filesRead: [...filesRead].sort(),
    tokens,
    perStepTokens,
    reasoningChars,
    finalText,
    endReason,
    durationMs: firstTime === undefined || lastTime === undefined ? 0 : lastTime - firstTime,
  }
}

/** Convenience wrapper writing process.json next to the trace. */
export function writeProcessStats(sessionPath: string, outDir: string): ProcessStats {
  const stats = analyzeSession(sessionPath, join(outDir, 'trace.md'))
  writeFileSync(join(outDir, 'process.json'), JSON.stringify(stats, null, 2))
  return stats
}
