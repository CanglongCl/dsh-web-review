# Harness 0812 npm type restoration follow-up

## Why this follow-up exists

Harness tag `snapshot-20260812T172954Z-final-unwatermarked-5fa48343c7` renamed the client command package and several public services:

- `@deepseek-ai/dsh-client-ui-command` → `@deepseek-ai/dsh-client-ui-commands`
- `ctx.command` / `CommandServiceContract` → `ctx.commandUi` / `CommandUiContract`
- `ctx.httpServer` → `ctx.webServer`
- `SkillService` → `SkillRegistry`

The private npm `0.0.1-rc.2` artifacts do not yet match that tag. The plural commands package is absent, while the published single-name commands package and the Skill/WebServer declarations still expose the old contracts.

The plugin therefore temporarily declares only the structural faces it consumes:

- `CommandUiRegistrar` in `src/client/index.ts`
- `SkillLookup` in `src/annotation-context.ts`
- `WebServerRegistrar` in `src/index.ts`

The runtime manifest still injects `@deepseek-ai/dsh-client-ui-commands`, and the real 0812 Harness E2E remains the authoritative runtime proof. Never alias the published singular commands package to the plural id: its API and client manifest are the old contract.

## Restoration trigger

Restore official types when the private registry contains artifacts whose manifests and declarations match the reviewed Harness baseline. At minimum, this command must succeed and the package must export `CommandUiContract` from `./client`:

```sh
npm view @deepseek-ai/dsh-client-ui-commands version
```

The corresponding Skill and WebServer packages must also expose `SkillRegistry` and `ctx.webServer` before removing their local structural faces.

## Restoration steps

1. Pin the aligned `@deepseek-ai/dsh-client-ui-commands` version in `packages/dsh-web-review/package.json` and `scripts/check.ts`.
2. Replace `CommandUiRegistrar` with an `import type { CommandUiContract }` from the plural package.
3. Replace `SkillLookup` and `WebServerRegistrar` with the aligned official types when available.
4. Refresh `pnpm-lock.yaml` from the private registry; do not add `link:`, `file:`, npm aliases, or machine-local paths.
5. Run `pnpm check --e2e` against the exact reviewed Harness checkout.
6. Keep the runtime manifest on the plural package and retain the checks that reject 0811 public names.

This follow-up is complete only after the local structural faces are gone and both the npm-only gate and real Harness E2E pass with the official declarations.
