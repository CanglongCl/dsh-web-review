# @dsh-external/dsh-web-review

External `dsh web` plugin that adds a Preview conversation tab, isolated
per-session page proxy, in-frame element picker, and browser-comment context
injection. Any credential-free absolute HTTP(S) URL can open in Preview,
including assistant-authored public, LAN, and loopback links. Each page runs on
a random `*.localhost` Origin and talks to the host through a bounded,
versioned `postMessage` bridge; page JavaScript never shares the DSH host
Origin.
The harness checkout is not modified.

See the repository [AGENTS.md](../../AGENTS.md) for loading, isolation, bridge, picker,
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
pnpm dev:acceptance  # persistent isolated profile/history + demo + bundle watcher
pnpm demo            # optional fixture page on port 5173
```

For repeat manual testing, `pnpm dev:acceptance` keeps its dedicated DSH home
at `.artifacts/acceptance/dsh-home`. It creates or reuses a provider-free,
settled **网页批注验收** history through the Harness persistence service; open
that conversation and click its Demo link to enter Preview. Workspace state and
other conversation history survive later restarts without changing the normal user profile. The first free port pair is
saved to `.artifacts/acceptance/ports.json`, so Preview URLs remain valid on
later restarts (`DSH_WEB_PORT` and `DEMO_PORT` can temporarily override it). On first initialization,
an existing DSH credential file is copied only when no provider environment
key is available, with mode `0600`; the ignored acceptance directory never
enters the package or repository history.

Open `http://127.0.0.1:3090`, connect the workspace whose source the agent may
edit, then:

1. Open the **Web Preview** conversation tab.
2. Enter an absolute HTTP(S) URL and press Enter. The node face creates a
   short-lived session on a random Preview Origin, and the iframe loads only
   that Origin. Public, LAN, and loopback targets use the same isolated path.
3. Toggle **Add page comments** and click a page element. The solid-white host
   editor accepts a comment; **Select** opens the DOM hierarchy and **Adjust** expands text, fill, typography,
   dimensions, layout, spacing, border, and effects controls. Changes preview
   live on the page, and each changed row can restore its original value.
   Numeric fields that also accept CSS keywords keep free-form entry and expose
   common values such as `auto`, `normal`, and `none` from a trailing menu.
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

The agent may also provide a Markdown link to any HTTP(S) page. An ordinary
click on that assistant link activates Preview and loads the target. Modifier
clicks and links outside assistant rows retain normal browser behavior.

## Context model

The browser sends a bounded structured snapshot to the plugin's node face. It
does not send preformatted model text. The node face validates the session and
every field, renders stable English `# Browser comments` context, creates a
plugin-sourced user-role message, and keeps it pending for pre-step admission.

This creates two distinct logged records:

1. the user's unchanged stock-composer message; and
2. a **Context injection** record sourced from `dsh-web-review`, appended to the
   entered `agent/pre-step` message batch before the model request starts.

When the matching client plugin is installed, that durable record uses the
native compact disclosure row: page title and annotation count when collapsed,
then ordered targets, user comments, requested before/after values, and source
anchors when expanded. Delivery badges, snapshot ids, selectors, viewport
evidence, and raw model-facing Markdown stay out of the normal transcript UI.
Older, malformed, foreign, or renderer-less records keep the Harness generic
Context disclosure.

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
message content. Treat the inject-on-send check as the ready boundary. The
capsule clears only when the durable plugin Context record carries the exact
node-issued snapshot id; unrelated or older user/context records cannot clear
a newer snapshot. Sending while preparation is still in flight leaves the
capsule visible for retry.

## Isolation and known limitations

- **Dedicated Preview Origin:** every top-level target receives a random,
  short-lived `*.localhost` Origin that is distinct from the DSH host and from
  every other preview session. The parent accepts bridge traffic only from the
  exact iframe window, expected Origin, protocol version, and channel. The
  bridge accepts only bounded commands and serializable results; the host never
  reads `contentDocument` or keeps remote DOM references.
- **Origin-bound fetches:** a session is bound to one target Origin. Its first
  DNS resolution is pinned for the session to prevent a hostname from rebinding
  to another network address. Same-Origin redirects stay in the session;
  cross-Origin links and redirects receive a new random Preview Origin.
- Page URL/title, selectors, DOM snapshots, and framework anchors remain
  explicitly untrusted page evidence. The bridge isolates DSH capabilities; it
  does not turn page-authored metadata into authenticated facts.
- The server-side proxy carries no browser cookies. Login-gated pages and sites
  that require their original browser Origin, client certificates, or anti-bot
  challenges may not render completely.
- Root-relative and plain-relative script requests use the isolated proxy.
  Absolute URLs embedded inside page JavaScript and WebSocket endpoints are not
  rewritten; dev-server HMR WebSockets do not survive the proxy.
- Rewritten static links and server redirects perform a controlled Origin
  handoff. Dynamically created links or programmatic navigation that assigns a
  cross-Origin `location` directly can leave the bridge, after which Preview
  reports that annotation is unavailable. Cross-Origin POST forms are not
  supported.
- Only credential-free HTTP(S) URLs are accepted. Schemes such as `file:`,
  `data:`, and `javascript:`, plus `username:password@host` URLs, are rejected.
- Source-checkout launches materialize the development-only
  `@dsh-web-review-dev/plugin` alias in the active Web profile. Use the repo's
  launchers so the link follows the current checkout; direct CLI launches do
  not prepare it.
- One page is active at a time; an explicit new URL or cross-Origin navigation
  clears its annotations.
- Rich edits are temporary inline/text previews. Reset, Cancel, remove, clear,
  successful send, navigation, and unmount restore the original DOM. Text is
  editable only for an element with one safe direct text node.
- Preview refresh after workspace edits is manual.
- HTML rewriting uses a parser and intentionally touches only the documented
  URL-bearing attributes. Cross-Origin subresources retain browser-native CORS
  behavior rather than being promoted into the Preview Origin.

## Verification

```bash
pnpm check          # typecheck, unit/composition tests, config contracts, build
DSH_HARNESS=/absolute/path/deepseek-harness pnpm test:e2e
DSH_HARNESS=/absolute/path/deepseek-harness pnpm check --e2e
```
