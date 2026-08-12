# @dsh-external/dsh-web-review

External `dsh web` plugin that adds a Preview conversation tab, same-origin
page proxy, in-frame element picker, and browser-comment context injection.
Assistant-authored HTTP(S) links open directly in Preview, and the plugin adds
a short system-prompt capability note so the agent can offer a verified local
frontend review link when useful.
The harness checkout is not modified.

See the repository [AGENTS.md](../../AGENTS.md) for loading, proxy, picker,
context, and testing contracts. The accepted implementation design lives in
[docs/webview-ui-plan.md](../../docs/webview-ui-plan.md); the rich editor and
rollback contract is specified in
[docs/rich-annotation-editor-plan.md](../../docs/rich-annotation-editor-plan.md),
with the researched control grammar in
[docs/figma-property-editor-plan.md](../../docs/figma-property-editor-plan.md).

## Usage

```bash
pnpm install
pnpm gen-config      # regenerate machine-specific launch files after moving the repo
pnpm dev             # dsh web + the external client-bundle watcher
pnpm demo            # optional fixture page on port 5173
```

Open `http://127.0.0.1:3090`, connect the workspace whose source the agent may
edit, then:

1. Open the **Web Preview** conversation tab.
2. Enter a URL and press Enter. The page loads through `/webview-proxy` so the
   picker can access its document.
3. Toggle **Add page comments** and click a page element. The solid-white host
   editor accepts a comment; **Select** opens the DOM hierarchy and **Adjust** expands text, fill, typography,
   dimensions, layout, spacing, border, and effects controls. Changes preview
   live on the page, and each changed row can restore its original value.
   The hierarchy toolbar moves to the first child, parent, previous sibling, or
   next sibling. Each compact label includes a small shortcut keycap. The
   focused preview canvas uses Enter, Backslash, Shift+Tab, and Tab for the same
   actions and briefly identifies the new target below the comment field.
   Inside the tree those shortcuts keep moving the selection, while arrow keys
   navigate and expand/collapse visible rows.
   Adjust begins with a compact **Use UI optimization Skills** disclosure. Its
   first expanded line points to `/skills`, followed by eight per-batch Skill
   checkboxes.
4. Confirm the editor. A numbered marker appears in the page and one compact
   annotation capsule appears above the stock composer. The preview is temporary
   and never edits workspace source.
5. Hover or keyboard-focus the capsule to inspect every target, comment, and
   source/selector hint. Clicking a row reopens that comment in Preview.
6. Wait for the capsule's **Inject on send** check, then send the normal prompt through
   the stock composer. The plugin never replaces the composer and never edits
   the prompt.
7. Refresh Preview after the agent edits the workspace source.

Annotation mode also provides a counted **Send** button. When the composer has
a draft, it submits that draft through the stock input machine together with
the prepared browser comments. With no draft, it sends the fixed localized
request “Please apply the page comments to the frontend implementation.” because
the stock input machine deliberately treats an empty draft as a no-op.

The agent may also provide a Markdown link to a running frontend page. An
ordinary click on that assistant link activates Preview and loads the target;
modifier clicks retain the browser's normal external-link behavior.

## Context model

The browser sends a bounded structured snapshot to the plugin's node face. It
does not send preformatted model text. The node face validates the session and
every field, renders stable English `# Browser comments` context, creates a
plugin-sourced user-role message, and keeps it pending for pre-step admission.

This creates two distinct logged records:

1. the user's unchanged stock-composer message; and
2. a **Context injection** record sourced from `dsh-web-review`, appended to the
   entered `agent/pre-step` message batch before the model request starts.

Each non-empty snapshot says that it supersedes older browser-comment
snapshots. Clearing before send removes pending state and injects nothing. Identical
snapshots are deduplicated per live session, and session state is released on
`agent/disposed`.

The format separates trust domains:

- page URL/title, target labels, selectors, paths, classes, and framework
  anchors are explicitly marked as untrusted page evidence;
- comments, requested property values, and text replacements are user-authored;
- multiline comments are quoted so they cannot create sibling metadata;
- each optional `Browser annotation` records the edit-time viewport and only
  changed `before -> after` values;
- `outerHTML`, full computed styles, editor state, geometry, and screenshots are excluded.

No model-facing tool is registered. The agent uses the workspace tools already
available in the session.

## Bundled UI optimization Skills

The package vendors the eight Skills from `jakubkrehel/skills` at the commit
recorded in `skills/UPSTREAM.md`. Every candidate is user-invocable, including
through the client-owned `/skills` popup command. Model-catalog visibility is
deployment configuration and is independent from the annotation checkboxes:

```yaml
config:
  autoLoadSkills:
    - better-ui
    - better-typography
    - better-layout
    - better-writing
```

Changing `autoLoadSkills` in the Cordis plugin row reconfigures the provider;
an empty list hides all eight from the model catalog while preserving user
invocation. At annotation admission, a selected Skill absent from the current
model-visible surface is inserted in canonical Skill form before Browser
Comments. If its complete instructions are already visible, Browser Comments
is followed by a short instruction to apply that Skill instead.

## Synchronization semantics

Annotation changes POST immediately and in order; this prepares pending context
but does not inject it. There is no timer or silent best-effort fetch. The capsule
distinguishes preparing, inject-on-send, and error states. A failed preparation
stays visible and clicking the capsule retries it.

The stock composer currently exposes no public general pre-submit interceptor.
Consequently the external plugin cannot make annotation commit and an
arbitrary simultaneous Send click one client-side atomic operation. The plugin
uses `agent/pre-step` only to preserve downstream rejection or append one
separately sourced message after downstream entry; it never rewrites claimed
message content. Treat the inject-on-send check as the ready boundary. After a durable human message appears, the consumed
annotation capsule clears automatically. Sending while preparation is still in
flight leaves the capsule visible for retry.

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
- Rich edits are temporary inline/text previews. Reset, Cancel, remove, clear,
  successful send, navigation, and unmount restore the original DOM. Text is
  editable only for an element with one safe direct text node.
- Preview refresh after workspace edits is manual.
- HTML attribute rewriting is intentionally narrow and regex-based; exotic
  markup may degrade to pass-through behavior for affected attributes.

## Verification

```bash
pnpm check          # typecheck, unit/composition tests, config contracts, build
pnpm test:e2e       # real GUI/proxy/picker/context ordering acceptance
pnpm check --e2e    # both ladders
```
