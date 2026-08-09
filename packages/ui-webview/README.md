# @limao/ui-webview

External `dsh web` plugin that adds a Preview conversation tab, same-origin
page proxy, in-frame element picker, and browser-comment context injection.
The harness checkout is not modified.

See the repository [AGENTS.md](../../AGENTS.md) for loading, proxy, picker,
context, and testing contracts. The accepted implementation design lives in
[docs/webview-ui-plan.md](../../docs/webview-ui-plan.md).

## Usage

```bash
pnpm install
pnpm gen-config      # regenerate machine-specific launch files after moving the repo
pnpm dev             # dsh web + the external client-bundle watcher
pnpm demo            # optional fixture page on port 5173
```

Open `http://127.0.0.1:3090`, connect the workspace whose source the agent may
edit, then:

1. Open the **Preview** conversation tab.
2. Enter a URL and press Enter. The page loads through `/webview-proxy` so the
   picker can access its document.
3. Toggle **Pick element**, click a page element, type a comment, and press
   Enter. A numbered marker appears in the page and one compact annotation
   capsule appears above the stock composer.
4. Hover or keyboard-focus the capsule to inspect every target, comment, and
   source/selector hint. Clicking a row reopens that comment in Preview.
5. Wait for the capsule's synced check, then send the normal prompt through
   the stock composer. The plugin never replaces the composer and never edits
   the prompt.
6. Refresh Preview after the agent edits the workspace source.

## Context model

The browser sends a bounded structured snapshot to the plugin's node face. It
does not send preformatted model text. The node face validates the session and
every field, renders stable English `# Browser comments` context, creates a
plugin-sourced user-role message, and commits it through `agent.inject`.

This creates two distinct logged records:

1. a **Context injection** record sourced from `ui-webview`; and
2. the user's unchanged stock-composer message.

Each non-empty snapshot says that it supersedes older browser-comment
snapshots. Clearing an active set injects an explicit empty snapshot. Identical
snapshots are deduplicated per live session, and session state is released on
`agent/disposed`.

The format separates trust domains:

- page URL/title, target labels, selectors, paths, classes, and framework
  anchors are explicitly marked as untrusted page evidence;
- only `Comment (user-authored)` is treated as user input;
- multiline comments are quoted so they cannot create sibling metadata;
- `outerHTML`, computed styles, geometry, and screenshots are excluded.

No model-facing tool is registered. The agent uses the workspace tools already
available in the session.

## Synchronization semantics

Annotation changes POST immediately and in order; there is no timer and no
silent best-effort fetch. The capsule distinguishes syncing, synced, and error
states. A failed commit stays visible and clicking the capsule retries it.

The stock composer currently exposes no public general pre-submit interceptor.
Consequently the external plugin cannot make annotation commit and an
arbitrary simultaneous Send click one atomic operation without returning to
`agent/prompt-submit`. Treat the synced check as the ready boundary. The plugin
does not claim success before the host acknowledges `agent.inject`.

## Known limitations

- **Same-origin trust boundary:** proxied page JavaScript currently executes on
  the host origin because the picker uses direct frame references. Structured
  validation prevents a page from supplying preformatted context, but it does
  not isolate arbitrary scripts from host routes. A complete fix requires a
  dedicated proxy origin and validated `postMessage` bridge. Only preview
  trusted development pages until that architecture lands.
- Absolute URLs embedded in page JavaScript and WebSocket endpoints are not
  rewritten. Relative and root-relative resources work through the injected
  `<base>`; dev-server HMR WebSockets do not.
- Server-side proxy fetches carry no browser cookies, so login-gated pages
  cannot be annotated.
- The generated launch entry is machine-specific. Run `pnpm gen-config` after
  moving the checkout, then restart the web process.
- One page is active at a time; navigating clears its annotations.
- Preview refresh after workspace edits is manual.
- HTML attribute rewriting is intentionally narrow and regex-based; exotic
  markup may degrade to pass-through behavior for affected attributes.

## Verification

```bash
pnpm check          # typecheck, unit/composition tests, config contracts, build
pnpm test:e2e       # real GUI/proxy/picker/context ordering acceptance
pnpm check --e2e    # both ladders
```
