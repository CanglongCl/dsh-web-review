# Eval suite

Local scenario bank plus runner/grader/report scripts measuring whether the
dsh-web-review annotation channel supplies the evidence a coding model needs.
The plugin-centered design is `docs/plugin-capability-eval-plan.md`; the
original broad frontend bank plan is retained as historical input in
`docs/frontend-eval-suite-plan.md`.

## Layout

- `tasks/` — the question bank (`*.ts` exports `task: EvalTask`) plus
  `frozen/` real-capture snapshots written by the capture tool.
- `fixtures/` — local fixture apps (pnpm workspace): `landing`, `forms`
  (static), `react-*` (Vite + React dev), `vue-*` (Vite + Vue 3 dev).
- `runner-plugin/` — self-contained Cordis plugin for the headless profile
  that reproduces the real web pre-step message set (skill injections +
  Browser comments) around the task instruction.
- `runner/`, `capture/`, `grader.ts`, `process-stats.ts`, `smoke.ts`,
  `report.ts` — orchestration, real-GUI capture, grading, session-log
  statistics, the bank integrity gate, and the HTML report.

## Commands

```sh
# Install fixture deps (once)
pnpm --dir eval/fixtures install

# Author-time capture through the REAL GUI (picker + inspector + wire POST);
# freezes the exact snapshot into tasks/frozen/<id>.snapshot.json
DSH_HARNESS=<abs harness root> pnpm eval:capture -- --task landing-01

# Bank integrity gate (LLM-free): baseline fails, golden passes;
# --capture adds live re-capture drift checks against the frozen snapshots
pnpm eval:smoke [-- --capture]

# Release/headline gate: real Preview GUI re-capture and frozen-wire drift check
DSH_HARNESS=<abs harness root> pnpm eval:verify-headline-captures

# Full run (real model): filter by task/category/difficulty/fixture,
# 4-6-way concurrency, resumable via .artifacts/eval-results/results.jsonl
DSH_HARNESS=<abs harness root> pnpm eval:run [-- --task react-operations-01 --arm all --repeat 3 --concurrency 3]

# Published production DSH instead of a Harness source checkout
pnpm eval:run -- --dsh-cli /opt/homebrew/bin/dsh --task react-operations-01 --arm all --repeat 3

# Single-file HTML report with per-task process detail + A/B comparison view
pnpm eval:report [-- --persist]

# Open one harvested transcript in the published DSH Web conversation UI.
# The input can be a run directory or its session.jsonl. Close the browser
# window (or press Ctrl-C) to stop the isolated viewer.
pnpm eval:view .artifacts/eval-runs/run-<uuid>

# Re-apply the current grader and process-stat parser to existing workspaces
# without spending model tokens, then regenerate the report
pnpm eval:regrade [-- react-operations-01 static-catalog-01]
pnpm eval:report
```

## Report archive (versioned reports)

`pnpm eval:report -- --persist` additionally writes the report into the
committed archive keyed by the measured repo commit:

```
eval/reports/<repoCommit>/
  report.html    # single-file HTML (A/B tab included)
  summary.json   # machine-readable aggregates per arm + model/commit metadata
```

The archive directory name is the `repoCommit` the eval runs measured
(`git rev-parse HEAD` at batch start), so every archived report is traceable
to the exact code state that produced it; `executionRevision` in the run
records still distinguishes uncommitted working-tree changes. Live run data
lives under `.artifacts/eval-results/` (gitignored) and is the only mutable
state; archived reports are immutable snapshots. To open an archived report,
serve `eval/reports/<commit>` over any static HTTP server.

Archived reports committed so far:

- `eval/reports/` — populated by `pnpm eval:report -- --persist` after a run.

Model defaults: `deepseek-official` / `deepseek-v4-flash` / reasoning `high`;
override with `EVAL_PROVIDER`, `EVAL_MODEL`, `EVAL_REASONING` or the
`--provider/--model/--reasoning` flags. Credentials resolve through the
product chain (environment → repo `.env` → `~/.dsh/.env` → staged
`~/.dsh/.credentials.yaml`); without any credential the run fails loudly.

Headline scenarios compare `full`, `text-only`, and `oracle` arms. All arms
use the same generic ordinary prompt; concrete requirements live only in real
plugin-generated annotation snapshots. Protocol-smoke scenarios declare only
the `full` arm. Historical one-comment task definitions are normalized at
load time: their duplicated `instruction` is ignored, while their real frozen
snapshot becomes a generic-prompt round. The smoke gate also validates every
snapshot with the production parser and checks fixture revision, comment order,
and selected skills before grading.

The `snapshot` arm is the pageSnapshotEnabled on/off A/B and is available for
EVERY task with frozen captures: it keeps the full production context and
additionally injects the production-identical page snapshot guide
(`agent.inject` ordering) pointing at a per-run staged archive with the real
frozen `page.html`, `page.png`, and `manifest.json`. The capture tool
freezes those page artifacts (cleaned HTML tree + full-page screenshot)
alongside each snapshot. Compare it against `full` (off): the report's arm
comparison table aggregates passes, steps, tokens, duration, files read, and
tool calls per arm, and each run detail lists the model's explicit reads and
tool-call mix.

```sh
# A/B: snapshot off (full) vs on (snapshot) across the whole bank, interleaved
DSH_HARNESS=<abs harness root> pnpm eval:run -- --arm full,snapshot --repeat 3

# One task, one arm, three repeats
DSH_HARNESS=<abs harness root> pnpm eval:run -- --task react-todo-01 --arm snapshot --repeat 3
```

The Full/Text-only comparison is blinded at the model boundary: both primary
messages use the production plugin source and `# Browser comments` heading,
and neither the cwd nor artifact directory exposes task, arm, or repetition.
Oracle is an explicit ceiling and may include a separately sourced hint.
Model workspaces are staged under an OS temporary directory so parent
repository `AGENTS.md` files cannot contaminate prompts; the finished
workspace is copied into the durable artifact only after the run.

## Per-run artifacts

`.artifacts/eval-runs/run-<uuid>/` holds the persisted final `workspace/`,
`session.jsonl` (DSH's own durable session log — turns, steps, reasoning
chunks, tool calls, per-step token usage), `trace.md`, `process.json`,
`diff.txt`, `grader` evidence, and the launch stdout/stderr. The report
embeds the trace, diff, and grader outcomes per task.
The generated report uses Chinese UI copy. Each run links directly to its
persisted Harness `session.jsonl` conversation log, provides a copyable
`pnpm eval:view` command for opening it in the published DSH Web conversation
UI, and shows the durable session id. The viewer stages a disposable copy in
the current JSONL storage layout and uses an isolated DSH home, so opening a
historical run neither mutates the evidence nor pollutes ordinary DSH sessions.
The headline separates three-arm plugin diagnosis from Full-only protocol
smoke. Historical runs created before blinding/isolation remain visible but
are excluded from the causal aggregate.

Long-task graders assert user-visible intent rather than one golden
implementation: natural-language whitespace is tolerated, semantic danger
colors are accepted by color family, and a left accent may be implemented as
a border, inset shadow, or pseudo-element. Exact values remain exact only when
the annotation requested them. Missing selectors are ordinary failed
assertions, not grader runtime errors.
Adversarial grader tests reject transparent shadows, permanent fake focus
states, overlapping-card coverage tricks, and accessible names that are not
bound to the title in their own card.
