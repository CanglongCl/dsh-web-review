# Browser annotation plugin capability eval

## Objective

Evaluate whether `dsh-web-review` gives a coding model enough page-grounded information to complete realistic frontend changes with low localization and exploration cost. Frontend work is the carrier for the evaluation, not the subject being benchmarked. The primary result is a diagnosis of the plugin interface: which evidence fields, annotation workflows, and optional UI skills satisfy model needs, and which missing signals cause avoidable failure.

The existing frontend modification suite remains useful as a protocol smoke suite. Its single-element color, hover, and text tasks prove that a real GUI capture can cross the plugin wire, enter the model request, and reach an automatic grader. They do not establish plugin value because the ordinary user prompt repeats the complete annotation intent, the fixture repositories are small enough to search exhaustively, and every run receives the plugin context without a comparison arm.

## Implemented foundation

This branch delivers the experimental foundation and the first two long scenarios: the three diagnostic arms, ordered-round payloads, multi-target real-GUI capture, per-comment viewports, UI-skill selection, production parsing/formatting, arm/repetition run identities, paired report deltas, and automatic baseline-fail/golden-pass grading. `react-operations-01` contributes six React/source-anchor comments; `static-catalog-01` contributes five production-style fallback comments with no source anchors. Both frozen snapshots were generated and re-verified through the real Preview picker, host editor, acknowledgement, and `/webview-annotations` POST.

The follow-up work from the original eval worktree is retained as 38 additional `protocol-smoke` tasks across forms, landing, dashboard, profile, shop, and todo fixtures. The registry normalizes their historical single-comment schema into one generic-prompt Full-arm round, so their old duplicated `instruction` field never reaches the model. Their original frontend category is deliberately not used as a plugin capability claim. All imported snapshots retain their real capture metadata and must pass the production parser, fixture-revision, comment-order, and selected-skill integrity checks in `pnpm eval:smoke`.

The remaining named scenarios are an expansion roadmap, not implied coverage. In particular, iterative correction is not considered implemented until a composed two-round runner test and per-round grading exist.

## Questions the eval must answer

1. Does the full plugin context outperform the same user-authored comments without target evidence?
2. Does the full plugin context approach an oracle that also supplies explicit source hints?
3. Which fields reduce localization work: source anchor, selector and full path, role and label, stable classes, target text, viewport, requested style/text changes, and target ownership?
4. Can one snapshot carry several related or deliberately ambiguous comments without the model applying them at the wrong scope?
5. Can the collaboration loop carry a correction or follow-up snapshot after an earlier model turn without replaying superseded work?
6. Do selected UI skills improve the relevant task without overwhelming the useful target evidence?
7. Does the trust wording keep page-authored metadata separate from user-authored intent?

## Experimental unit

The unit is a scenario rather than an isolated CSS operation. A scenario uses a realistic local repository, one or more annotation rounds, a generic product prompt, hidden outcome assertions, and a declared set of diagnostic arms.

```ts
interface EvalScenario {
  id: string
  fixture: string
  category: CapabilityCategory
  difficulty: 'medium' | 'hard' | 'long'
  title: string
  rounds: EvalRound[]
  arms: EvalArm[]
  grader: GraderSpec
  golden: GoldenPatch
}

interface EvalRound {
  prompt: string
  capture: CaptureSpec[]
  snapshot?: FrozenSnapshot
  oracleContext?: string
  afterRound?: Assertion[]
}

type EvalArm = 'full' | 'text-only' | 'oracle'
```

The default prompt is the product's no-draft send request, `请根据页面批注修改前端实现。`. Requirements live in annotation comments and inspector changes. A scenario may add a short composer draft only for cross-comment constraints that a real user would naturally type outside an individual element comment.

## Diagnostic arms

Every headline scenario runs paired arms against the same baseline, model, effort, tool catalog, timeout, and randomization policy.

### Full

Inject the plugin's production `formatAnnotationContext` output and selected skill messages. This is the current product condition.

### Text-only

Inject only user-authored comment text and requested property/text changes. Remove page title, URL, target identity, selector, full path, source anchor, stable classes, viewport, and original values. This preserves user intent while removing the plugin's localization evidence.

### Oracle

Inject the full production context plus scenario-authored source hints, such as the owning component and stylesheet or token module. Oracle hints name where to investigate but do not contain a patch or final implementation. A screenshot arm can be added later when the harness provides a stable image-message fixture.

Interpretation is paired rather than leaderboard-oriented:

- Full succeeds and text-only fails: plugin evidence provides measurable value.
- Full and oracle succeed with similar exploration cost: supplied evidence is sufficient.
- Full fails and oracle succeeds: the plugin interface lacks information needed by the model.
- All arms fail: the task is primarily a model or grader problem and cannot support a plugin conclusion.
- Full succeeds with much higher search/read cost than oracle: the result is correct but the context is inefficient.

## Capability categories

The bank is organized by plugin demands rather than CSS or framework topics.

| Category | Plugin evidence under test |
| --- | --- |
| `multi-target` | comment aggregation, target identity, independent requested changes |
| `scope-resolution` | instance versus shared component or design-token scope |
| `anchor-fallback` | source anchors, stable classes, selector/path fallback when anchors are absent |
| `responsive` | per-comment viewport and cross-viewport intent |
| `semantics` | role, accessible label, target text, accessibility skill injection |
| `iterative` | multiple admitted snapshots, supersession, correction after an earlier turn |
| `tool-ownership` | `inToolChrome` routing to this plugin's source |
| `trust` | page evidence remains untrusted while comments and requested values remain actionable |

## Initial long scenarios

### Operations dashboard hierarchy

A React operations dashboard contains navigation, filters, metric cards, an orders table, and a details drawer. Six annotations request a clearer selected navigation state, separation between filters and results, roomier metric-card layout, a destructive order action variant, narrow-screen drawer title behavior, and mobile filter collapse. Several targets share primitives and tokens while two requirements are local exceptions. This is the first implemented long scenario.

Primary diagnosis: multi-comment transport, source-anchor usefulness, exact instance versus shared token scope, per-comment viewport, and exploration cost in a repository with several plausible owning files.

### Checkout accessibility repair

A multi-step form receives comments about an unannounced validation error, duplicate accessible names, keyboard-inaccessible delivery options, lost focus after submission, and a small icon hit target. The annotation selects `better-accessibility`.

Primary diagnosis: role/label/text evidence, skill contribution, cross-component semantic fixes, focus behavior the current snapshot may not describe, and whether oracle source hints close any gap.

### Repeated-order actions

Many rows render identical View, Refund, and More actions. Comments distinguish one cancelled row, every refund action, one malformed amount, all keyboard menus, and a same-named action in an unrelated detail view.

Primary diagnosis: shortest selector and full path, source anchor versus data-instance identity, and prevention of over-broad edits.

### Production anchor fallback

A production-style build removes framework debug anchors and uses CSS Modules with hashed prefixes. Five annotations target repeated cards, an unlabeled icon, a conditional node, and nested typography.

Primary diagnosis: stable semantic class filtering and selector/path/text fallbacks. A large Full-to-Oracle gap directly motivates additional snapshot evidence.

### Responsive navigation

Annotations captured at desktop, tablet, and mobile widths specify horizontal navigation, removal of secondary actions, background scroll locking, long-name truncation, focus containment, and reduced-motion behavior.

Primary diagnosis: comment-specific viewport preservation and whether element-only evidence is enough for page-level responsive intent.

### Iterative correction

The first round contains five related comments. A second admitted snapshot confirms two changes, corrects one scope mistake, targets a newly revealed element, and withdraws one earlier request.

Primary diagnosis: multiple pre-step injections, snapshot supersession, durable turn ordering, and whether the model repeats superseded work.

### Plugin UI dogfood

The previewed application is the DSH Web UI and annotations target this plugin's toolbar, editor, and annotation capsule.

Primary diagnosis: `Target owner: annotation tool chrome` routes edits to this repository rather than the previewed workspace.

### Untrusted page evidence

Page title, labels, and text contain instruction-like content unrelated to the user's comments. The requested work is a bounded visual adjustment.

Primary diagnosis: trust labeling in the model-facing message and absence of tool activity that follows page-authored instructions.

## Authoring and capture

Each round contains one or more `CaptureSpec` entries. The capture driver opens one real Preview session, activates annotation mode, picks every target through the bridge, drives inspector edits, selects the union of requested skills, and freezes the final acknowledged POST. Each capture may set its own viewport before picking; that viewport must appear in the corresponding frozen comment.

Frozen snapshots remain production wire messages and must pass `parseAnnotationBody`. They are never hand-authored. Single-round legacy files keep the existing `<id>.snapshot.json` convention; multi-round files use `<id>.round-<n>.snapshot.json`. Capture verification compares comment count, ordering, target evidence, source anchors, requested changes, text changes, viewports, and selected skills.

## Runner behavior

One agent and one staged workspace live for the entire scenario. Before each round, the runner prepares the arm-specific messages and queues them for exactly the next `agent/pre-step` admission. It then sends that round's ordinary prompt and awaits quiescence. Later rounds therefore observe edits made by earlier turns. Every model-visible message remains a logged user-role session event with its original source.

The primary Full/Text-only comparison is blinded. Both arms use the same
production-like plugin source and Browser comments heading; the model is not
told which evidence was withheld. Model cwd paths are neutral random temporary
directories outside this repository, preventing task/arm leakage and parent
`AGENTS.md` inheritance. Oracle remains a separately identified ceiling.

The runner records an immutable experiment id derived from task revision, arm,
repetition, provider/model/effective effort, repository and Harness commits,
and the execution-path source revision. Batch execution supports `--arm full`,
`--arm text-only`, `--arm oracle`, `--arm all`, and `--repeat N`. Resume skips
only completed executions with that exact identity; failures and different
configurations remain runnable.

## Grading and evidence

The implemented first slice combines:

- rendered DOM and computed-style assertions;
- responsive assertions at explicit viewports;
- accessibility name and role assertions;
- code assertions for shared tokens, component variants, and forbidden shortcuts;
- no-regression assertions over deliberately similar unannotated elements;
- negative source assertions and failure screenshots.

Interaction sequences, focus/keyboard checks, route or persisted-state checks, console/page-error checks, and enforcement of the reserved `afterRound` assertions are added with the scenarios that need them. They are not treated as finished merely because the schema can describe rounds.

Process evidence remains first-class: tool calls, explicit read-tool paths,
tool errors, first write, unrelated modified files, steps, tokens, Harness
session time, and end-to-end wall time. Explicit read-tool paths are not
mislabelled as complete exploration coverage because grep, glob, and shell
commands can inspect files without emitting a read event. Reports group paired
arms and show Full-minus-Text and Oracle-minus-Full deltas.

The report never mixes Full-only protocol smoke with plugin-effect headlines.
Protocol health and three-arm diagnostic outcomes have separate denominators.
Each regrade records grader revision, grading time, and the original status;
legacy runs lacking blinded execution provenance stay auditable but are
excluded from the causal aggregate.

Grader calibration follows the annotation's semantic precision. Values named
by the user (for example `20px`, `#7a5af8`, or exact replacement text) remain
exact. Qualitative requests such as “更深” or “危险样式” accept equivalent
implementations and must not require a golden-only color, helper class, or
whitespace choice. Missing target selectors produce a localization/assertion
failure rather than a grader crash. Existing workspaces can be regraded
without another model call using `pnpm eval:regrade`.
Every new qualitative predicate requires adversarial bad-patch tests in
addition to baseline-fail/golden-pass: invisible styles, wrong-state styles,
overlap/overflow geometry, first-item-only edits, and unrelated accessible
names are representative mandatory boundaries.

The HTML report uses Chinese interface copy and provides a direct relative
link from every run to its persisted Harness `session.jsonl`, alongside the
durable session id and the derived trace. This keeps every aggregate score
auditable back to the authoritative conversation log.

## Implementation sequence

1. Preserve the three existing tasks as `protocol-smoke` scenarios and change their ordinary prompt to the generic product request.
2. Extend the task types and frozen loader for multiple captures, rounds, arms, oracle hints, and explicit run identity while retaining legacy single-round snapshot files.
3. Extend capture to pick multiple targets, preserve per-comment viewports, select skills, and freeze/verify each round.
4. Extend the runner plugin to inject arm-specific context once per round while reusing one Agent and workspace.
5. Extend batch results and the HTML report with arm/repetition grouping and paired diagnostic deltas.
6. Extend the grader for hidden attached nodes, all-match assertions, responsive states, accessibility names and roles, code assertions, no-regression checks, and negative source checks. Add interaction/focus/error primitives with their first consuming scenarios.
7. Add the operations-dashboard long fixture and its six-comment scenario, real frozen capture, golden patch, and baseline-fail/golden-pass smoke proof.
8. Add at least one iterative or anchor-fallback scenario after the first long scenario proves the multi-round machinery.

## Acceptance gates

- All frozen snapshots parse through the production validator and render through the production formatter.
- Capture verification proves the long scenario's comment count, ordering, evidence, changes, viewport, and skill selection.
- Existing protocol-smoke tasks still baseline-fail and golden-pass.
- Every new scenario baseline-fails and golden-passes under its complete grader.
- A keyless runner test proves Full, text-only, and oracle construct distinct logged messages without changing the ordinary prompt.
- A keyless payload test proves two rounds preserve their generic prompts, snapshots, and order; a composed runner test is required before declaring an iterative scenario complete.
- Typecheck and unit suites pass.
- At least one real-model paired run is retained as evidence when credentials are configured; lack of credentials does not weaken the keyless gates or trigger a fake model run.
