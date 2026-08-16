/**
 * Shared types for the eval suite: the task bank, capture specs, grader
 * assertions, run records, and process statistics. Kept dependency-free so
 * every eval script and the runner plugin can import it.
 */

export type FixtureName =
  | 'landing' | 'forms' | 'static-catalog'
  | 'react-todo' | 'react-shop' | 'react-dashboard' | 'react-profile' | 'react-operations'
  | 'vue-blog' | 'vue-kanban' | 'vue-chat' | 'vue-settings'

export type FixtureKind = 'static' | 'react' | 'vue'

export type Category =
  | 'protocol-smoke' | 'multi-target' | 'scope-resolution' | 'anchor-fallback'
  | 'responsive' | 'semantics' | 'iterative' | 'tool-ownership' | 'trust'

/** Historical frontend taxonomy retained only while loading smoke tasks. */
export type LegacyFrontendCategory =
  | 'text' | 'accessibility' | 'color' | 'spacing' | 'layout'
  | 'interaction' | 'effects' | 'typography' | 'batch' | 'size' | 'anchor'

export type Difficulty = 'easy' | 'medium' | 'hard' | 'long'

/**
 * One controlled context condition for a plugin capability comparison.
 * 'snapshot' = full production context plus the archived page snapshot guide
 * (staged real page.html/page.png/manifest.json) — the pageSnapshotEnabled
 * on/off A/B arm; available for every task with a frozen snapshot.
 */
export type EvalArm = 'full' | 'text-only' | 'oracle' | 'snapshot'

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
  /** Viewport applied immediately before this target is picked. */
  viewport?: { width: number; height: number }
  /** Relative point used when the target is a container with child content. */
  targetPosition?: { xRatio: number; yRatio: number }
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
  /** Most recent real-GUI drift verification against this frozen wire body. */
  verifiedAt?: string
  verifiedPluginCommit?: string
  verifiedHarnessCommit?: string
}

/** One admitted browser-comment snapshot and ordinary user turn. */
export interface EvalRound {
  /** Ordinary composer message. Requirements belong in the annotations. */
  prompt: string
  /** Ordered targets captured into one production snapshot. */
  capture: CaptureSpec[]
  /** Frozen REAL capture produced by eval/capture.ts. */
  snapshot: FrozenSnapshot | undefined
  captureMeta: CaptureMeta | undefined
  /** Source-localization help used only by the oracle arm. */
  oracleContext?: string
  /** Assertions that must hold after this round in an iterative scenario. */
  afterRound?: Assertion[]
}

/** A rendered-DOM assertion executed against the fixture dev server. */
export interface DomAssertion {
  kind: 'dom'
  selector: string
  /** Computed-style expectations; numeric values compare with tolerance. */
  style?: Record<string, string>
  /** Require numeric computed styles to be strictly greater than the baseline values. */
  styleGreaterThan?: Record<string, string>
  /** Exact textContent expectation. */
  text?: string
  /** Attribute expectation. */
  attr?: { name: string; value: string }
  /** Attribute regular expression for semantically equivalent values. */
  attrPattern?: { name: string; pattern: string }
  /** Accessible-name expectation (aria-label / label[for] / aria-labelledby). */
  accessibleName?: string
  /** Accessible-name regular expression, e.g. optional natural-language whitespace. */
  accessibleNamePattern?: string
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
  /** Require these computed properties to differ from another element. */
  styleDiffersFrom?: { selector: string; properties: string[] }
  /** Require this element's color property to be perceptually darker than another element's. */
  colorDarkerThan?: { selector: string; property: string; minDelta?: number }
  /** Bound the perceived luminance of a computed color (0 black, 255 white). */
  colorLuminance?: { property: string; min?: number; max?: number; minAlpha?: number }
  /** Require one RGB channel to exceed the other two by this margin. */
  colorDominance?: { property: string; channel: 'red' | 'green' | 'blue'; margin?: number }
  /** Accept a visible red cue in background, foreground, or border for destructive actions. */
  dangerStyle?: { margin?: number }
  /** Require a computed shadow with enough visible extent and optional color character. */
  boxShadow?: { minExtentPx: number; minAlpha?: number; colorDominance?: 'red' | 'green' | 'blue'; margin?: number; requireFocusChange?: boolean }
  /** Require child boxes to span and align across the selected container. */
  horizontalCoverage?: { childSelector: string; minRatio: number; maxTopDeltaPx?: number }
  /** Require a centered element with an optional maximum rendered width. */
  centered?: { tolerancePx?: number; maxWidthPx?: number }
  /** Require the rendered number of child items in the first visual row. */
  itemsPerRow?: { childSelector: string; count: number; topTolerancePx?: number }
  /** Require the element to be rendered (true) or effectively hidden (false). */
  visible?: boolean
  doesNotOverlap?: string
  /** Build an accessible-name expectation from text in the nearest ancestor. */
  accessibleNameFromDescendant?: { ancestorSelector: string; descendantSelector: string; prefix: string }
  /** Accept border, inset shadow, or positioned pseudo-element as a left accent. */
  leftAccentColor?: string
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

export interface TokenBudget {
  /** Expected uncached input + output tokens for one run. */
  expected: number
  /** Emit a cost warning strictly above this value; never changes pass/fail. */
  warnAbove: number
}

export interface EvalTask {
  id: string
  fixture: FixtureName
  fixtureKind: FixtureKind
  category: Category | LegacyFrontendCategory
  difficulty: Difficulty
  title: string
  /** Optional task override; the registry supplies difficulty defaults. */
  tokenBudget?: TokenBudget
  /** Context conditions this scenario is designed to compare. */
  arms?: EvalArm[]
  /** Ordered turns sharing one agent and one staged workspace. */
  rounds?: EvalRound[]
  /** Legacy smoke-task fields, normalized by the registry and never sent verbatim. */
  instruction?: string
  capture?: CaptureSpec
  snapshot?: FrozenSnapshot | undefined
  captureMeta?: CaptureMeta | undefined
  grader: GraderSpec
  golden: GoldenPatch
}

/** Runtime task after the registry has normalized legacy smoke definitions. */
export interface LoadedEvalTask extends Omit<EvalTask, 'category' | 'arms' | 'rounds' | 'tokenBudget'> {
  category: Category
  arms: EvalArm[]
  rounds: EvalRound[]
  tokenBudget: TokenBudget
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
  /** Durable Harness session identifier from the persisted session header. */
  sessionId?: string
  turns: number
  steps: number
  toolCalls: Record<string, number>
  errorResults: number
  /** Step index of the first tool call (1-based; undefined when none). */
  firstToolCallStep?: number
  /** Step index of the first write-ish tool call (fs write or bash). */
  firstWriteStep?: number
  /** Distinct paths observed in explicit read-style tool arguments. */
  filesRead: string[]
  tokens: TokenTotals
  perStepTokens: { step: number; input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number }[]
  reasoningChars: number
  finalText: string
  endReason: string
  durationMs: number
}

export interface RunRecord {
  /** Explicit causal-use gate. Missing records are legacy; invalid records stay auditable. */
  diagnosticValidity?: 'eligible' | 'invalid'
  invalidReason?: string
  /** Immutable model-execution identity; regrading does not change it. */
  experimentId?: string
  taskRevision?: string
  executionRevision?: string
  graderRevision?: string
  gradedAt?: string
  /** First status recorded before any later regrade. */
  originalStatus?: RunStatus
  /** Whether the model session itself completed, independent of grading. */
  executionStatus?: 'completed' | 'timeout' | 'error'
  taskId: string
  fixture: FixtureName
  fixtureKind: FixtureKind
  category: Category
  difficulty: Difficulty
  title: string
  arm: EvalArm
  repetition: number
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
