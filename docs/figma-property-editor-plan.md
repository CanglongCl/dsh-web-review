# Figma-style browser annotation property editor

## Outcome

Replace the generic 48-row CSS form with a contextual, compact property
inspector whose interactions match familiar design tools. The editor remains a
host-owned React overlay and continues to produce the same bounded, reversible
browser-annotation diffs. This is an interaction and presentation redesign; it
does not move source editing into the browser.

The expanded state must:

- keep a persistent check action in the lower-right corner;
- remove the redundant target-name strip below the comment input;
- right-align property values and controls;
- use direct-manipulation controls instead of generic text/select fields;
- expose only controls relevant to the selected element and current layout;
- preserve an escape hatch for valid CSS values that cannot be represented by
  the structured control.

## Research evidence

- [Figma properties panel](https://help.figma.com/hc/en-us/articles/360039832014-Design-prototype-and-explore-layer-properties-in-the-right-sidebar)
  organizes the selection into position/layout, appearance, typography, fill,
  stroke, and effects; the panel is contextual to the selected layer.
- [Figma text properties](https://help.figma.com/hc/en-us/articles/360039956634-Explore-text-properties)
  puts family/style/size/line-height/letter-spacing and alignment in the main
  typography section, with less common decoration/case controls behind an
  additional surface.
- [Figma stroke controls](https://help.figma.com/hc/en-us/articles/360049283914-Apply-and-adjust-stroke-properties)
  use a color picker, numeric weight, option menus, visibility/remove actions,
  and linked-versus-individual side controls.
- [Illustrator Properties](https://helpx.adobe.com/illustrator/desktop/get-started/learn-the-basics/properties-panel-overview.html)
  is selection-specific and keeps width/height/fill/stroke/opacity primary,
  while advanced controls expand on demand.
- [Microsoft text formatting](https://support.microsoft.com/en-us/word/training/add-and-edit-text)
  uses direct B/I/U buttons and dedicated font, size, and color controls.

Screenshots reviewed during research show the same recurring grammar: short
section headers, dense two-column rows, icon button groups for bounded visual
choices, scrub-capable numeric values, color swatches, and trailing reset or
check affordances. Native `<select>` chrome and dozens of identical text boxes
are not used as the primary interaction.

## DSH design-system mapping

Use the existing `@deepseek-ai/dsh-client-ui-primitives` atoms instead of
inventing a parallel material system:

- `Menu` with `compact`, `portal`, trailing selection check, and DSH menu
  tokens for all option pickers;
- `Button` semantics and DSH toolbar/hover/focus tokens for actions;
- `Input` geometry as the reference for editable text and number fields;
- `IconCheckOutline16`, `IconChevronDownOutline14`, and
  `IconRefreshOutline14` where those meanings already exist;
- small local SVGs only for domain controls missing from DSH: B/I/U glyphs,
  alignment, link/unlink sides, layout direction, and box-model diagrams.

Local controls use DSH tokens (`--dsw-alias-*`, `--dsw-specific-menu`,
`--dsw-shadow-lv3`) and the same 28/32px dense geometry as DSH toolbar and
menu controls. No native `<select>` is rendered. Focus-visible, disabled,
hover, active, and error states follow DSH token families.

## Control primitives to implement

### `InspectorSection`

Collapsible section with a 12px label, optional summary/action, and a compact
content grid. Common sections start open; advanced constraints/effects start
collapsed. Section state is presentation-only.

### `OptionMenu`

DSH `Menu` anchored to a right-aligned 28px trigger. It shows the current value,
chevron, and trailing check in the menu. It supports current computed values
that are outside the suggested option set.

### `ToggleButton` and `SegmentedControl`

28px icon/text buttons for boolean or small finite choices. Selected state uses
the DSH active fill and primary label, not a native checkbox. B/I/U,
alignment, flex direction, wrapping, and overflow use this form.

### `ScrubNumber`

Unit-aware numeric control with:

- right-aligned displayed value;
- direct text entry on click/focus;
- horizontal pointer drag on the label or leading property glyph;
- ArrowUp/ArrowDown increments, Shift ×10, Alt ×0.1;
- preserved unit (`px`, `%`, `rem`, `em`, `deg`, or unitless);
- optional min/max/step and a trailing chevron menu for stable, parameter-free
  CSS keywords such as `auto`, `normal`, and `none`; numeric, unit-bearing,
  functional, and token-backed values remain freely editable in the same field;
- double-click/reset action through the existing per-property rollback.

Dragging begins from the committed value and previews continuously. Invalid or
non-numeric CSS values remain editable through the text mode; the control never
silently coerces them.

### `ColorControl`

A swatch/value trigger opens a DSH-token popover containing:

- native color spectrum input as the browser-supported picking surface;
- editable six-digit hex value;
- alpha `ScrubNumber` in percent;
- transparent preset;
- current/original swatches and reset action.

The control serializes a valid hex/rgba CSS value and previews continuously.
Color and opacity remain separate properties when the source CSS separates
them.

### `BoxModelControl`

Margin and padding use a compact four-side diagram with top/right/bottom/left
`ScrubNumber`s. A link toggle applies one edited value to all four sides; unlink
restores independent editing. Border radius uses the same linked model, backed
by the existing shorthand property. Labels and fields are right-aligned.

### Composite effect controls

- Shadow: x, y, blur, spread scrubbers plus `ColorControl`; assemble one
  `box-shadow` value. If the computed value cannot be parsed as one simple
  shadow, show it in advanced raw-value mode without destroying it.
- Transform: segmented operation selector plus translate X/Y, scale X/Y, and
  rotation scrubbers; assemble a stable transform string. Unknown/matrix values
  stay available in advanced raw-value mode.

## Property inventory and interaction decisions

| Properties | Type and options | Primary interaction | Coupling / visibility |
| --- | --- | --- | --- |
| text content | bounded string | full-width, vertically resizable multiline editor | only for one safe direct text node |
| `color`, `background-color`, `border-color` | color + alpha | `ColorControl` | swatch always visible; transparent supported |
| `opacity` | bounded 0–100% numeric | percent `ScrubNumber` | maps to CSS 0–1 |
| `font-family` | preset choice | `OptionMenu` with common Latin/CJK/system fonts; the current computed family is retained as an option | typography only; users do not have to type font stacks |
| `font-weight` | enum 100–900 plus bold boolean | B toggle + compact exact-weight menu | B toggles normal ↔ 700 while preserving exact choices |
| `font-style` | normal/italic/oblique | I toggle; oblique in advanced menu | typography only |
| `text-decoration` | none/underline/line-through/overline | U toggle + decoration menu | typography only |
| `font-size` | positive length | scrub, presets, typed value | typography only |
| `line-height` | `normal`, unitless, length, percent | scrub + unit/preset menu | typography only |
| `letter-spacing` | `normal` or signed length | scrub + normal preset | typography only |
| `text-align` | start/left/center/right/end/justify | alignment icon segment | typography only |
| `text-transform` | none/uppercase/lowercase/capitalize | `Aa` option segment/menu | typography advanced |
| `width`, `height` | auto/length/percent | paired W/H scrub controls | optional aspect-link only changes both when explicitly enabled |
| min/max width/height | none/length/percent | paired scrub controls | advanced constraints section |
| `display` | block/inline/inline-block/flex/inline-flex/grid/none | compact option menu | controls conditional layout sections |
| `position` | static/relative/absolute/fixed/sticky | compact option menu | offsets hidden for static |
| top/right/bottom/left | auto/length/percent | four-side position control | visible only for non-static position |
| `z-index` | auto/integer | integer scrub | visible only for positioned elements |
| flex direction | row/row-reverse/column/column-reverse | direction icon segment | flex/inline-flex only |
| flex wrap | nowrap/wrap/wrap-reverse | wrap icon toggle/menu | flex/inline-flex only |
| justify/align items/content | finite layout enums | icon segments where recognizable, DSH menu otherwise | flex/grid only; `align-content` only when wrapping/multiple tracks matters |
| gap/row-gap/column-gap | normal/length/percent | linked gap scrub then per-axis values | flex/grid only |
| overflow | visible/hidden/clip/scroll/auto | icon/menu segment | layout section |
| margin sides | auto/signed length/percent | `BoxModelControl` | linked/unlinked |
| padding sides | non-negative length/percent | `BoxModelControl` | linked/unlinked |
| border width/style/color | length + enum + color | one stroke row: scrub, style menu, swatch | style/color dimmed when width is zero; editing enables solid stroke |
| border radius | non-negative shorthand lengths | linked-corner scrub control | supports 1–4 values/raw fallback |
| `box-shadow` | structured effect or raw CSS | composite shadow editor | advanced Effects |
| `transform` | structured operations or raw CSS | composite transform editor | advanced Effects |

Properties unsupported by the current safe wire allowlist remain deliberately
absent. We do not present controls that cannot be serialized and validated.

## Contextual section layout

1. **Content** — direct text editor only; no duplicate target-name strip.
2. **Appearance** — fill, background, opacity.
3. **Typography** — only when text content or typography styles are meaningful;
   family row, B/I/U toolbar, size/line/spacing row, alignment row, advanced case.
4. **Size and layout** — W/H, display, position, and conditional flex/grid rows.
5. **Spacing** — visual margin/padding box model.
6. **Border** — width/style/color/radius.
7. **Effects** — shadow/transform, collapsed by default.
8. **Constraints** — min/max and offsets, collapsed unless currently active.

Every row uses `grid-template-columns: minmax(90px, 1fr) minmax(0, auto)`;
the control cell is `justify-self: end`, numeric text is right-aligned, and
reset occupies a fixed trailing slot inside the control rather than changing
grid placement. This prevents the 24px-column regression.

The expanded editor targets 360–400px when the preview has room. At 320px or
less, composite rows may wrap the label above a full-width right-aligned
control; they must never horizontally scroll or collapse below 120px. Section
visibility is deterministic: typography stays available for every selected
element (CSS typography can intentionally inherit through containers), while
direct content editing depends only on the safe-text-node predicate. Position
offsets depend on non-static position; flex controls depend on flex/inline-flex;
grid/flex gaps depend on grid/flex. A control with a non-default baseline is
never hidden. Once a section becomes visible in an edit transaction it stays
visible until that transaction closes, preventing focus-destroying jumps.

## Interaction state machine

Each editor transaction has `baseline → editing-valid | editing-invalid →
confirmed | cancelled`. `dirty` means a non-blank comment, at least one style
diff, or a text diff. The check is enabled only when `valid && dirty`; an empty
comment with no requested changes cannot create an annotation.

The comment remains single-line, matching the compact Codex comment pill, so
Enter confirms it. Inspector text/number fields use Enter only to commit/blur
that field. Escape is layered:

1. cancel an active pointer scrub and restore its drag-start value;
2. close an option/color popover and return focus to its trigger;
3. abandon the current field draft and restore its value on focus entry;
4. cancel the annotation transaction and restore its full baseline.

Pointer scrubbing starts only after a 3px horizontal threshold and uses pointer
capture until pointer-up/cancel. No drag may leak into iframe selection.

## Lossless value contract

Every property retains four distinct forms:

- `baselineInline`: exact original inline value and priority, used only for DOM
  rollback;
- `computedDisplay`: the browser-computed value shown when no source expression
  is available;
- `rawDraft`: the exact current user-editable CSS string;
- `parsedDraft`: optional structured data used only when parse + serialize is
  demonstrably lossless for the supported grammar.

Opening or merely focusing a control never writes `computedDisplay` back into
the DOM or `changes[]`. A diff exists only after an explicit user edit. Values
such as `var(...)`, `calc(...)`, `currentColor`, inherited values, percentages,
multi-shadow lists, and transform matrices stay in raw mode unless the control
can round-trip the exact expression. Switching from structured to raw preserves
the draft; returning to structured mode is offered only when the raw value is
parseable. Invalid raw drafts remain local, visibly invalid, and block confirm
without altering the last valid live preview.

The native `input[type=color]` is intentionally only the browser-supported
spectrum surface inside a DSH-styled popover. DSH controls own hex/alpha,
preview, cancel, focus return, keyboard access, and validation so browser chrome
does not define the product interaction.

## Composite control to wire mapping

| Control | Wire properties | Edit/reset semantics | Maximum diffs |
| --- | --- | --- | --- |
| W/H | `width`, `height` | independent by default; explicit aspect link updates both atomically; group reset restores both | 2 |
| position box | `top`, `right`, `bottom`, `left`, `z-index` | longhands only; reset is per field or whole group | 5 |
| flex alignment | existing flex longhands | one diff per changed choice; no shorthand | 5 |
| linked gap | `gap`, or `row-gap` + `column-gap` | linked edits `gap`; unlink initializes axes from computed values without a diff until edited | 2 |
| margin box | four margin longhands | linked edit writes all four as one atomic preview/change batch; unlink keeps current equal values | 4 |
| padding box | four padding longhands | same as margin; non-negative validation | 4 |
| border row | `border-width`, `border-style`, `border-color` | each explicit; editing style/color never silently changes zero width | 3 |
| radius | `border-radius` shorthand | preserve raw 1–4-value grammar; linked mode emits one shorthand diff | 1 |
| shadow | `box-shadow` | structured only for one losslessly parsed shadow; otherwise raw; one reset restores full value | 1 |
| transform | `transform` | structured only for losslessly parsed supported operation sequence and preserves order; matrix/unknown stays raw | 1 |

Atomic multi-property actions validate every next value before preview, then
apply all or none. They count against the existing per-comment/global caps in
the obvious longhand count above; the UI blocks an action that would exceed a
cap instead of truncating it.

Toggle semantics are explicit:

- B remembers the most recent non-bold weight in the transaction; on sets 700,
  off restores that remembered value (for baseline 500: 500 → 700 → 500).
- I treats italic/oblique as active; on from normal sets italic, off restores
  the remembered non-italic value. Oblique stays available in the style menu.
- U adds/removes only the `underline` token and preserves `line-through` or
  `overline` tokens.
- linked side controls apply subsequent edits to every side; unlink preserves
  the current values and only changes future editing scope. Group reset is the
  only action that restores all baseline sides.

## Footer and transaction behavior

The editor shell never scrolls. The inspector body is the only scrolling
container. The footer is a non-scrolling shell child with opaque background,
top hairline and elevation shadow; the inspector includes at least footer
height + 8px of bottom breathing room so the final control remains operable.
Cancel stays at lower-left and the blue circular check stays at lower-right.
The check follows the `valid && dirty` rule above. Escape and Enter follow the
layered keyboard semantics above.

All existing exact rollback guarantees remain: reset, cancel, remove, clear,
send, navigation, and unmount restore original inline values/priorities and
direct text data.

## Accessibility and persistence

- Every icon-only action has localized accessible name and tooltip; visible
  selection is conveyed with `aria-pressed`/`aria-checked`, not color alone.
- Segmented controls use a labelled group with roving arrow-key navigation.
- Scrub controls expose a keyboard-equivalent spinbutton and announce value,
  min/max, and unit.
- Menus/popovers move focus inside, close on Escape/outside click, and restore
  focus to the trigger. The color popover traps focus while open.
- Section expansion is retained while reopening the same annotation in the
  current Preview mount, but resets for a different element/navigation.
- Light/dark themes, 100–200% browser zoom, and high-contrast focus outlines
  are part of visual acceptance.

## Implementation sequence

1. Verify the real DSH `Menu` portal/custom-value/focus behavior and confirm no
   DSH color/number/popover primitive exists; document any local primitive seam.
2. Replace the static property config with typed metadata for kind, units,
   bounds, presets, visibility, and group.
3. Implement and unit-test `OptionMenu`, `ToggleButton`, `SegmentedControl`,
   `ScrubNumber`, `ColorControl`, `BoxModelControl`, and composite effect parsers.
4. Recompose `AnnotationEditor` from contextual sections; remove target strip;
   keep the check footer sticky and values right-aligned.
5. Preserve current `updateProperty` validation/live preview and rollback
   contracts behind the new controls.
6. Add component tests for keyboard, scrubbing, linked sides, conditional
   controls, color alpha, B/I/U, reset, and check placement.
7. Add browser assertions for right alignment, width, sticky check, no target
   strip, contextual section visibility, and real live preview.
8. Run `pnpm check --e2e`, start the real `pnpm dev`/`dsh web` composition,
   inspect the rendered editor at narrow and wide preview sizes, and iterate on
   screenshots before completion.

Implementation proceeds in three internal phases, all required for this goal:

- Phase 1: shell/right alignment/sticky check/title removal, DSH option menus,
  B/I/U/alignment, color, numeric scrubbing, raw fallback and state machine.
- Phase 2: contextual layout, W/H, box spacing, border and linked controls.
- Phase 3: lossless simple shadow/transform editors, font search/presets,
  advanced constraints and full visual/accessibility matrix.

## Acceptance criteria

- No native `<select>` exists in the editor.
- Bold, italic, underline, and alignment are recognizable direct controls.
- Color is edited through a swatch/picker with alpha, not a lone CSS textbox.
- Numeric values support typing, arrows, and horizontal scrubbing.
- Layout-dependent controls appear only when meaningful.
- Values are visually right-aligned and never collapse when reset is absent.
- The redundant selected-element title strip is absent.
- The expanded lower-right check remains visible while the inspector scrolls.
- All wire/context/rollback semantics and limits remain unchanged.
- A clean real `dsh web` run and the full automated gate both pass.
- `canConfirm` is false for a completely empty annotation and true for comment-
  only, style-only, text-only, and mixed annotations.
- Geometry tests prove value width ≥120px at 320px editor width, controls are
  right-aligned within 1px, and the check plus final row remain visible after
  scrolling to the end.
- Keyboard tests cover B/I/U, segmented arrow navigation, scrub increments,
  and each Escape layer; raw-value tests cover `var()`, `calc()`, transparent,
  combined decoration, multiple shadows, and matrix transforms.
