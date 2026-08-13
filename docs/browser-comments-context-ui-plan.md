# Browser Comments context presentation

## Goal

Present the durable Browser Comments message as a first-class DSH Context disclosure without changing the model-facing message, its plugin provenance, or the send-time admission lifecycle. The row follows the existing 24px disclosure rhythm and expands into a bounded, native-looking summary of the page review.

## User information hierarchy

The collapsed row answers three questions: what this context is, which page it describes, and how many active comments it contains. It reads `页面批注 · <page title> · <count> 处批注` and carries only the standard disclosure affordance. Delivery state is omitted because a durable transcript row already proves admission.

The expanded body presents information in this order:

1. Page title and credential-free page location, followed by aggregate counts for visual and text changes.
2. One numbered item per annotation, preserving the user's order.
3. Target identity from role or tag plus accessible label.
4. The user's comment as the primary instruction.
5. Only requested before/after style and text changes.
6. A source anchor as quiet secondary evidence when the page supplied one.

The normal presentation excludes `snapshotId`, CSS selectors, full DOM paths, viewport dimensions, trust boilerplate, unchanged computed styles, and raw model-facing Markdown. These remain in the durable message for replay and model history but do not compete with the user's review intent in Chat.

## Visual contract

The row reuses DSH's `DisclosureRow`: 16px leading icon, 6px gap, 14px/24px text, neutral label colors, hover chevron, and no card border or status badge. The expanded body uses the generic Context body's 22px left alignment, an 8px radius, the existing muted Context background, 13px primary copy, 11–12px secondary metadata, hairline separators, and neutral numbering and requested values.

The presentation has no delivery dot, `已发送` label, footer, audit callout, or nested disclosure. The outer Context row is the only expansion mechanism.

## Harness extension

`ui-conversation` declares a `conversation.chat.contextview` chain under the built-in `context` Chat renderer. The owner receives the complete projected `ContextMessageNode`; each entry uses a pure selector to validate and claim the semantic form it presents. The selected entry owns the complete disclosure row. The existing `ContextInjectionRow` remains the all-declined fallback for an absent, unknown, unregistered, or malformed form, so historical and foreign logs preserve their current opaque presentation.

The LLM message package exposes `ContextFormMap` as a declaration-merged registry. `ContextFormed` derives its discriminated union from that map, allowing an external producer to add a semantic form and the structured source fields required to present it without widening the generic plugin source to arbitrary fields.

## Plugin data

The node half declares the `browser-comments` form and records one bounded presentation value beside the existing `snapshotId`. The presentation contains the normalized page title and URL plus the same validated comments already used to render `# Browser comments`. It excludes `outerHTML`, full computed style, rectangles, and screenshots. The browser never supplies preformatted UI or model text.

The client registers one `conversation.chat.contextview` entry whose selector claims only a fully validated `browser-comments` source. It validates the durable source defensively because replayed session JSON is a wire boundary; an unreadable source declines to the generic fallback rather than rendering a confident partial summary.

## Ownership and compatibility

Harness owns only form dispatch and the generic fallback. It does not import web-review types, copy, colors, or renderers. The external plugin owns Browser Comments parsing, locale strings, the native-style component, and its CSS Module.

The durable `user/message` remains separate from the human prompt and retains `{ kind: 'plugin', plugin: 'dsh-web-review', snapshotId }`. Adding the form changes presentation metadata but not ordering, acknowledgement, deduplication, clearing, or model-facing content.

## Verification

- LLM type tests prove an external `ContextFormMap` member requires its declared fields and that built-in forms remain accepted.
- Slot type/runtime tests prove the built-in Context renderer declares and dispatches the chain while an unknown form reaches the generic fallback.
- ui-conversation component tests prove the default Context presentation is unchanged without a matching entry.
- web-review formatter tests pin bounded structured source data and exact acknowledgement by `snapshotId`.
- web-review component tests cover collapsed and expanded native presentation, style/text diffs, missing anchors, and malformed-source fallback.
- Browser E2E proves the durable Browser Comments row uses the dedicated presentation while the user's message and model-facing context remain unchanged.
