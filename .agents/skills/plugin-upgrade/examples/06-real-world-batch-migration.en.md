# Example 06: Real-World Batch Migration of Six Plugins (0.1.1-rc.1 → 0.1.2-alpha.1)

English | [简体中文](06-real-world-batch-migration.md)

**Scenario**: Six published Web UI plugins (pixel pet / progress bar / input history / minigame collection / paste input / file tracing) batch-migrated from `dsh-v0.1.1-rc.1` to `dsh-v0.1.2-alpha.1`. All three typical shapes are covered: the snapshot-reading + slot-registering heavy type, the self-contained-DOM zero-cost type, and the declaration-cleanup-only minimal type.

**Touchpoints**: #3 client imports (`dsh-client-runtime` removal), snapshot reads (`ConversationSnapshot` → views), slot registration (`ctx.slots.inject`), `package.json` `dsh.client.inject` declarations

**Complexity**: ⭐⭐⭐

**Plane**: primarily Web Client (type imports / snapshot reads / slot registration / packaging declarations); no host API migration — only a note on how host-half changes take effect (see Error 6)

**Sources**: Community migration practice (migration completed 2026-08-28, verified by real boot + unit-test regression) — [deepseek-harness discussion #5120](https://github.com/deepseek-ai/deepseek-harness/discussions/5120#discussioncomment-18208001); the six plugin repositories are listed at the bottom.

> Corridor coverage note: the corridor now covers `dsh-v0.1.1-rc.1 → dsh-v0.1.2-alpha.2` (when this example was written the rc.1 → rc.2 segment had no cards; it was later filled by [v0.1.1-rc.2.md](../references/v0.1.1-rc.2.md), 3 cards, `DSH-0.1.1-R2` prefix). The technical claims in this example (client-runtime removal, `ctx.slots.inject`, `views.get('chat')?.legacy`, etc.) were first-hand sources at the time of writing; the closest existing card is DSH-0.1.2-A1-03 · 会话视图工程大幅拆分 (session-view engineering split).

---

## Migration Result Overview

| Plugin | Shape | Effort | Actual change |
|---|---|---|---|
| dsh-ui-whale v0.3.4→v0.3.5 | snapshot + slot | medium | 8 files +141/−99: type imports, `legacy` projection, slot registration |
| dsh-ui-progress v0.9.3→v0.9.4 | snapshot + slot | medium | same as above + turn-end detection moved to the new timeline |
| dsh-input-history v0.1.3→v0.1.4 | snapshot | medium | snapshot fields moved to `legacy` |
| dsh-minigames v0.3.5→v0.3.7 | self-contained body portal | ≈0 | just re-ran 203 unit tests + live verification |
| dsh-paste-input v0.1.5→v0.1.6 | vanilla lib (no src/) | small | removed the deleted `dsh-client-runtime` declaration from `dsh.client.inject` |
| dsh-file-trace | written directly on 0.1.2 | — | usable as a positive sample of the 0.1.2 APIs |

**Classify your plugin before starting**: self-contained DOM plugins cost nearly nothing — don't put yourself through the heavy-type workflow.

---

## Before

```typescript
// src/client/index.ts (0.1.1-rc.1)
import type { Context as ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'

export function apply(ctx: ClientContext): void {
  ctx.slots.register(
    { name: 'conversation.session.header.actions', id: 'whale', order: 10 },
    WhalePet,
  )
}
```

```typescript
// WhalePet.tsx — old flat snapshot fields
const { nodes, partial, runningCalls, turnEnds } = conversationSnapshot
```

```json
// package.json
{
  "dsh": {
    "client": {
      "platform": "web",
      "inject": ["dsh-client-runtime", "dsh-client-ui-chat"]
    }
  },
  "devDependencies": {
    "@deepseek-ai/dsh-client-runtime": "link:../.dsh/source/0811/packages/client/runtime"
  }
}
```

---

## After

```typescript
// src/client/index.ts (0.1.2-alpha.1)
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
// ctx.slots types come from the renderer package — remember to add it to devDependencies
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'

export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register(
    { name: 'conversation.session.header.actions', id: 'whale', order: 10 },
    WhalePet,
  ))
}
```

```typescript
// WhalePet.tsx — move everything to the legacy projection first (step one of a two-step plan)
const chat = conversationSnapshot.views.get('chat')
const { nodes, partial, runningCalls } = chat?.legacy ?? EMPTY_PROJECTION
// Turn timeline now lives at chat?.timeline; lifecycle fields (running etc.) move to the useSession seat
```

```json
// package.json — clean the deleted package out of inject; repoint the devDeps link
{
  "dsh": {
    "client": {
      "platform": "web",
      "inject": ["dsh-client-ui-chat"]
    }
  },
  "devDependencies": {
    "@deepseek-ai/dsh-client-ui-renderer": "link:../.dsh/source/current/packages/client/ui-renderer"
  }
}
```

---

## Migration Steps

1. **Environment**: 0.1.2-alpha.1 is not on npm (latest is 0.1.1-rc.2) — check out the source, `pnpm install && pnpm run build`; point the `~/.dsh/source/current` junction at the checkout and link plugin devDeps through it. Back up `~/.dsh` before touching anything.
2. **Replace type imports globally**: `dsh-client-runtime/client` → `@deepseek-ai/cordis`; delete the old declaration from `dsh.client.inject` and devDependencies (a leftover fails boot with a missing-service error).
3. **Snapshot reads via views**: all old flat fields read through `views.get('chat')?.legacy` — move everything to legacy first so it runs, then migrate field by field to views/timeline once stable.
4. **Lifecycle split**: `running` and friends go through the `useSession` seat; component props combine `useSession` + `useConversation`.
5. Slot registration becomes `ctx.slots.inject(name, () => ctx.slots.register(...))`; pull in `@deepseek-ai/dsh-client-ui-renderer/client` for the `ctx.slots` types.
6. `pnpm run clean && pnpm run build && pnpm run typecheck && pnpm run test` — the clean is mandatory, see pitfall 1.
7. **Live verification**: `dsh --profile web` + browser hard refresh; restart dsh if the host half changed (client half only needs a hard refresh). Then declare the compatibility matrix in the README (keep old rows, annotated per DSH version) and cut a new tag.

---

## Verification

```sh
# leftover-reference check
grep -r "dsh-client-runtime" src/ package.json
# expected: no output (vanilla-lib plugins should also grep lib/)

# clean build + full checks
pnpm run clean && pnpm run build && pnpm run typecheck && pnpm run test

# live boot verification: start dsh --profile web, hard-refresh the browser,
# and confirm plugin UI renders, snapshot data (streaming/tool state) is non-empty, slots land correctly
```

Verification records from this migration: all six plugins passed same-day live boot verification; minigames 203 unit tests green; whale/progress 34/39 unit tests green.

---

## Common Errors

### Error 1: typecheck reports unrelated old errors (e.g. `MISSING_EXPORT resolveSessionPreset`)

**Cause**: stale incremental tsbuildinfo — source changed but the check was fooled by the old cache.

**Fix**: `pnpm run clean` and rebuild. Clean before every verification pass during a migration.

### Error 2: boot fails with a missing-service error, yet nothing references `dsh-client-runtime` in code

**Cause**: a leftover declaration in `package.json` `dsh.client.inject`.

**Fix**: grep package.json, not just src/.

### Error 3: cryptic parse errors during build like "Did you mean {'>'}"

**Cause**: the oxc/vite parser is stricter than tsc — unclosed tags, or a ternary with an arrow function spanning lines, both blow up.

**Fix**: rewrite the expression as the parser suggests (precompute variables, split statements); don't fight it.

### Error 4: test files fail to compile after the migration

**Cause**: in 0.1.2 fiber `dispose` became readonly (tests can no longer assign it to simulate); `as` assertions in test files are unsupported on the JSX parse path.

**Fix**: observe readonly fields indirectly; replace `as` with pre-narrowed variables.

### Error 5: plugin install on a fresh environment fails with build-scripts-blocked errors (node-pty etc.)

**Cause**: pnpm 11 blocks dependency build scripts by default.

**Fix**: run `pnpm approve-builds --all` in the profile directory (worth documenting in the plugin README).

### Error 6: code changes don't show after a refresh, or the host behaves like the old version

**Cause**: the client half takes effect on a hard refresh, the host half requires a dsh restart.

**Fix**: check where the change landed: into `lib/index.js` (host) → restart; only `lib/client.js` → hard refresh.

---

## Appendix: robustness advice for the alpha phase

Wrap the client `apply` in a compatibility self-check (probe key capabilities like `ctx.slots.inject` / `ctx.locale.register`; render a remediation banner instead of throwing). DSH/plugin version mismatches are frequent during alphas — this turns "black-screen crash" into "one readable upgrade hint". All six plugins here ship it.

## Plugin Repositories

- https://github.com/lhh010/dsh-ui-whale (migrated at v0.3.5)
- https://github.com/lhh010/dsh-ui-progress (v0.9.4)
- https://github.com/lhh010/dsh-input-history (v0.1.4)
- https://github.com/lhh010/dsh-minigames (v0.3.7)
- https://github.com/lhh010/dsh-paste-input (v0.1.6)
- https://github.com/lhh010/dsh-file-trace (written on 0.1.2-alpha.1)
