/**
 * Pure annotation-injection helpers for the node half (plan §2.3, §6 step 1):
 * the `/webview-annotations` POST body parsing, the in-memory
 * session → annotation-XML store operations, and the `agent/prompt-submit`
 * rewrite decision that prefixes the annotation XML onto the user's own
 * message. Everything stateful lives in a plain `Map`; the route and the
 * waterfall listener are thin shells over these functions so the injection
 * semantics are unit-testable without a harness runtime.
 *
 * Deliberately runtime-dependency-free (type-only imports only): the Loader
 * imports this package from its own directory outside the harness, which must
 * not require a local node_modules (AGENTS.md).
 */
import type { PromptDecision } from '@deepseek-ai/dsh-agent'
import type { IncomingMessage } from 'node:http'

/** POST body cap for `/webview-annotations` (annotation XML stays small). */
export const MAX_ANNOTATION_BODY = 64 * 1024

/** One parsed, validated `/webview-annotations` POST body. */
export interface AnnotationBody {
  sessionId: string
  xml: string
}

/**
 * One content block of a user message — the minimal structural slice the
 * injection reads (only `text`-typed blocks contribute to the prompt). Kept
 * structural so this module needs no resolvable dsh-session types.
 */
export interface TextBlockLike {
  readonly type: string
  readonly text?: string
}

/** A user message's model-facing content, structurally. */
export interface TextBlocks {
  content: readonly TextBlockLike[]
}

/**
 * Parse and validate a `/webview-annotations` POST body: `sessionId` must be
 * a non-empty string; `xml` must be a string (empty allowed — clearing the
 * annotations syncs an empty string, which the injection passes through).
 * @param body - the raw request body.
 * @returns the validated record, or undefined when malformed.
 */
export function parseAnnotationBody(body: string): AnnotationBody | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const record = parsed as { sessionId?: unknown; xml?: unknown }
  if (typeof record.sessionId !== 'string' || record.sessionId === '') return undefined
  if (typeof record.xml !== 'string') return undefined
  return { sessionId: record.sessionId, xml: record.xml }
}

/** Store one session's annotation XML, replacing any previous value. */
export function setAnnotation(map: Map<string, string>, sessionId: string, xml: string): Map<string, string> {
  return map.set(sessionId, xml)
}

/** Read one session's annotation XML (undefined when never synced). */
export function getAnnotation(map: ReadonlyMap<string, string>, sessionId: string): string | undefined {
  return map.get(sessionId)
}

/**
 * Concatenate the text of the `text` blocks of a user message and trim — the
 * user's own prompt text the annotation XML is prefixed onto.
 * @param content - the message's content blocks.
 * @returns the trimmed joined text; non-text blocks are ignored.
 */
export function concatUserText(content: readonly TextBlockLike[]): string {
  let text = ''
  for (const block of content) {
    if (block.type === 'text') text += block.text ?? ''
  }
  return text.trim()
}

/**
 * The `agent/prompt-submit` decision for one claimed prompt: no annotation or
 * a blank one → undefined (the caller passes through with `next()`); otherwise
 * an `allow` whose content is the annotation XML plus the user's own text, so
 * `freezeMessage({ ...message, content })` keeps the message identity/source
 * and the annotation lands as part of one ordinary user message.
 * @param map - the session → annotation XML store.
 * @param sessionId - the claiming agent's session identity.
 * @param message - the claimed user message.
 * @returns the decision, or undefined to pass through unchanged.
 */
export function injectDecision(
  map: ReadonlyMap<string, string>,
  sessionId: string,
  message: TextBlocks,
): PromptDecision | undefined {
  const xml = getAnnotation(map, sessionId)
  if (xml === undefined || xml.trim() === '') return undefined
  return {
    kind: 'allow',
    content: [{ type: 'text', text: `${xml}\n${concatUserText(message.content)}` }],
  }
}

/**
 * Read a request body up to `maxBytes`; rejects beyond the cap. Shared by the
 * proxy route (MAX_BODY) and the annotations route (MAX_ANNOTATION_BODY).
 * @param req - the incoming request.
 * @param maxBytes - the body size cap.
 * @returns the body string, or undefined when empty.
 */
export async function readRequestBody(req: IncomingMessage, maxBytes: number): Promise<string | undefined> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > maxBytes) throw new Error(`body exceeds ${maxBytes} bytes`)
    chunks.push(buffer)
  }
  return chunks.length === 0 ? undefined : Buffer.concat(chunks).toString('utf8')
}
