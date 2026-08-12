/**
 * dsh-web-review eval runner: the one-shot headless driver for capability
 * evaluation. Modeled on the harness headless bundle
 * (packages/bundle/headless/src/index.ts) with two replacements:
 *
 * - the message set: the task instruction is queued as the ordinary turn
 *   while the plugin's real pre-step product (skill injections, the rendered
 *   Browser comments context, and — when needed — the loaded-skill reminder)
 *   is queued through agent.inject(), the same mechanism the real web flow's
 *   pre-step waterfall relies on, with the same message sources and order;
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
import type { ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm/message'
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

/** Stable Cordis plugin name (the overlay row id). */
export const name = 'dsh-web-review-eval-runner'

/** Core services required before the one-shot turn can start. */
export const inject = ['agentDefaultModel', 'agents', 'sessions']

/** Plugin config, populated by the per-run overlay. */
export interface Config {
  /** JSON string of { taskId, instruction, snapshot } (single task). */
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
  instruction: string
  snapshot: unknown
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
  // The frozen snapshot crosses the real wire validator before rendering.
  const snapshot = parseAnnotationBody(JSON.stringify(payload.snapshot))
  if (snapshot === undefined) {
    fail(io, `task ${payload.taskId}: frozen snapshot failed parseAnnotationBody`)
    return
  }
  const contextText = formatAnnotationContext(snapshot)

  const current: ModelSelectionRef['current'] = {
    provider: config.provider ?? 'deepseek',
    model: config.model ?? 'deepseek-v4-flash',
    ...(config.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: config.reasoningEffort as ReasoningEffortId }),
  }
  const selection: ModelSelectionRef = { current, assembled: undefined }
  const { agent } = await agents.create({
    sessionId: SessionId(`session-${randomUUID()}`),
    meta: { cwd: process.cwd() },
    agentOptions: { provider: current.provider, model: current.model },
    setup: (agentCtx) => {
      installModelSelection(agentCtx, selection)
    },
  })
  await agent.whenIdle()

  // Skill injections first, then the Browser comments context — the exact
  // order the real web pre-step appends them after the claimed user message.
  for (const skillName of snapshot.selectedSkills) {
    if (!isUiSkillName(skillName)) {
      fail(io, `task ${payload.taskId}: unknown selected skill "${skillName}"`)
      return
    }
    agent.inject(createUserMessage({
      source: { kind: 'skill-invocation', name: skillName, form: 'instructions' },
      content: [{ type: 'text', text: renderSkillContent(loadSkill(skillName, config.skillRoot)) }],
    }))
  }
  agent.inject(createUserMessage({
    source: { kind: 'plugin', plugin: 'dsh-web-review', snapshotId: randomUUID() },
    content: [{ type: 'text', text: contextText }],
  }))
  // The instruction is the ordinary claimed message of this one turn.
  const firstSeq = agent.session.seq
  agent.followup(createUserMessage({
    source: { kind: 'user' },
    content: [{ type: 'text', text: payload.instruction }],
  }))
  await agent.whenIdle()
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
