/**
 * dsh-web-review eval runner: the one-shot headless driver for capability
 * evaluation. Modeled on the harness headless bundle
 * (packages/bundle/headless/src/index.ts) with two replacements:
 *
 * - the message set: each generic prompt is queued as an ordinary turn while
 *   the corresponding skill and Browser-comments messages are appended by a
 *   one-shot pre-step waterfall batch with the same sources and order;
 * - the model selection: provider/model/reasoning effort come from the
 *   per-run overlay config and are installed through the real
 *   installModelSelection hook.
 *
 * The snapshot is validated by the plugin's real parseAnnotationBody and
 * rendered by the real formatAnnotationContext, so the model-visible context
 * is byte-identical to a real annotated send.
 */
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ModelSelectionRef, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm/message'
import type { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { renderSkillContent, type SkillDefinition } from '@deepseek-ai/dsh-skill'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import {
  formatAnnotationContext,
  parseAnnotationBody,
} from '../../../packages/dsh-web-review/src/annotation-context.ts'
import { isUiSkillName, type UiSkillName } from '../../../packages/dsh-web-review/src/ui-skills.ts'
import { skillBody } from '../../../packages/dsh-web-review/src/skill-provider.ts'
import type { EvalArm } from '../../types.ts'
import { armContextTexts } from '../../arm-context.ts'

/** Stable Cordis plugin name (the overlay row id). */
export const name = 'dsh-web-review-eval-runner'

/** Core services required before the one-shot turn can start. */
export const inject = ['agentDefaultModel', 'agents', 'sessions']

/** Plugin config, populated by the per-run overlay. */
export interface Config {
  /** JSON string containing one scenario arm and its ordered rounds. */
  taskJson: string
  /** Absolute path of packages/dsh-web-review/skills (bundled UI skills). */
  skillRoot: string
  provider?: string
  model?: string
  reasoningEffort?: string
}

export const Config: z<Config> = z.object({
  taskJson: z.string().required(),
  skillRoot: z.string().required(),
  provider: z.string(),
  model: z.string(),
  reasoningEffort: z.string(),
})

/** Payload shape the runner script embeds in the overlay taskJson. */
interface RunnerTaskPayload {
  taskId: string
  arm: EvalArm
  rounds: {
    prompt: string
    snapshot: unknown
    oracleContext?: string
  }[]
}

/** Process-facing effects of one run (mirrors the headless bundle). */
interface RunnerIo {
  stdout: { write(chunk: string): unknown }
  stderr: { write(chunk: string): unknown }
  exit(code: number): void
}

/** Aggregate the last assistant text and turn outcome in one owned interval. */
function summarize(events: readonly SessionEvent[], firstSeq: number): {
  text: string
  reason: SessionEvent<'turn/end'>['data']['reason'] | undefined
} {
  let started = false
  let text = ''
  let reason: SessionEvent<'turn/end'>['data']['reason'] | undefined
  for (const event of events) {
    if (event.seq < firstSeq) continue
    if (event.type === 'turn/start') {
      started = true
      continue
    }
    if (!started) continue
    if (event.type === 'assistant/message') {
      const joined = event.data.message.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('')
      if (joined !== '') text = joined
    }
    if (event.type === 'turn/end') reason = event.data.reason
  }
  return { text, reason }
}

/** Read one bundled UI skill exactly like the plugin's provider does. */
function loadSkill(name: UiSkillName, skillRoot: string): Pick<SkillDefinition, 'name' | 'provider' | 'resourceBase' | 'content'> {
  const directory = join(skillRoot, name)
  return {
    name,
    provider: 'dsh-web-review-ui',
    resourceBase: { kind: 'directory', path: directory },
    content: skillBody(readFileSync(join(directory, 'SKILL.md'), 'utf8')),
  }
}

function fail(io: RunnerIo, message: string): void {
  io.stderr.write(`dsh-web-review-eval: ${message}\n`)
  io.exit(1)
}

function contextMessage(plugin: string, text: string): UserMessage {
  return createUserMessage({
    source: { kind: 'plugin', plugin, snapshotId: randomUUID() },
    content: [{ type: 'text', text }],
  })
}

/**
 * Run one task through a freshly created Agent and request process exit.
 * @param ctx - plugin context carrying the Agent, Session, and launcher IO services.
 * @param config - validated per-run config.
 * @param io - process-facing effects.
 */
async function run(ctx: Context, config: Config, io: RunnerIo): Promise<void> {
  // Loader siblings mount concurrently; await the complete application.
  await ctx.get('loader')?.await()
  const agents = ctx.get('agents')
  const sessions = ctx.get('sessions')
  if (agents === undefined || sessions === undefined) return

  let payload: RunnerTaskPayload
  try {
    payload = JSON.parse(config.taskJson) as RunnerTaskPayload
  } catch {
    fail(io, `invalid taskJson: ${config.taskJson.slice(0, 80)}…`)
    return
  }
  if (!['full', 'text-only', 'oracle'].includes(payload.arm) || !Array.isArray(payload.rounds) || payload.rounds.length === 0) {
    fail(io, `task ${payload.taskId}: invalid arm or empty rounds`)
    return
  }
  // Every round crosses the production wire validator before any model turn.
  const rounds = payload.rounds.map((round, index) => {
    const snapshot = parseAnnotationBody(JSON.stringify(round.snapshot))
    if (snapshot === undefined) throw new Error(`task ${payload.taskId} round ${index + 1}: frozen snapshot failed parseAnnotationBody`)
    if (typeof round.prompt !== 'string' || round.prompt.trim() === '') throw new Error(`task ${payload.taskId} round ${index + 1}: empty prompt`)
    if (payload.arm === 'oracle' && (typeof round.oracleContext !== 'string' || round.oracleContext.trim() === '')) {
      throw new Error(`task ${payload.taskId} round ${index + 1}: oracle arm needs source hints`)
    }
    return { ...round, snapshot }
  })

  const current: ModelSelectionRef['current'] = {
    provider: config.provider ?? 'deepseek-official',
    model: config.model ?? 'deepseek-v4-flash',
    ...(config.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: config.reasoningEffort as ReasoningEffortId }),
  }
  const selection: ModelSelectionRef = { current, assembled: undefined }
  let setRoundInjections: ((messages: UserMessage[]) => void) | undefined
  const { agent } = await agents.create({
    sessionId: SessionId(`session-${randomUUID()}`),
    meta: { cwd: process.cwd() },
    agentOptions: { provider: current.provider, model: current.model },
    setup: (agentCtx) => {
      installModelSelection(agentCtx, selection)
      // Each round arms exactly one pending injection batch. The waterfall
      // delegates first and appends only to an enter decision, matching the
      // production plugin's admission semantics.
      let pendingInjections: UserMessage[] | undefined
      setRoundInjections = (messages): void => {
        if (pendingInjections !== undefined) throw new Error('previous eval round injections were not admitted')
        pendingInjections = messages
      }
      agentCtx.on('agent/pre-step', async (_payload, next) => {
        const decision: PreStepDecision = await next()
        if (decision.kind !== 'enter' || pendingInjections === undefined) return decision
        const messages = pendingInjections
        pendingInjections = undefined
        return { kind: 'enter', messages: [...decision.messages, ...messages] }
      })
    },
  })
  await agent.whenIdle()

  if (setRoundInjections === undefined) throw new Error('eval round injection controller was not installed')
  const firstSeq = agent.session.seq
  for (const round of rounds) {
    const injections: UserMessage[] = []
    for (const skillName of round.snapshot.selectedSkills) {
      if (!isUiSkillName(skillName)) throw new Error(`task ${payload.taskId}: unknown selected skill "${skillName}"`)
      injections.push(createUserMessage({
        source: { kind: 'skill-invocation', name: skillName, form: 'instructions' },
        content: [{ type: 'text', text: renderSkillContent(loadSkill(skillName, config.skillRoot)) }],
      }))
    }
    injections.push(...armContextTexts(payload.arm, round.snapshot, formatAnnotationContext(round.snapshot), round.oracleContext)
      .map(context => contextMessage(context.plugin, context.text)))
    setRoundInjections(injections)
    agent.followup(createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: round.prompt }],
    }))
    await agent.whenIdle()
  }
  await sessions.flush(agent.session)

  const outcome = summarize(agent.session.events, firstSeq)
  io.stdout.write(`${outcome.text}\n`)
  if (outcome.reason?.kind === 'error') {
    io.stderr.write(`dsh: ${outcome.reason.error.code}: ${outcome.reason.error.message}\n`)
  }
  io.exit(outcome.reason?.kind === 'completed' ? 0 : 1)
}

/**
 * Mount the one-shot eval driver.
 * @param ctx - plugin context carrying core services and the launcher exit hook.
 * @param config - validated per-run config.
 */
export function apply(ctx: Context, config: Config): void {
  const exit = ctx.get('appExit') as ((code: number) => void) | undefined
  if (exit === undefined) {
    throw new Error('dsh-web-review-eval-runner: the launcher must provide ctx.appExit before the tree mounts')
  }
  const io: RunnerIo = {
    stdout: process.stdout,
    stderr: process.stderr,
    exit,
  }
  void run(ctx, config, io).catch((error: unknown) => {
    fail(io, error instanceof Error ? error.message : String(error))
  })
}
