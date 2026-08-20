# Better-sidebar integration: register the dsh-web-review preview tab when `ctx.betterSidebar` is detected

## Outcome

When the third-party `dsh-better-sidebar` plugin (or a fork such as
`@starpivot/dsh-better-sidebar`) is installed and its client service
`ctx.betterSidebar` is live, dsh-web-review registers its own tab
(`dsh-web-review:preview`) into the sidebar's `+` menu. While that tab is
live:

- the `conversation.view` contribution (`webview`, order 20) yields — the
  preview surface lives in the sidebar instead of the conversation pane;
- the `conversation.input.dock` annotation strip stays registered unchanged
  and shares the **same per-session engine instance** as the sidebar tab;
- assistant-link delegation routes HTTP(S) links from assistant steps into
  the sidebar tab instead of activating the conversation pane tab.

When the sidebar service is absent, behavior is byte-identical to today: the
view tab and dock work exactly as before, and **the web boot never depends on
the sidebar's presence** (no inject coupling, no PENDING fiber, no
"did not activate" sweep failure).

The integration is additive shell work only. The isolated Preview transport
(random Origin + HTML rewriting + bridge annotation), the node-half routes,
the snapshot pipeline, and the `agent/pre-step` context path are untouched.

## Research evidence

### What dsh-better-sidebar is (npm/GitHub, 2026-08)

- Upstream repo `omdsh-dev/DSH-better-sidebar` (formerly `dsh-external/`),
  MIT. npm name `dsh-better-sidebar`; a fork publishes
  `@starpivot/dsh-better-sidebar` (0.13.5), and a loader-API transcription
  `@dsh-plugin/dsh-better-sidebar-loader` exists.
- VS Code-like right sidebar + bottom panel workbench: explorer/editor,
  terminal (xterm + node-pty), Git, subagents, embedded browser, diff.
  Service-first: its client half runs `ctx.provide('betterSidebar', service)`
  at the top of `apply`; third-party plugins call
  `ctx.betterSidebar.registerTab(...)` / `registerFileViewer(...)` and get a
  disposer. Service is **client-only** (their
  `docs/external-plugin-guide.md`, their `AGENTS.md`).
- Extension point surface we need (their `AGENTS.md`, v0.12+): `registerTab`
  (`id`, `title: string | (() => string)`, `icon`, `order`, `single`,
  `createTab`, `urlTarget` (v0.13.0+, gated by
  `features.includes('urlTarget')`), `onOpen/onActivate/onClose`,
  `component: (props: TabComponentProps) => ReactNode`), `openTab`,
  `getTab`, `isTabEnabled`, `version` + `features` capability probe.
  `TabComponentProps` = `{ ctx, store, scope: { sessionId, cwd? }, tab,
  visible, ... }`. Built-in tab ids (`explorer|git|subagent|terminal|browser|
  editor|diff`) are reserved; external ids must be prefixed
  (`dsh-web-review:preview`).
- Tab mount semantics: the tab component **stays mounted** when inactive;
  `visible` (`true` only when it is the active tab and the panel is open) is
  the documented performance gate. Whether the whole panel (and with it our
  tab/iframe) unmounts when the sidebar panel is closed must be verified in a
  spike (their store persists layout; the portal may unmount).

### DSH version coupling (the review baseline is npm `0.1.0-rc.8`)

Verified from npm registry peerDependencies:

| package version | DSH peers | verdict |
|---|---|---|
| `dsh-better-sidebar` 0.14.x (npm `latest`) | `@deepseek-ai/*` `^0.1.0-rc.8` | **compatible with our rc.8 baseline** (recommended; `urlTarget` v0.13.0+ built in) |
| `dsh-better-sidebar` 0.13.1+ | `^0.1.0-rc.7` | satisfied by an rc.8 tree (`^rc.7` includes rc.8); not the tested line |
| `dsh-better-sidebar` 0.12.x–0.13.0 | `^0.1.0-rc.6` | satisfied by an rc.8 tree; not the tested line |
| `@starpivot/dsh-better-sidebar` 0.13.5 | `^0.1.0-rc.6` | fork; satisfied by an rc.8 tree, not the tested line |
| `@dsh-plugin/dsh-better-sidebar-loader` 0.13.0 | runtime via `ctx.dshLoader` (`@dsh-plugin/dsh-loader`) | our 0812 runtime has no `dshLoader` service — not considered |

Install guidance for users: on the rc.8 harness install
`dsh-better-sidebar@latest` (0.14.0, rc.8 peers). Older 0.13.x/0.12.x lines also
resolve against an rc.8 tree but are not the tested combination. This pairing
note goes into the README.

### Boot coupling: never declare `betterSidebar` in our client `inject`

- Cordis 4 (the `@deepseek-ai/cordis` in our tree) treats `inject` entries as
  hard requirements: a fiber whose injected service is never provided stays
  `PENDING` forever (fiber.ts `_checkImpl`/`_refresh`).
- The 0812 shell kernel (`packages/client/web/src/boot.tsx`,
  `assertEntriesActive`) then **fails the whole web boot**: `web boot: N
  entries did not activate … pending (waiting for service: betterSidebar)`.
- Therefore the sidebar integration must be a **runtime capability probe**,
  never a fiber inject. Cordis exposes exactly the right primitive:
  `ctx.get(name)` reads a provided service without the inject requirement
  (reflect.ts; `ClientContext = Context` from `@deepseek-ai/cordis`, so it is
  typed on our client context).
- The remaining question is timing: entry creation is concurrent and
  activation order is fiber-inject determined, so the sidebar's fiber may
  activate before or after ours. Cordis emits `internal/status(fiber,
  oldState)` for every fiber state transition on the context chain — a
  watcher on it (plus an initial probe at apply time) covers both orders and
  also detects the service **disappearing** (fiber → INACTIVE, disposer runs
  on `ctx.provide` unregister), which is how we restore the view tab on
  plugin disable/HMR.

### The store-sharing constraint (why the dock/view wiring must change)

- Slot framework store axis: one engine instance per `handle × scopeKey`,
  created by the framework at outlet resolution and cached privately in
  `SlotRegistry._stores` (`slots.d.ts`: `resolveStore`/`storeOf` are
  private; the public `SlotRegistry` surface exposes no store access).
- Slot components receive the store only as props (`useStore` selector hook +
  baked `actions`); the inject factory receives `(sessionId, actions)` — the
  baked write face only, never the engine.
- `EngineStoreHandle.create(scopeKey)` deliberately does not dedupe
  (`store.d.ts` JSDoc: "Instance uniqueness per key is the caller's
  responsibility").
- Consequence: a foreign render context (our sidebar tab, rendered by
  better-sidebar's own framework) **cannot reach the framework's per-session
  webview engine**, and calling `create()` again would yield a second,
  divergent instance — the dock capsule and the sidebar tab would show
  different picks. The slot axis is documented as constructively private
  ("cross-plugin sharing is constructively impossible"), and reaching into
  `ctx.slots` internals is forbidden by our own AGENTS.md ("nothing reaches
  into another package's store").
- Therefore the plugin must own its own per-session engine axis and thread
  the engine to slot components through the inject face (see Design).

### What the sidebar cannot replace (transport stays ours)

The sidebar's built-in browser tab renders pages in an opaque-origin sandbox
(no `allow-same-origin`, no cookie forwarding, address bar rejects
`localhost` etc.) and its `/sidebar/html` route serves workspace files only —
there is no injection point for our `bridge.js`, so element picking, live
style/text adjustment, and snapshot capture cannot run inside it. This
integration registers a **new tab type that hosts our existing Preview
transport**; it never reuses their browser tab.

### Link-click overlap

Both plugins claim HTTP(S) links in the chat: our dock owns a document
capture-phase listener over `[data-chat-flow-kind="assistant-step"]` anchors;
the sidebar has its own interception (`browserInterceptLinks` + protocol
switches, their settings) that first consults registered `urlTarget`
predicates (their v0.13.0+). Coordination design below.

## Design

### 1. Detection and lifecycle (`src/client/sidebar/detect.ts`)

New module, wired inside `apply`:

- At apply time: `const service = ctx.get('betterSidebar')` (typed cast to
  `BetterSidebarService | undefined`). If present, engage immediately.
- Subscribe `ctx.on('internal/status', (fiber, oldState) => …)`: on any
  ACTIVE transition probe `ctx.get('betterSidebar')`; on the first hit engage
  the integration; on the service's providing fiber going INACTIVE
  disengage. Stop watching after the app-shell entry
  (`APP_SHELL_ID` from the shell kernel) reaches ACTIVE and the service was
  never found (boot quiesced — the sidebar is not installed).
- Engagement/ disengagement are plain disposers inside `ctx.effect` so HMR
  and fiber unload stay safe. Engagement performs (a) the view-tab swap,
  (b) the sidebar tab registration, (c) the delegation reroute. This module
  is the single seam that touches `ctx.get`/`internal/status`; everything
  else receives plain values.
- Spike item: confirm `internal/status` is observable by plugin fibers on
  the client context chain (it is a typed cordis event; the kernel itself
  consumes loader status, but the event path needs a real-composition check
  before Phase 1).

### 2. Plugin-owned per-session engine axis (`src/client/stores.ts` + inject faces)

The one non-additive change, and the smallest one that makes the sidebar tab
and the dock share state:

- `apply` keeps constructing the handle once (`const webviewStore =
  createWebviewStore()`).
- A new module-private registry (`src/client/webview-session-store.ts`,
  constructed inside `apply`, never module-level) owns the per-session axis:
  `instanceFor(sessionId) → EngineStoreInstance` — creates via
  `webviewStore.create(sessionId)` on first touch, caches, prunes on session
  teardown (spike: exact session-scope teardown signal — the sessions service
  calls `slots.pruneStoreScope` on scope death; we need our own equivalent
  hook, fallback: prune from the dock entry's per-session disposer).
- The dock and view registrations **drop the `store:` seat** and receive the
  engine through the inject factory instead (this is what makes the axis
  reachable by foreign renders):
  - inject factories run per `entry × session` inside the outlet and receive
    `sessionId`; they call `instanceFor(sessionId)` and return the face with
    a reserved `hooks` compartment:
    `hooks: { webviewStore: instance.store }` (a bare `ObservableSnapshot`:
    `getSnapshot`/`subscribe` — the renderer binds it into a
    `useWebviewStore` selector hook on the component's props) plus the
    session-bound callbacks as today (the injected faces are built from the
    engine's baked actions where they currently use `actions.*`).
  - `WebviewSlotProps`/dock props change from `PropsStore<WebviewStore>` to
    the inject-derived `useWebviewStore` + actions shape. Component specs
    already feed `useStore`/`actions` as plain props, so the specs keep
    working with the new names.
- Rule amendment (own AGENTS.md, "UI discipline"): per-session engine
  creation inside inject factories is the sanctioned path for foreign-render
  sharing — it mirrors the framework's own `resolveStore` path; the
  module-level handle ban and the actions-only mutation surface stay.

### 3. Sidebar tab registration (`src/client/sidebar/tab.ts` + `SidebarPreviewTab.tsx`)

`ctx.betterSidebar.registerTab` descriptor, inside `ctx.effect`:

- `id: 'dsh-web-review:preview'` (prefix required; no collision with
  built-ins).
- `title: () => t('sidebar.tab')` (locale thunk; new `webview` keys in
  `locales.ts`).
- `icon`: small inline SVG (external-link/globe; our client bundle is
  self-contained, no icon dependency).
- `order: 60` (after built-in `browser` 50), `single: true`.
- `component: SidebarPreviewTab` — the designated foreign seam: receives
  `{ ctx, scope, tab, visible }`, resolves the engine via
  `instanceFor(scope.sessionId)` (from the apply-closure registry), builds
  the same props the view registration used to supply (engine-derived
  `useWebviewStore` + actions + the session-bound injected face, sharing the
  exact factory closures with the dock so `syncAnnotations`, preview-session
  lifecycle, and snapshot upload behave identically), and renders the same
  surface components as `WebviewView` (URL row, annotation toolbar, host
  editor, send). It is the one component allowed to touch the registry; the
  underlying surface components stay pure props components.
- `visible === false` is a render gate only (matching the harness view-ring
  behavior); iframe disposal still happens through our own session lifecycle
  as today.
- `urlTarget: (url) => …` — registered only when
  `features.includes('urlTarget')` (their v0.13.0+); predicate mirrors the
  delegation rule: credential-free absolute HTTP(S) URLs. Their handler then
  routes intercepted chat links to our tab with `openTab({ type,
  'dsh-web-review:preview', url, title })`; our tab displays the store URL
  (store remains the source of truth; `tab.path` is their bookkeeping).
- `onOpen/onActivate`: no-ops in v1 (state is store-driven; the store already
  survives tab swaps). `onClose`: keep the session's preview session open
  (the dock may still show the capsule); document.

### 4. View-tab swap

- While the sidebar integration is engaged, dispose the
  `ctx.slots.inject('conversation.view', …)` contribution (it is already a
  disposer inside `ctx.effect`); restore it when the service disappears.
- Result: exactly one preview surface per session per user world; no two
  live iframes for the same session; the conversation pane keeps the Chat
  tab.
- The dock registration is **never** swapped — it is the collaboration seam
  (always-mounted listener, send detection, link delegation) and its engine
  is now the shared axis.

### 5. Assistant-link delegation reroute (`src/client/preview-link.ts`, dock `openPreview`)

- Sidebar engaged: `openPreview` (and the delegation path) write the store
  exactly as today (normalize URL, clear stale picks, close Details), then
  call `betterSidebar.openTab({ type: 'dsh-web-review:preview', title: … })`
  instead of `activateConversationTab`. No conversation-pane tab activation.
- Sidebar absent: current behavior unchanged.
- Both handlers may fire when their interception is enabled and our
  `urlTarget` is registered; because the tab is `single: true`, the second
  open only focuses the same tab — no duplicate tabs. E2E asserts exactly
  one tab and one store URL.
- Known degraded combination (documented, not fixed in v1): sidebar
  installed but with their link interception disabled → our listener still
  routes to the sidebar tab (its own `openTab` call), so links keep
  working.

### 6. Package, gates, and docs

- `packages/dsh-web-review/package.json`:
  - `peerDependencies`: `"dsh-better-sidebar": ">=0.12.0"` and
    `"@starpivot/dsh-better-sidebar": ">=0.12.0"` with
    `peerDependenciesMeta.optional: true` for both (the service name
    `betterSidebar` is identical across the two packages; either satisfies
    the integration). Broad ranges on purpose: runtime behavior is
    feature-gated, so future rc.8-sidebar versions keep working; the rc
    pairing guidance lives in the README, not in semver.
  - `devDependencies`: `dsh-better-sidebar@0.14.0` (rc.8-line, npm `latest`) for its
    published types via the `./client/service` subpath (their client type
    graph is claimed Node-free). Known install side effects to accept:
    their full dependency tree (CodeMirror, node-pty …) lands in our
    lockfile; pnpm blocks node-pty build scripts (harmless — types only);
    their `cordis` peer is auto-installed by pnpm (inert for our build).
    Fallback if the gate complains: vendor a minimal
    `src/client/better-sidebar.d.ts` module stub (we use a small surface)
    and drop the devDependency.
  - The official staging manifest/allowlist is untouched (peers and
    devDeps never ship; `pnpm check` allowlist gate unaffected).
- README: install pairing (`dsh-better-sidebar@0.14.0` on the rc.8 harness;
  do not follow older rc.6/rc.7 lines on an rc.8 tree), feature
  description, and Known Limitations additions (link-interception interplay;
  sidebar tab is the preview surface while engaged; the sidebar's own
  browser tab remains sandboxed and unrelated to our transport).
- AGENTS.md: the engine-axis rule amendment and a short "Sidebar
  integration" section (detection seam, swap rule, delegation routing).

## Phases

### Phase 0 — Spikes (before any implementation)

> Status: completed 2026-08-20. Spike findings: (1) `internal/status` is
> observable from plugin fibers (typed cordis event; tests drive it through
> the untyped emit surface); (2) tab mount semantics: tabs stay mounted
> while inactive, unmount with the panel — the iframe/session lifecycle
> behaves like the view ring; (3) the session teardown signal is the live
> `sessions.list` subscription (no dedicated dispose event); (4) `single:
> true` dedupes both-handlers-firing on `openTab`; (5) the bare `cordis`
> Context in the sidebar declaration graph does not carry DSH members — the
> wrapper narrows it to `ClientContext` at the seam, and the test runtime
> stub (`tests/support/runtime-client.ts`) has no `.store` key, so the
> observable source is the engine itself, not `engine.store`.

1. `internal/status` observability from a plugin fiber on the client context
   chain (real composition in the E2E scaffold).
2. Sidebar tab mount semantics: does the tab (and our iframe) unmount when
   the panel closes / another tab activates; does `visible` alone gate it.
3. Session-teardown signal for the engine registry (event name or the dock
   entry's per-session disposal).
4. `openTab` with `single` + our `urlTarget` under both-handlers-firing
   (their interception enabled and disabled).
5. Typecheck with `dsh-better-sidebar@0.13.0` types in our build
   (`./client/service` resolution, `cordis` peer, skipLibCheck behavior).

### Phase 1 — Types, detection, engine axis

> Status: done (commit a49ba8d).

- Add devDependency + peer entries (or the type stub fallback).
- `webview-session-store.ts` registry; dock/view registrations move to
  inject-derived `useWebviewStore` + actions; component props updated;
  `locales.ts` keys added.
- `sidebar/detect.ts` watcher + engagement/disengagement disposers.
- Unit/component tests: detection watcher against a real cordis context
  (provided service → engaged; absent → no registration, fiber ACTIVE in
  both cases); registry single-instance per session; dock/view/sidebar share
  one engine; component specs updated for the new props.

### Phase 2 — Sidebar tab surface

> Status: done (commit a49ba8d).

- `registerTab` descriptor + `SidebarPreviewTab` + view-tab swap.
- Delegation reroute (`openPreview` sidebar-aware).
- Component specs for the wrapper (fake `BetterSidebarService` recording
  registrations; assert id/title/order/single/urlTarget predicate and that
  the surface renders with the shared engine).

### Phase 3 — urlTarget claiming

> Status: done (commit a49ba8d); E2E verification pending.

- Register `urlTarget` when `features` include it; verify single-tab
  behavior in E2E; document the interception-off degraded combination.

### Phase 4 — E2E, docs, release

> Status: in progress — E2E scenarios and README update pending.

- Browser E2E additions (scratch profile installs
  `dsh-better-sidebar@0.13.0` + our overlay):
  1. sidebar mounts, our tab appears in the `+` menu, opens, preview iframe
     + bridge handshake + pick + comment + send loop with the dock capsule —
     full existing flow inside the sidebar tab;

   E2E installs `dsh-better-sidebar@0.14.0` into the scratch profile (rc.8
   peers match the rc.8 harness);
  2. assistant link click routes into the sidebar tab (no conversation-tab
     activation), exactly one tab;
  3. negative: sidebar absent → existing scenarios already cover the
     unchanged path;
  4. version pairing guard: assert the profile resolved the pinned
     `dsh-better-sidebar@0.14.0` (cheap `package.json` assertion in the
     scaffold).
- README + AGENTS.md updates; `pnpm check` and `pnpm check --e2e` green.

## Risks and open questions

- **Cordis `cordis` peer auto-install** adds a module to our tree that the
  harness itself does not use; mitigated by `skipLibCheck` and the type
  subpath import, verified in spike 5.
- **Their fast release cadence** (rc.6 → rc.7 → rc.8 within days): our
  integration is feature-detected and peer ranges are broad, so sidebar
  upgrades do not break our client; only the rc-pairing guidance can rot.
  The E2E pin keeps the tested combination stable.
- **Double handlers / interception settings**: designed for single-tab
  behavior; E2E asserts it; the settings-off case is documented.
- **Engine-axis refactor blast radius**: contained to two registrations and
  two component prop types; the store-factory rule amendment is explicit and
  tested by the component specs (which keep calling
  `createWebviewStore().create()` directly).
- **Tab path bookkeeping**: `tab.path` may carry the first URL while the
  store carries a newer one; display always reads the store — acceptable and
  documented.
- **Sandboxed browser equivalence**: nothing from the sidebar's own browser
  tab is reused; its limitations (no cookies, no annotation) remain theirs.

## Non-goals

- No host-half changes, no route changes, no bridge changes, no
  annotation-context changes.
- No reuse of their browser tab or their `/sidebar/*` API.
- No config flag in v1 (detection is automatic); a
  `sidebarPreviewEnabled` toggle is a future option if users ask.
- No support for the `@dsh-plugin/dsh-better-sidebar-loader` variant (our
  rc.8 runtime has no `ctx.dshLoader`).