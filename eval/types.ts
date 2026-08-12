/**
 * Shared types for the eval suite: the task bank, capture specs, grader
 * assertions, run records, and process statistics. Kept dependency-free so
 * every eval script and the runner plugin can import it.
 */

export type FixtureName =
  | 'landing' | 'forms'
  | 'react-todo' | 'react-shop' | 'react-dashboard' | 'react-profile'
  | 'vue-blog' | 'vue-kanban' | 'vue-chat' | 'vue-settings'

export type FixtureKind = 'static' | 'react' | 'vue'

export type Category =
  | 'text' | 'color' | 'typography' | 'size' | 'spacing' | 'layout'
  | 'interaction' | 'accessibility' | 'effects' | 'batch' | 'responsive' | 'anchor'

export type Difficulty = 'easy' | 'medium' | 'hard'

/** One inspector edit driven through the real property controls at capture time. */
export interface AdjustAction {
  /** Editable CSS property, or 'text' for direct text content. */
  property: string
  /** User-entered after value (e.g. '#224466', '24px', 'Reviewed magic UI'). */
  after: string
}

/** Inputs the capture tool consumes to produce the frozen real snapshot. */
export interface CaptureSpec {
  /** Selector clicked in pick mode. */
  target: string
  /** Annotation comment text. */
  comment: string
  /** Inspector edits, in application order. */
  adjusts?: AdjustAction[]
  /** UI optimization skills checked for this annotation. */
  selectedSkills?: string[]
}

/** Exact wire shape the browser POSTs to /webview-annotations (frozen capture). */
export interface FrozenSnapshot {
  sessionId: string
  selectedSkills: string[]
  page: { url: string; title: string }
  comments: unknown[]
}

export interface CaptureMeta {
  viewport: { width: number; height: number }
  /** Content hash of the fixture directory at capture time. */
  fixtureRevision: string
  pluginCommit: string
  harnessCommit: string
  capturedAt: string
}

/** A rendered-DOM assertion executed against the fixture dev server. */
export interface DomAssertion {
  kind: 'dom'
  selector: string
  /** Computed-style expectations; numeric values compare with tolerance. */
  style?: Record<string, string>
  /** Exact textContent expectation. */
  text?: string
  /** Attribute expectation. */
  attr?: { name: string; value: string }
  /** Accessible-name expectation (aria-label / label[for] / aria-labelledby). */
  accessibleName?: string
  /** Implicit/explicit ARIA role expectation. */
  role?: string
  /** Perform :hover before asserting style. */
  hover?: boolean
  /** Move focus before asserting style. */
  focus?: boolean
  /** Viewport for this assertion (defaults to 1680x1000). */
  viewport?: { width: number; height: number }
  /** Numeric style tolerance in CSS px (default 0.5). */
  tolerance?: number
  /** Assert the check against EVERY matching element (batch tasks). */
  all?: boolean
}

/** A source-code assertion executed against the workspace files. */
export interface CodeAssertion {
  kind: 'code'
  /** Workspace-relative file that must exist and contain every string. */
  file: string
  contains: string[]
}

export type Assertion = DomAssertion | CodeAssertion

export interface GraderSpec {
  pass: Assertion[]
  /** Untouched elements that must keep their current state. */
  noRegression?: Assertion[]
  /** Substrings that must NOT appear anywhere in the workspace. */
  negative?: string[]
}

export type GoldenPatch =
  | { kind: 'html-dir'; dir: string }
  | { kind: 'git-patch'; patchFile: string }

export interface EvalTask {
  id: string
  fixture: FixtureName
  fixtureKind: FixtureKind
  category: Category
  difficulty: Difficulty
  title: string
  /** Canonical user intent; also the headless positional argument. */
  instruction: string
  capture: CaptureSpec
  /** Frozen REAL capture produced by eval/capture.ts; never hand-authored. */
  snapshot: FrozenSnapshot | undefined
  captureMeta: CaptureMeta | undefined
  grader: GraderSpec
  golden: GoldenPatch
}

export interface ModelSelectionRecord {
  provider: string
  model: string
  reasoningEffort?: string
}

export interface TokenTotals {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning: number
  /** Number of steps whose adapter reported usage (coverage denominator). */
  stepsWithUsage: number
  /** Number of assistant steps (usage may be absent on some). */
  assistantSteps: number
}

export type RunStatus = 'pass' | 'fail' | 'timeout' | 'error'

export type FailureAttribution =
  | 'not-modified' | 'localization' | 'wrong-value' | 'timeout' | 'runtime-error' | 'unknown'

/** One graded assertion outcome with evidence. */
export interface GraderOutcome {
  pass: boolean
  attribution: FailureAttribution
  results: {
    assertion: unknown
    ok: boolean
    expected: string
    measured: string
  }[]
  screenshot?: string
}

export interface ProcessStats {
  turns: number
  steps: number
  toolCalls: Record<string, number>
  errorResults: number
  /** Step index of the first tool call (1-based; undefined when none). */
  firstToolCallStep?: number
  /** Step index of the first write-ish tool call (fs write or bash). */
  firstWriteStep?: number
  /** Distinct files read, derived from fs tool arguments when parseable. */
  filesRead: string[]
  tokens: TokenTotals
  perStepTokens: { step: number; input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number }[]
  reasoningChars: number
  finalText: string
  endReason: string
  durationMs: number
}

export interface RunRecord {
  taskId: string
  fixture: FixtureName
  fixtureKind: FixtureKind
  category: Category
  difficulty: Difficulty
  title: string
  status: RunStatus
  attribution?: FailureAttribution
  grader?: GraderOutcome
  process?: ProcessStats
  model: ModelSelectionRecord
  durationMs: number
  startedAt: string
  exitCode: number | null
  modifiedFiles: string[]
  runDir: string
  repoCommit: string
  harnessCommit: string
}
