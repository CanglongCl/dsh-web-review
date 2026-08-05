# AGENTS.md — ui-webview (webview panel + element annotation)

Rules for the ui-webview plugin: the webui's right-side page-preview panel, in-iframe element selection and commenting, and the AI collaboration loop that turns annotations into workspace source edits.

**This plugin lives OUTSIDE the harness checkout** — it is developed in the user's own repo (limao-magic-ui) and loaded into a `dsh web` instance by a launch overlay, with zero modifications to the deepseek-harness source tree. The relevant upstream contracts: [packages/client/AGENTS.md](../../../deepseek-harness/packages/client/AGENTS.md), the [slot system standard](../../../deepseek-harness/.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md), and the repo-wide [conventions](../../../deepseek-harness/AGENTS.md#conventions) — read them before touching slots, stores, or inject faces. (Path note: when this file moves into a harness checkout, rewrite the `deepseek-harness`-anchored links as relative paths.)

## Loading model (why the entry name is an absolute path)

- `dsh web` boots `base.cordis.yml` (apps/cli/config) as the root include; the web overlay and the `--config` file are flattened patch lists applied to that one include level. The Loader resolves entry names against `ctx.baseUrl` = the boot config's directory (apps/cli/config), and client-modules (the browser-bundle table) resolves package manifests with `createRequire(ctx.baseUrl)` from the same anchor.
- An external package is therefore reachable ONLY through an **absolute-path entry name**: both the Loader's `internal.import` and `require.resolve(<name>/package.json)` treat absolute paths as self-resolving, independent of baseUrl. Relative names, workspace: deps, and nested includes all fail somewhere in this chain — do not "simplify" the absolute path.
- The entry name points at the package **directory**, and the package root carries a thin `index.js` re-export (`export * from './lib/index.js'`): Node/tsx ESM has no directory resolution, and the loader's resolver tries `<dir>/index.<ext>` — without the root entry the load fails with `ERR_MODULE_NOT_FOUND` on `index.json`. The directory form is what keeps `require.resolve(<name>/package.json)` (client-modules' manifest scan) working — a file-path entry would break that scan.
- The launch overlay (`cordis.yml`) inserts one row: `- insert: - { id: ui-webview, name: <absolute path to this package> }`. The **tsdown client-bundle banner id must equal the entry name** (`__ModuleLoader__.load({ id: ... })` is checked against the boot-graph row id by `arrive()`); the tsdown config reads it from `process.env.DSH_ENTRY_NAME` so the yaml stays the single source of truth.
- The node half must stay **runtime-import-free** (type-only imports only; services reached through `ctx`, fetch is a builtin): the Loader imports the external package from its own directory, which must not require a local node_modules. Any new runtime dependency is a load-order regression — justify it.
- HMR: the repo's `pnpm run dev:web` watch scans only harness `packages/*/*`; the external bundle is watched by the package's OWN tsdown watch (`pnpm run dev:watch`). `dsh web --dev` host polls the bundle files it serves and broadcasts rebuilt frames regardless of who rewrote them.

## Scope and ownership

- **One dual-face package.** The node half (`src/index.ts`) is the host-side `/webview-proxy` route; the browser half (`src/client/`) is the panel UI, the picker injection, and the send path. The node half is NOT a generic fetch gateway — it exists only to make iframe content same-origin so the picker can reach the DOM.
- **Plugin export shape:** named exports `name` / `inject` / `Config` (when present) / `apply`, no default export — a default export makes the Loader discard the namespace (upstream postmortem 0001).
- **The panel is a floating overlay on the right edge**, mounted from an existing free slot (the conversation header's `conversation.session.header.actions` list hosts the toggle button — it is always mounted while a session is current, so the panel and the link interceptor survive view switches). The harness shell (ui-layout) is NOT modified: no new slot, no column changes. The overlay is `position: fixed` (portal to document.body), owns its width (drag-resize) and close state in the plugin store, and carries `data-webview-ui` on its root.
- Cross-plugin panel control goes through the plugin's own store and the `ctx.layout` service only where already offered (`closeDetails`); nothing reaches into another package's store or registers into a slot it did not declare.
- **Product copy is Chinese; code comments, JSDoc, and this file are English** (upstream convention). The annotation message template is product copy — pin it verbatim in `format.ts` and the locale file, never restate it in components.

## Proxy contract (`/webview-proxy`)

- **Request shape:** `GET /webview-proxy/<path-encoded target>` — the target URL is percent-encoded with `/` kept raw (`encodeTarget`), NOT a query parameter: a query-string base would break relative resolution through the injected `<base>` (relative references replace the base's query). Unparseable or non-http(s) targets → 400. Server-side `fetch` with redirect-follow, ~15s timeout, 10MB response cap. No browser cookies: login-gated pages are the direct mode's job, not the proxy's.
- **HTML responses:** strip `content-security-policy`, `content-security-policy-report-only`, `x-frame-options`; inject `<base href="/webview-proxy/<path-encoded page directory>/">` as the first `<head>` child (this makes every relative URL in the document — including script `fetch('x')` — resolve through the proxy); rewrite absolute AND root-relative http(s) URLs in `href | src | action | srcset | poster | data-src` attributes (single- and double-quoted forms) to proxy URLs (root-relative refs do NOT resolve against `<base>` paths, so they must be rewritten); leave `javascript:` / `mailto:` / `data:` / `tel:` / `blob:` / `file:` / `#` / `?` / plain-relative values untouched. `<form action>` is rewritten for GET and POST; POST forwards the body. `Accept: text/html` navigation to any proxied path fetches the target URL verbatim, so an SPA dev server's fallback serves its index.html through the proxy.
- **Non-HTML responses** (js/css/images) pass through with the target's content-type, no rewriting beyond the CSP/XFO strip.
- **All rewriting lives in pure functions** in `rewrite.ts`: `(html, targetUrl, proxyPrefix) => string` (plus the URL-rewrite helper). The route handler is a thin shell: parse, fetch, branch, stream. No regex-over-HTML anywhere else, no mutable rewrite state, no shared caches.
- **SSRF guard:** only http(s) targets are fetchable; no allowlist-less localhost exemptions without a real consumer need.

## Picker contract (same-origin injection)

- **Same-origin detection:** `try { iframe.contentDocument }` — the iframe is same-origin exactly when it loaded through the proxy. No other signal; direct-mode iframes are cross-origin by definition.
- **Injection:** one `<style>` (hover outline, pick-mode cursor) plus one `<script>` evaluated in the iframe document, both authored as template-literal strings in `src/client/picker.ts` — no build-time asset pipeline, no `postMessage`. The script registers `window.__dshWebviewPicker = { activate, deactivate, isActive }`; the parent drives it with direct cross-frame function references (same-origin). The page DOM is **untrusted data, read-only**: never evaluate page content, never write into the page beyond the picker's own style/script.
- **Picker behavior:** hover highlights the deepest element under the pointer; click selects; Esc or a second toggle deactivates; clicks never navigate (`preventDefault`) and never mutate the page.
- **cssPath:** delegated to `css-selector-generator` (runtime dependency, inlined into the client bundle) with the priority `['id', 'class', 'tag', 'nthoftype']` — order is priority, output is the shortest unique selector, so index segments appear only when uniqueness requires them; `null` falls back to the bare tag. The picker script itself is event-only and never embeds DOM-traversal logic.
- **Snapshot fields** (exact keys, shared with `format.ts`): `tagName`, `id`, `className`, `cssPath`, `outerHTML` (≤1500 chars), `textContent` (≤300 chars), `rect`, computed `display/position/font-size/color/background-color/margin/padding/width/height`. Caps are contract — enforce at capture, test the exact limit.
- **Cross-origin (direct mode):** the picker is never injected; element selection is disabled and only a page-level comment is offered. The panel says so — no silent degradation.

## Annotation message and AI collaboration

- **`format.ts` is the single assembly point** for the user-visible message. Template contents: page URL + title; one numbered entry per pick (cssPath, truncated snapshot, comment); a closing instruction that the model should locate and modify the corresponding source in the session workspace and report the changed files. Template text is Chinese product copy, pinned in the locale file.
- **Send path:** the inject face exposes `sendAnnotation()`; the implementation is `ctx.sessions.scope(sessionId).conversation.send(text)` — never a bare `ctx.conversation.send` from a scope-less closure (the conversation service is scope-addressed). Success clears picks; failure surfaces an error and preserves picks.
- **No model-facing tool is added:** the annotation is a user message; the model acts with existing workspace tools (`tool-fs`, bash). Adding a tool requires a consumer that proves the message form insufficient.
- The AI's workspace is the session's workspace root — the dev instance is launched with `cwd` = the user's project directory (or the GUI workspace picker), so `tool-fs` edits land in the project the iframe previews.

## UI discipline

- Follow the four props shares, the store-factory rule, and the data-access ladder (upstream client rules): business state (url, mode, picks, comments, panel open/width) lives in `createWebviewStore()` declared at register. Components receive everything through props — no ctx, no React contexts, no hand-made hooks.
- **Link interceptor:** a document capture-phase click listener, active **only while the panel is open**. Intercepts only unmodified left-clicks on `a[href^=http(s)://]`; modifier/middle clicks keep default behavior; clicks inside `[data-webview-ui]` (the panel's own chrome) and inside the iframe (events never bubble to the parent document, but the guard is cheap) are never intercepted. Panel closed → listener inert.
- The URL bar, refresh, proxy/direct toggle, external-open affordance, close button, pick list, and comment editors all live in the panel chrome.

## Known limitations (do not "fix" into breakage)

- **Absolute URLs hardcoded in page JS** (e.g. `fetch('http://host/api')`, `new WebSocket(...)`) are not rewritten; root-relative (`/api`) and relative calls work through `<base>`. Fixing this by executing/rewriting page JS, or by adding a headless browser, is a product decision with real consumer demand — not a bug fix.
- **Dev-server HMR websockets** do not survive the proxy; the page renders but live-reload is absent.
- **Server-side fetch carries no browser cookies** — login-gated pages must use direct mode (which forfeits element selection).
- **The absolute-path entry name is machine-specific**: the yaml and the tsdown banner id must both name this checkout's path. Moving the repo requires regenerating both (`pnpm run gen-config`).
- These are documented for users in the package README (Known Limitations section) and in panel hints; changing them needs a consumer-driven design.

## Testing

- **Pure-function suites** for `rewrite.ts` (attribute forms, base injection, non-HTML pass-through, exact caps) and picker helpers (cssPath, snapshot truncation) — node env for the node half; `// @vitest-environment jsdom` pragma for browser halves.
- **One REAL-composition test for the node half** (upstream rule, docs/testing.md): boot a test-only `cordis.yml` through the Loader with the webserver and this package, serve a fixture page from a local http server, and assert the proxy route returns the rewritten HTML.
- **Component specs** for the panel (test-runtime fixture) asserting user-visible behavior: open, navigate, pick lifecycle, comment, send callback, error preservation.
- **`pnpm run test:gui` green before pushing** (runs the upstream client+host suites against the harness checkout); changes that alter assembled browser output additionally run `DSH_SNAPSHOT=replay pnpm run test:web`. The plugin's own suite runs from this repo (`pnpm test`).
- Store-factory and component tests call `createWebviewStore().create()` directly — the sanctioned zero-machinery path; production code never calls the factory outside `apply`.

## Local development and verification

- One-time setup: `pnpm install` in this repo (devDeps only — tsdown, react, clsx, types, plus `file:` type links into the harness checkout), and once in the harness checkout (`pnpm install && pnpm build`) — the latter is the runtime base for `dsh web`.
- **Dev loop:** `pnpm run dev` (or equivalent) runs `dsh web --dev --port 3090 --config ./cordis.yml` AND this package's tsdown watch together — both must run from the same places per the loading model above; neither alone updates the GUI. Browser refresh applies rebuilt client bundles; node-half changes require restarting the web process (cordis HMR is disabled for web).
- The running 3080 GUI is served from the harness snapshot checkout and is NOT touched by this plugin's dev loop.
- End-to-end acceptance: open a page through the proxy → pick elements → comment → send → model edits workspace source → manual iframe refresh shows the change.
