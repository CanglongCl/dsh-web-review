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

# Full run (real model): filter by task/category/difficulty/fixture,
# 4-6-way concurrency, resumable via eval/results/results.jsonl
DSH_HARNESS=<abs harness root> pnpm eval:run [-- --task react-operations-01 --arm all --repeat 3 --concurrency 3]

# Single-file HTML report with per-task process detail
pnpm eval:report
```

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

## Per-run artifacts

`.artifacts/eval-runs/<taskId>-<ts>/` holds `workspace/` (the agent's cwd),
`session.jsonl` (DSH's own durable session log — turns, steps, reasoning
chunks, tool calls, per-step token usage), `trace.md`, `process.json`,
`diff.txt`, `grader` evidence, and the launch stdout/stderr. The report
embeds the trace, diff, and grader outcomes per task.
