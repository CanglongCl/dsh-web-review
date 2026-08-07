/**
 * Webview styles: one plain stylesheet injected by the apply effect (no CSS
 * module pipeline — the external bundle stays dependency-light). All classes
 * carry the `wv-` prefix to avoid collisions with page/GUI styles.
 *
 * The vocabulary mirrors the dsh web design system (ui-theme): every color
 * resolves through the `--dsw-alias-*` tokens, typography rides the
 * `--dsw-font-*` composite variables, motion uses the shared ease curve,
 * interactive elements get the business-primary focus ring, and the preview
 * tab — an elevated surface — rebinds the scrollbar indirection to the l2
 * pair (see ui-theme styles/scrollbar.css for the rebinding contract).
 * Fallbacks stay neutral so the sheet degrades gracefully outside the GUI.
 */

export const WEBVIEW_CSS = `
.wv-panel,
.wv-panel *,
.wv-panel *::before,
.wv-panel *::after {
  box-sizing: border-box;
}

/* ---------- preview tab surface (fills the conversation view area) ---------- */
.wv-panel {
  position: static;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--dsw-alias-bg-base, #ffffff);
  font: var(--dsw-font-xs-13, 13px/20px system-ui, sans-serif);
  color: var(--dsw-alias-label-primary, #0f1115);
  /* Elevated surface: the scrolling regions inside take the l2 scrollbar pair. */
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2, rgba(0, 0, 0, 0.2));
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2, rgba(0, 0, 0, 0.3));
}

/* ---------- url row (input + refresh + external + pick) ---------- */
.wv-urlrow {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
  padding: 8px 10px 4px 10px;
}
.wv-url {
  flex: 1 1 auto;
  min-width: 0;
}

/* ---------- inline error strip (under the url row) ---------- */
.wv-error {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 0 10px 6px;
  font: var(--dsw-font-xxs-12, 12px/18px system-ui, sans-serif);
  color: var(--dsw-alias-state-error-primary, #ec1313);
}
.wv-error-icon {
  flex: none;
  color: inherit;
}
.wv-error span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---------- icon button ---------- */
.wv-icon {
  display: inline-grid;
  place-items: center;
  flex: none;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary, #61666b);
  cursor: pointer;
  transition: background-color 120ms var(--ds-ease-in-out, ease), color 120ms var(--ds-ease-in-out, ease);
}
.wv-icon:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06));
  color: var(--dsw-alias-label-primary, #0f1115);
}
.wv-icon:disabled {
  color: var(--dsw-alias-label-dimmed, #a9adb4);
  cursor: default;
}
.wv-icon:focus-visible {
  outline: 1px solid var(--dsw-alias-state-business-primary, #4176e6);
  outline-offset: 1px;
}
/* Armed pick mode rides the business accent (tertiary fill + primary glyph). */
.wv-icon-accent {
  color: var(--dsw-alias-state-business-primary, #4176e6);
  background: var(--dsw-alias-state-business-tertiary, #e4edfd);
}
.wv-icon-accent:hover:not(:disabled) {
  color: var(--dsw-alias-state-business-primary, #4176e6);
  background: var(--dsw-alias-state-business-tertiary, #e4edfd);
}

/* ---------- pick-mode hint strip ---------- */
.wv-hint {
  flex: 0 0 auto;
  padding: 0 10px 6px 10px;
  font: var(--dsw-font-xxxs-11, 11px/14px system-ui, sans-serif);
  color: var(--dsw-alias-label-caption, #a0a4ab);
}

/* ---------- body: the preview iframe fills the remaining space ---------- */
.wv-body {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.wv-frame-wrap {
  flex: 1 1 auto;
  min-height: 140px;
  position: relative;
  overflow: hidden;
  background: var(--dsw-alias-bg-module-platform, #f5f6f7);
}
.wv-frame {
  width: 100%;
  height: 100%;
  border: 0;
  display: block;
}
.wv-frame-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  text-align: center;
  font: var(--dsw-font-xxs-12, 12px/18px system-ui, sans-serif);
  color: var(--dsw-alias-label-caption, #a0a4ab);
  background: var(--dsw-alias-bg-module-platform, #f5f6f7);
}

/* ---------- annotation dock (conversation.input.dock strip) ---------- */
.wv-annotations-bar,
.wv-annotations-bar *,
.wv-annotations-bar *::before,
.wv-annotations-bar *::after {
  box-sizing: border-box;
}
.wv-annotations-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  width: 100%;
  padding: 4px 10px 6px;
}
.wv-annotations-label {
  flex: none;
  font: var(--dsw-font-xxs-strong-12, 500 12px/18px system-ui, sans-serif);
  color: var(--dsw-alias-label-secondary, #4b4f57);
  white-space: nowrap;
}

/* ---------- annotation chip (shared by the dock) ---------- */
.wv-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  height: 24px;
  padding: 0 3px 0 3px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  border-radius: 12px;
  background: var(--dsw-alias-bg-module-platform, #f5f6f7);
  color: var(--dsw-alias-label-primary, #0f1115);
  font: var(--dsw-font-xxs-12, 12px/18px system-ui, sans-serif);
  cursor: pointer;
  transition: background-color 120ms var(--ds-ease-in-out, ease), border-color 120ms var(--ds-ease-in-out, ease);
}
.wv-chip:hover {
  border-color: var(--dsw-alias-border-l3, rgba(0, 0, 0, 0.12));
  background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06));
}
.wv-chip:focus-visible {
  outline: 1px solid var(--dsw-alias-state-business-primary, #4176e6);
  outline-offset: 1px;
}
.wv-chip-index {
  display: inline-grid;
  place-items: center;
  flex: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  font: var(--dsw-font-xxs-strong-12, 500 12px/18px system-ui, sans-serif);
  color: var(--dsw-alias-label-primary-foreground, #ffffff);
  background: var(--dsw-alias-state-business-primary, #4176e6);
}
.wv-chip-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 160px;
  font-family: var(--ds-font-family-code, ui-monospace, monospace);
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-secondary, #4b4f57);
}
.wv-chip-comment {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 180px;
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary, #61666b);
}
.wv-chip-comment::before {
  content: '·';
  margin-right: 5px;
  color: var(--dsw-alias-label-caption, #a0a4ab);
}
.wv-chip-remove {
  display: inline-grid;
  place-items: center;
  flex: none;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--dsw-alias-label-dimmed, #a9adb4);
  cursor: pointer;
  transition: background-color 120ms var(--ds-ease-in-out, ease), color 120ms var(--ds-ease-in-out, ease);
}
.wv-chip-remove:hover {
  background: var(--dsw-alias-interactive-bg-hover-danger, rgba(236, 19, 19, 0.05));
  color: var(--dsw-alias-state-error-primary, #ec1313);
}

@media (prefers-reduced-motion: reduce) {
  .wv-icon,
  .wv-chip {
    transition: none;
    animation: none;
  }
}
`

/** Inject the panel stylesheet once; the disposer removes the tag. */
export function injectWebviewCss(id: string): () => void {
  const tagId = 'ui-webview'
  if (document.querySelector(`style[data-plugin-css="${tagId}"]`) !== null) return () => {}
  const tag = document.createElement('style')
  tag.dataset.plugin = id
  tag.dataset.pluginCss = tagId
  tag.textContent = WEBVIEW_CSS
  document.head.appendChild(tag)
  return () => { tag.remove() }
}
