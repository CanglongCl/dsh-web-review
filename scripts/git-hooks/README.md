# Git hooks

`core.hooksPath` points here (set by the `prepare` npm script, which pnpm runs
after `pnpm install`). If hooks are missing, re-run:

```bash
pnpm prepare:hooks
```

- `pre-commit` — the fast quality gate: typecheck, unit tests, and
  gen-config idempotence (the gitignored `cordis.yml` / `entry-name.json`
  must remain unchanged across consecutive regeneration). The browser E2E suite is not part of the
  commit gate — run it with an explicit `DSH_HARNESS` checkout for UI changes.
