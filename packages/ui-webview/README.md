# @limao/ui-webview

Webui webview panel plugin: open a URL in a floating right-edge iframe, pick
elements and comment on them, then send the annotation into the conversation
so the model modifies the corresponding frontend source in the session
workspace.

The package is **loaded externally by `dsh web`** — zero changes to the
deepseek-harness source tree. See [AGENTS.md](../../../AGENTS.md) for the
loading model, proxy contract, picker contract, and development rules.

## Usage

```bash
pnpm install            # dev deps + file: type links into the harness checkout
pnpm gen-config         # regenerate cordis.yml + entry-name.json (after moving the repo)
pnpm dev                # harness prep (once) + dsh web --dev --port 3090 + tsdown watch
```

Open `http://127.0.0.1:3090`, start a session (pick a workspace — the AI's
file tools operate there), then:

1. Click **网页预览** in the conversation header — the floating panel opens.
2. Enter a URL (e.g. `http://localhost:5173` from `node demo/server.mjs`),
   press Enter. The page loads through the proxy so it stays same-origin and
   elements can be picked.
3. Click the **选择元素** icon (far right of the URL row), then click an
   element in the page — a floating comment field appears next to it. Type a
   comment and press Enter; the annotation joins the **注释** chip bar below
   and a numbered circle echoes over the element in the preview. Repeat for
   more elements; click a circle or a chip to re-open that element's comment.
4. Click **加入对话并发送** — a structured annotation message is sent to the
   session; the model locates and modifies the corresponding source in the
   workspace.
5. Click **↻** in the panel to refresh the page and see the changes.

Links in the GUI (chat messages, web cards) open in the panel when it is
open; modifier-click keeps the default new-tab behavior.

## Model Experience

The annotation is a plain user message: an XML-style annotation block built
for **locating source code**, not describing pixels. Each element carries
searchable literals — the accessible text identity (`button "提交"`) and
either the framework source anchor (`source="src/components/Hero.tsx:12"`
+ component chain, read from React/Vue/Svelte dev-mode metadata) or the
stable class names + full DOM path when no framework metadata exists —
plus the user's comment in CDATA. Raw DOM artifacts (outerHTML, computed
styles, coordinates) are deliberately omitted. Long URLs are shortened to
route + query summary. No model-facing tool is registered; the model acts
with the session's existing workspace tools (`tool-fs`, bash). Messages
therefore cost only ordinary user-turn tokens.

#### KV Cache effect

None — no provider request shape is altered.

## Known Limitations and Deferred Work

- **Selector generation** is delegated to `css-selector-generator` (`['id', 'class', 'tag', 'nthoftype']` priority, shortest-unique output); its nth-of-type segments are relative to the page's live DOM, so adding/removing identical siblings can renumber them — same tradeoff as any index-based selector.
- **Proxy fidelity** (documented, do not "fix" into breakage): absolute URLs
  hardcoded in page JS (`fetch('http://host/api')`, WebSocket endpoints) are
  not rewritten; root-relative (`/api`) and relative calls work through the
  injected `<base>`. Dev-server HMR websockets do not survive the proxy.
  Server-side fetch carries no browser cookies — login-gated pages cannot be
  annotated (element picking requires the same-origin proxy).
- **The entry name is machine-specific**: `cordis.yml` and
  `entry-name.json` embed this checkout's absolute path; moving the repo
  requires `pnpm gen-config` (and a web-process restart). The package root's
  `index.js` re-export exists for the Loader's directory import (ESM has no
  directory resolution) — keep it in sync with `lib/index.js` (it only
  re-exports, so it never needs edits).
- **No auto-refresh after the model finishes**: the panel refresh button is
  manual.
- **One page at a time**: no tabs; switching URL clears the annotation picks.
- **Regex-based HTML rewriting**: `>` inside quoted attribute values is
  handled, but exotic markup (unquoted `>` in attributes, HTML inside
  comments, template tags) can evade rewriting; such pages degrade to
  pass-through behavior for the affected attributes.
