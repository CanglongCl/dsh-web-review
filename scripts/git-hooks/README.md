# Git hooks

`core.hooksPath` points here (set by the `prepare` npm script, which pnpm runs
after `pnpm install`). If hooks are missing, re-run:

```bash
pnpm prepare:hooks
```

- `pre-commit` — the fast quality gate: typecheck, unit tests, and
  gen-config idempotence (the committed `cordis.yml` / `entry-name.json`
  must regenerate unchanged). The browser e2e suite is not part of the
  commit gate — run `pnpm test:e2e` explicitly for UI changes.
