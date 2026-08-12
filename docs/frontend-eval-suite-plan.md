# Frontend modification capability eval suite

## Goal

Measure whether the dsh-web-review plugin's annotation channel helps an AI
complete frontend modification tasks **effectively and efficiently**. The suite
ships a local question bank (60 tasks) plus local runner/grader/report scripts
that execute the full plugin loop against a real model and produce an HTML
report with per-task results, process traces, and token statistics.

Decisions locked with the owner:

- **Single arm**: every task goes through the plugin annotation channel only.
- **60 tasks**: 20 static HTML/CSS, 20 React (Vite dev), 20 Vue (Vite dev).
- **Fully automatic grading**: rendered-DOM assertions for visual/interaction/
  responsive tasks, source-code assertions for structural/negative tasks.
- **Snapshots come from the real plugin pipeline** — never hand-authored.
  An authoring-time capture tool drives the real GUI (real picker, real
  inspector, real wire POST) and freezes the exact snapshot body into the
  question bank; the smoke gate re-captures and diffs to prove it stays true.
- **Headless runner**: `dsh --profile headless` with a self-contained
  `eval-runner` Cordis plugin that reproduces the exact model-facing message
  set the real web pre-step produces.
- **Model**: `deepseek-v4-flash`, reasoning effort `high`, configurable per
  run.
- **Process recording**: no custom instrumentation — copy DSH's own durable
  session JSONL log (lossless, includes tool calls, reasoning chunks, and
  per-step token usage) and derive statistics from it.
- **Final deliverable**: a single-file HTML report with run context, per-task
  outcomes, token/step statistics, and click-through detail pages showing the
  full process of every task.
- **Implementation fan-out**: the task bank is authored and verified through
  workflow-orchestrated subagents (see "Implementation via workflows").

## Measurement layers

1. **Result** — grader pass/fail plus failure attribution: not modified /
   wrong element (localization error) / wrong value / timeout / runtime error.
2. **Process** — the complete durable session log: turn/step boundaries,
   every user message with its `source`, assistant messages, raw stream chunks
   (including `reasoning-delta` thinking blocks), tool calls with raw
   arguments, tool results, todo writes, and the request header.
3. **Efficiency** — tokens per step (input/output/cache read/cache write/
   reasoning), step and turn counts, tool-call counts by name, first-write
   step, modified-file list, wall time, turn end reason. These quantify the
   "exploration cost": an insufficient plugin context shows up as many steps,
   repeated file reads, heavy search traffic, retries, and late first writes.

## Architecture

```
eval/tasks/*.ts                      question bank (capture inputs + frozen
                                     real snapshot + grader spec)
eval/fixtures/                       pnpm workspace: 2 static apps + 4 React
                                     + 4 Vue dev apps (baseline + golden)
   │
   ├─ authoring: eval/capture.ts     real-GUI capture tool (see below)
   │
   ├─ one run per task:
   ▼
eval/runner/run.ts                   copy fixture baseline → write per-run
                                     overlay → launch headless dsh (cwd=workspace)
   │  node <harness>/apps/cli/lib/bin.js --profile headless \
   │        --patch <runDir>/eval.cordis.yml "<instruction>"
   ▼
eval/runner/  (self-contained Cordis plugin, modeled on the harness
               headless-runner)      installModelSelection(configured model)
                                     agent.inject(skill injections) →
                                     agent.inject(Browser comments) →
                                     agent.followup(instruction)
   ▼
agent edits the workspace copy with the real tool catalog (bash / fs /
fs-search), then the process exits
   ▼
DSH persists the session automatically ($DSH_HOME/sessions/…/session.jsonl)
   ──copy──▶  runDir/session.jsonl
   ▼
eval/grader/                         dom assertions (headless Chromium against
                                     the fixture dev server) or code assertions
eval/process-stats.ts                parse session.jsonl → process.json +
                                     trace.md (tokens, calls, steps, timing)
   ▼
eval/report.ts                       results.jsonl + run dirs → report.html
```

## Snapshot capture pipeline (the "real click" guarantee)

The snapshot a task injects must be byte-identical to what the real plugin
would send for that click. Hand-writing `cssPath`/`label`/`before` values is
forbidden; instead the bank freezes real captures.

### Authoring-time capture tool (`eval/capture.ts`)

For each task the author provides only the **inputs**:

- `target`: selector used to click the element in pick mode;
- `comment`: the annotation comment text;
- `adjusts`: optional inspector edits (`property → after value`), driven
  through the real property controls;
- `selectedSkills`: optional skill checkboxes.

The tool then produces the frozen snapshot through the real pipeline:

1. Boot the real DSH Web GUI exactly like the e2e suite (isolated `DSH_HOME`,
   profile-local plugin alias, welcome-ack settings) and start the fixture's
   dev server (static server for HTML apps; Vite dev for framework apps — dev
   mode is what exposes fiber/Vue anchors).
2. Open the fixture page in Preview, enter pick mode, and click `target` —
   the real bridge picker runs, so `cssPath` comes from
   `css-selector-generator` and all metadata from the real capture code.
3. Fill the comment; for `adjusts`, drive the real inspector controls (color
   picker, number fields, presets) so `before` values are computed from the
   live baseline DOM and `after` values cross the real allowlist validation.
4. Intercept the browser's own `POST /webview-annotations`
   (`makeSyncAnnotations` posts `{ sessionId, ...draft }` — the exact wire
   shape the node half validates) with Playwright route interception and
   record the **last successful body** as the confirmed snapshot.
5. Freeze into the task file: the exact snapshot body plus capture meta
   (capture viewport, fixture revision, plugin commit, DSH commit).

Capture runs at a fixed viewport (1680×1000) and English locale so geometry
and computed values are deterministic.

### Smoke re-validation (bank integrity, no LLM)

The smoke gate runs the capture tool in **verify mode**: re-capture against
the current baseline and diff the live snapshot against the frozen one —
structural fields must match exactly, `before` values must equal current
computed styles, framework anchors must still resolve. A stale bank fails
loudly. The same gate asserts baseline fails and golden passes for the
grader, so every task is proven true on three axes before any paid run.

## Question bank (60 tasks)

Category × fixture-family distribution:

| Category            | Static | React | Vue | Total |
| ------------------- | -----: | ----: | --: | ----: |
| Text / writing      | 4      | 2     | 2   | 8     |
| Color               | 4      | 2     | 2   | 8     |
| Typography          | 3      | 2     | 2   | 7     |
| Size                | —      | 2     | 2   | 4     |
| Spacing             | 3      | 2     | 2   | 7     |
| Layout              | 2      | 2     | 2   | 6     |
| Interaction states  | —      | 2     | 2   | 4     |
| Accessibility       | 1      | 1     | 1   | 3     |
| Border/radius/shadow| 2      | 1     | 1   | 4     |
| Multi-element batch | 1      | 2     | 2   | 5     |
| Responsive          | —      | 1     | 1   | 2     |
| Source-anchor focus | —      | 1     | 1   | 2     |
| **Total**           | **20** | **20** | **20** | **60** |

Difficulty: 12 easy / 34 medium / 14 hard. Hard tasks concentrate on the
plugin's differentiators: ambiguous targets (two similar buttons, change only
one — the picked selector resolves what prose cannot), multi-element batches,
media queries, and framework source anchors.

### Task file shape (TypeScript)

```ts
interface EvalTask {
  id: string                     // 'landing-01'
  fixture: FixtureName           // 'landing' | 'forms' | 'react-todo' | …
  category: Category
  difficulty: 'easy' | 'medium' | 'hard'
  title: string
  /** Canonical user intent; also the headless positional argument. */
  instruction: string
  /** Capture inputs consumed by eval/capture.ts. */
  capture: {
    target: string               // selector clicked in pick mode
    comment: string              // annotation comment (usually = instruction)
    adjusts?: { property: EditableStyleProperty; after: string }[]
    selectedSkills?: UiSkillName[]
  }
  /**
   * Frozen REAL capture: the exact POST body of /webview-annotations produced
   * by the plugin for the click above (validated by parseAnnotationBody,
   * rendered by formatAnnotationContext). Written by eval/capture.ts, never
   * by hand.
   */
  snapshot: AnnotationSnapshot   // { sessionId, selectedSkills, page, comments }
  captureMeta: {
    viewport: { width: number; height: number }
    fixtureRevision: string      // fixture dir content hash at capture time
    pluginCommit: string
    harnessCommit: string
  }
  grader: {
    pass: Assertion[]            // dom or code assertions
    noRegression?: Assertion[]   // untouched elements must not change
    negative?: string[]          // e.g. '!important' must not appear
  }
  /** Golden patch: static apps point at golden HTML; Vite apps at a git patch. */
  golden: GoldenPatch
}
```

### Example tasks

```ts
// landing-01 · color · easy
{
  id: 'landing-01', fixture: 'landing', category: 'color', difficulty: 'easy',
  title: 'Darken the primary button',
  instruction: '把首页主按钮的背景颜色改深一点，改成 #224466',
  capture: {
    target: 'button.btn-primary',
    comment: '把首页主按钮的背景颜色改深一点，改成 #224466',
    adjusts: [{ property: 'background-color', after: '#224466' }],
  },
  // snapshot + captureMeta frozen by eval/capture.ts
  grader: {
    pass: [{ selector: 'button.btn-primary', style: { 'background-color': '#224466' } }],
    noRegression: [{ selector: 'button.btn-ghost', style: { 'background-color': '#eef0f3' } }],
  },
}

// forms-07 · accessibility · medium
{
  instruction: '给顶部搜索输入框补上可访问名称"搜索"',
  capture: { target: 'input[type="search"]', comment: '给顶部搜索输入框补上可访问名称"搜索"' },
  grader: { pass: [{ selector: 'input[type="search"]', accessibleName: '搜索' }] },
}

// react-todo-05 · interaction · hard (hover state + source anchor)
{
  instruction: '让侧边栏列表项在鼠标悬停时背景高亮为 #eef2ff',
  capture: { target: 'li.nav-item', comment: '让侧边栏列表项在鼠标悬停时背景高亮为 #eef2ff' },
  grader: { pass: [{ selector: 'li.nav-item', hover: true, style: { 'background-color': '#eef2ff' } }] },
}
```

## Fixture apps (10, all local)

`eval/fixtures/` is a pnpm workspace:

- `landing`, `forms` — plain HTML/CSS/JS, zero deps, 10 tasks each. Served by a
  static server (the `demo/server.ts` pattern).
- `react-todo`, `react-shop`, `react-dashboard`, `react-profile` — Vite +
  React dev mode, 5 tasks each. Dev mode is required: fiber `_debugSource`
  powers the `Source:` anchor in the captured snapshot.
- `vue-blog`, `vue-kanban`, `vue-chat`, `vue-settings` — Vite + Vue 3 dev
  mode, 5 tasks each (`__vueParentComponent.type.__file` anchors).

One `pnpm install` at the fixtures root serves every Vite app. Each run copies
a clean baseline into `.artifacts/eval-runs/<taskId>/workspace` (Vite apps
symlink the shared fixtures `node_modules`); the agent's cwd is that copy, so
tool effects stay inside the workspace. Golden states: static apps keep a
golden HTML variant; Vite apps keep a git patch.

## Grader

Small standalone tool (~100 lines, `playwright` is already a dev dependency).
Runs directly against the fixture dev server — never through the plugin proxy.

- **dom assertions**: computed style with numeric tolerance (the browser
  normalizes color/unit equivalents, so `#224466` / `rgb(34,68,102)` /
  `var(--primary-600)` all pass when correct), textContent, attributes /
  ARIA / accessible name, post-interaction state (hover/focus), viewport-
  scoped checks for responsive tasks.
- **code assertions**: file-content/structural checks for mechanism and
  negative requirements (e.g. must use a CSS variable, must not use
  `!important`).
- Every task carries no-regression assertions; failures record evidence
  (screenshot, measured values, workspace diff).

## Runner (headless dsh)

### Per-run overlay (written by the runner into the run dir)

```yaml
- id: headless-runner
  disabled: true
- insert:
    - id: dsh-web-review-eval-runner
      name: '@dsh-web-review-dev/eval-runner'
      config: { taskJson: '<single-quoted task JSON>' }
- id: session-persistence-jsonl
  config:
    root: <runDir>/sessions        # known absolute path, no !!js needed
    packChunks: false
    compression: none
- id: approval
  config: { policy: never }        # headless has no UI to answer approval asks
- id: telemetry-otel
  disabled: true
```

### eval-runner plugin (self-contained, tsdown-bundled like the main plugin)

Modeled on the harness `headless-runner`
(`packages/bundle/headless/src/index.ts`), with the message set and model
selection replaced:

1. Read `taskJson`; validate the frozen snapshot with the **real
   `parseAnnotationBody`** and render the **real `formatAnnotationContext`**
   (imported from the plugin source and inlined by tsdown).
2. `agent.inject()` the selected skill messages (source
   `{ kind: 'skill-invocation', name, form: 'instructions' }`, content =
   `renderSkillContent` over the plugin's bundled skill markdown), then the
   Browser comments message (source
   `{ kind: 'plugin', plugin: 'dsh-web-review', snapshotId }`), then the
   loaded-skill reminder. `inject` queues context for the next pre-step
   without waking the driver — the same mechanism the real web flow relies
   on, so the message set, order, and sources are byte-identical to a real
   annotated send.
3. `agent.followup(instruction)` wakes the driver; the step claims the queued
   injections plus the instruction in one turn.
4. Await quiescence, flush the session, print the final assistant text,
   exit with the turn outcome as the status code.

### Model configuration

The runner installs its own selection through `installModelSelection`
(verified API: `ModelSelection = { provider, model, reasoningEffort? }`;
explicit effort is applied to request config, absent effort falls back to the
provider default):

- **Defaults**: provider `deepseek`, model `deepseek-v4-flash`, reasoning
  effort `high` (ids verified against the llm-deepseek registry).
- **Configurable**: per-run via the overlay's runner config
  (`provider` / `model` / `reasoningEffort`), populated from
  `EVAL_PROVIDER` / `EVAL_MODEL` / `EVAL_REASONING` environment variables or
  `eval:run` flags.
- The resolved selection is recorded in every result row and shown in the
  report header, so runs across models stay comparable.

### Launch environment

- Command: `node <harness>/apps/cli/lib/bin.js --profile headless --patch
  <overlay> "<instruction>"` with cwd = workspace copy and an isolated
  `DSH_HOME` under the run dir (never the user's profile).
- `DSH_TOOLS_MODE=native` (P1 verifies the composed tool catalog matches the
  Web GUI via `--dump-config`).
- Provider credentials follow the product chain (inherited environment →
  repo `.env` → `~/.dsh/.env` → copy `~/.dsh/.credentials.yaml` with mode
  `0600`); **without any credential the run fails loudly — no dead-endpoint
  fake runs**.
- Per-task timeout (default 300s) → SIGTERM grace 10s → SIGKILL; free-port
  probing; `--filter` by category/difficulty/fixture/id; resume by skipping
  existing run dirs; 4–6-way concurrency.

## Process recording and token statistics

No custom instrumentation. DSH's `dsh-base` composition already mounts
`session-persistence-jsonl` and checkpoints before every model request
(`session-checkpoint-policy`); the headless runner additionally flushes on
exit. The overlay switches the row to `compression: none` +
`packChunks: false`, so the persisted log is one JSON event per line and
plain-parseable.

Derived artifacts per run:

| Artifact | Content |
| --- | --- |
| `session.jsonl` | Raw evidence, copied verbatim from the isolated DSH home. Contains `turn/start`, `turn/end` (reason), `step/start`, `step/end`, `user/message` (with `source`), `assistant/chunk` (raw stream incl. `reasoning-delta` thinking), `assistant/message` (with `usage`), `tool/call` (name + raw arguments), `tool/result` (result/error/meta), `todo/write`, `request/header`. |
| `process.json` | Structured stats: token totals `{ input, output, cacheRead, cacheWrite, reasoning }` plus per-step/turn breakdown and cache-hit rate; tool-call counts by name; error-result count; **localization cost** (step of first tool call, step of first file write, modified files); reasoning volume; wall time (first `turn/start` → last `turn/end`); final answer and end reason. |
| `trace.md` | Human-readable folded trace: per turn/step the assistant text, reasoning summary, and each tool call with truncated results (oversized results spill to side files). |

Token accounting comes from each step's `assistant/message.usage`
(input/output/cacheRead/cacheWrite/reasoning tokens are disjoint). Adapters
that report no usage are recorded as `absent` with chunk-character fallback;
the report states the coverage.

"Context insufficiency" signals aggregated per category: high step/tool-call
counts, repeated reads of the same files, search traffic, failed tool results
and retries, and late first writes — the numbers behind the user's core
concern.

## HTML report (final deliverable)

`eval/report.ts` aggregates `results.jsonl` plus per-run artifacts into one
**single-file `eval/results/report.html`** — a static template with the data
embedded as JSON and vanilla-JS rendering, so it opens from `file://` with no
server and can be archived or shared as one artifact. Relative evidence
(screenshots, diffs) is referenced from sibling run directories.

- **Overview header**: run context — model/provider/reasoning effort,
  harness commit, repo commit, run started/finished, total wall time, task
  count, pass rate, and the **total token ledger** (input / output / cache
  read / cache write / reasoning, plus billed-token total and cache-hit
  rate).
- **Aggregates**: pass-rate tables by category × difficulty and by fixture
  family; efficiency distributions (median and p90 of steps, tool calls,
  tokens, first-write step, wall time) with an "exploration cost" section
  that surfaces the heaviest searches and repeated reads.
- **Task grid**: one card per task — id, title, category, difficulty, status
  badge (pass / fail / timeout / error), duration, tokens, steps, tool calls,
  first-write step, and failure attribution when failed.
- **Detail page per task** (click-through, hash-routed): the exact injected
  context (rendered Browser comments and skill content, as the model saw
  it), the full turn/step timeline, assistant text, **thinking/reasoning
  blocks**, every tool call with arguments and result (expandable,
  truncated with full view), per-step token usage, modified files with the
  workspace diff, grader outcome with evidence screenshot and measured-vs-
  expected values, and the final answer.
- Filters (category / difficulty / fixture / status) and sortable columns.

## Results artifacts

- `eval/results/results.jsonl`: one record per task run — grader outcome and
  evidence, process-stats summary, model selection, duration, exit code.
- `eval/results/report.html`: the single-file report above.
- Failure attribution (automatic classification with evidence): not modified /
  localization error (wrong element or file; no-regression hits) / wrong value
  (right target, wrong outcome) / timeout / runtime error.

## Relationship to existing assets

- The browser e2e suite keeps guarding transport fidelity (click → snapshot →
  injection). The capture tool **reuses that same real pipeline** to freeze
  bank snapshots, and the suite measures capability; no overlap in goals.
- No harness modification and no plugin-body modification. The eval-runner is
  a separate small package that reuses the profile-local alias loading model
  (`materializeProfilePluginLink` gains a headless-profile variant).
- Repository conventions hold: everything TypeScript, scripts run via tsx and
  join `tsconfig.scripts.json`, artifacts (`eval/results/`,
  `.artifacts/eval-runs/`, fixture `node_modules`) stay gitignored, the
  question bank and scripts are committed (local by design).
- Commands: `pnpm eval:capture`, `pnpm eval:smoke`, `pnpm eval:run`,
  `pnpm eval:report`. Smoke is fast and LLM-free; runs stay out of the
  pre-commit hook.
- **Cross-calibration**: 1–3 tasks also run through the real GUI end-to-end
  (the e2e drivers) and are compared against the headless run for grader
  outcome and process shape, keeping the headless mock honest.

## Implementation via workflows

The build is fanned out through workflow-orchestrated subagents (the owner
requested this explicitly). The workflow scripts only coordinate; subagents
own all filesystem work.

- **W0 — machinery (main agent, sequential)**: eval-runner plugin, runner,
  per-run overlay, capture tool, grader DSL, process-stats, report generator,
  and 2–3 pilot tasks (one per family) proven end to end — capture through
  the real GUI, headless run with a real model, session copy, statistics,
  and a report stub. This gate defines the authoring guide W1 consumes.
- **W1 — bank authoring (workflow, one subagent per fixture app)**: each of
  the 10 apps gets a subagent with the app, its category/difficulty quotas,
  and the authoring guide. Each agent authors baseline + golden + task specs,
  runs `eval/capture.ts` for its tasks (sequential per app — capture needs
  the GUI), and runs smoke on its own tasks. Structured result: task list,
  capture status, smoke status, issues.
- **W2 — adversarial verification (workflow, reviewer per app)**: fresh
  reviewers re-run smoke and check instruction clarity, golden validity,
  grader robustness, and capture meta freshness; issues go back to the
  authoring phase once.
- **W3 — full run + report (runner script + final review)**: the batch runner
  executes all 60 tasks with 4–6-way concurrency (plain scripts, not
  workflow agents), report generation follows, and the final report is
  reviewed against the measurement questions before delivery.

## Delivery phases

- **P1 — skeleton proven end to end**: W0 scope plus the HTML report
  generator and model configuration; one full headless run with
  `deepseek-v4-flash` / high effort, token statistics, and report output.
- **P2 — bank complete**: W1 + W2; all 60 tasks authored through the real
  capture tool and green under smoke; `pnpm eval:*` scripted.
- **P3 — full run**: W3; fixed model, 1 run per task to start (3 for
  headline tasks), full HTML report, and a distilled "context insufficiency"
  issue list to feed back into plugin improvements.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Snapshot drift from the real pipeline | Frozen captures only; smoke re-captures and diffs against the bank; capture meta (fixture hash, commits) tracked per task |
| Capture nondeterminism (computed styles, geometry) | Fixed viewport and locale; verify-mode diff uses exact structural match plus computed-value tolerance |
| Some adapters report no token usage | Record `absent` + chunk fallback; state coverage in the report |
| Overlay row shapes drift with harness updates | P1 verifies with `--dump-config`; rows use known absolute paths |
| Model nondeterminism | Pin model + effort per run, record both plus commits; repeat headline tasks |
| Headless mock drifts from the real channel | Cross-calibration runs; smoke proves the frozen snapshot still matches a live capture |
| Vite port/dependency friction | Free-port probing; shared fixtures node_modules + symlinks |
| Interrupted runs leave partial logs | Request-boundary checkpoints + runner flush; SIGTERM before SIGKILL |
| Workflow fan-out quality variance | W2 adversarial review loop; pilot tasks fix the authoring guide before fan-out |
