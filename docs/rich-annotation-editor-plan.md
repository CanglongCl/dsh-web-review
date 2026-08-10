# Rich browser-annotation editor

## Goal

Replace the iframe-owned one-line comment field with a white, host-owned
annotation editor that can preview visual changes on the selected page element,
roll them back exactly, and send only the user's bounded change set as part of
the existing send-time browser-comment context.

The feature does not edit workspace source. It records a review request for the
agent, while the iframe mutation is only a temporary visual preview.

## Product behavior

### Collapsed editor

- Render a solid white pill above or below the selected element.
- The left Adjust button expands the property inspector.
- The center input edits the annotation comment.
- Confirm commits the comment and requested changes; Escape/Cancel restores the
  state from before the editor was opened.

### Expanded editor

- Render a solid white, scrollable card inside the preview bounds with a sticky
  footer.
- Do not repeat the target identity below the comment field. Group contextual
  Figma-style controls for content, fill, typography, dimensions, layout,
  spacing, border, constraints, and effects.
- Common enumerations use DSH compact menus (never native selects), colors use
  swatch/picker/alpha controls, numbers support keyboard and pointer scrubbing,
  and raw CSS fallback preserves `px`, `%`, `rem`, `auto`, token-backed, and
  otherwise unparsed values.
- Direct text content uses a full-width, vertically resizable multiline field;
  font family is selected from common Latin/CJK/system presets.
- A changed row shows a per-field reset action. Reset restores the original
  value immediately and removes that field from the requested changes.
- Text editing is available only when the selected element resolves to one
  non-destructive direct text node. Composite containers are never rewritten
  through `textContent`.

## Architecture

The picker script stays responsible for pointer capture, selection outlines,
and numbered markers. The rich editor is a React overlay rendered by
`WebviewView` above the iframe. Its position is derived from the selected
element's iframe-viewport rectangle.

This boundary is deliberate:

- page styles such as `opacity`, `transform`, or an `<html>` background never
  affect the editor;
- the editor can use the plugin's CSS Modules and DSH token vocabulary;
- rich form logic stays typed and testable instead of growing an ES5 template
  string inside the untrusted page;
- the iframe receives only the narrowly controlled inline preview mutations.

Committed business data lives in the shared webview store. Live `Element`
references and original inline declarations remain in component refs, never in
the store. An edit transaction keeps a local draft until Confirm.

## Change model

Each `PickItem` adds:

```ts
interface RequestedStyleChange {
  property: EditableStyleProperty
  before: string
  after: string
}

interface RequestedTextChange {
  before: string
  after: string
}

interface AnnotationViewport {
  width: number
  height: number
}
```

Only changed values are serialized. The full computed style, raw HTML, and
temporary editor state are not sent to the host.

The property registry is a shared allowlist covering source-relevant visual CSS
properties. URL-bearing values, generated `content`, behavior/event surfaces,
and pseudo-elements are not editable. Limits apply per value, per annotation,
and across a full snapshot.

## Temporary DOM mutation and rollback

For each live pick, a component-owned ledger records the exact original inline
value and priority before the first preview write. Preview values are applied
with `style.setProperty`; reset restores the recorded declaration (or removes
the inline property when it did not exist).

Text preview records the exact `Text.data` value. It never replaces a composite
element's descendants.

Rollback happens on:

- per-field Reset;
- editor Cancel/Escape (back to the transaction baseline);
- annotation removal or Clear All;
- successful send when the annotation snapshot is consumed;
- navigation, frame replacement, plugin disposal, or component unmount.

After a frame reload, remaining picks re-anchor through `cssPath`, capture a new
local baseline, and replay their committed preview changes.

## Structured wire and model context

The browser-to-host contract carries a bounded viewport, style-change array,
and optional text change for every comment. The node face validates all keys,
property names, counts, numbers, and value lengths before formatting text.

The stable model-facing block extends the existing Browser Comments format:

```text
Browser annotation:
Visible viewport at edit time: 597x835 CSS px
Requested changes:
- color: rgb(0, 0, 0) -> #613838
- font-size: 16px -> 24px
- text: "Example Domain" -> "New heading"
```

Original values remain untrusted page evidence. Requested values and the
comment are user-authored input. The node formatter, never the browser, owns
this wording. The resulting plugin message continues to enter through
`PromptDecision.additionalContexts` immediately before the admitted human
message.

## Verification

- Pure tests: property allowlist, value bounds, text-node eligibility, exact
  inline restoration, transaction cancel, and reapply after re-anchor.
- Contract tests: malformed properties, duplicate changes, aggregate limits,
  viewport bounds, and exact context formatting.
- Component tests: collapsed/expanded editor, white surface, live changes,
  per-field reset, text editing, Cancel, Confirm, remove, and clear.
- Browser E2E: select a real demo element, preview multiple style/text changes,
  reset one field, commit, inspect the dock, send, and assert that the context
  contains the remaining diffs while the temporary DOM changes are removed.

## Implementation order

1. Add the property registry and extend client/store/wire types.
2. Extend strict node validation and the stable context formatter.
3. Add the live patch ledger and host React editor.
4. Reduce the picker bridge to selection/marker responsibilities and connect
   editor positioning to iframe scroll/resize.
5. Add tests, update repository contracts, and run `pnpm check` plus browser
   E2E.
