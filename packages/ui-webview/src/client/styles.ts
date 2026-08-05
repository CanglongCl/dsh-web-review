/**
 * Panel styles: one plain stylesheet injected by the apply effect (no CSS
 * module pipeline — the external bundle stays dependency-light). All classes
 * carry the `wv-` prefix to avoid collisions with page/GUI styles.
 *
 * The vocabulary mirrors the dsh web design system (ui-theme): every color
 * resolves through the `--dsw-alias-*` tokens, typography rides the
 * `--dsw-font-*` composite variables, motion uses the shared ease curve,
 * interactive elements get the business-primary focus ring, and the panel —
 * an elevated surface — rebinds the scrollbar indirection to the l2 pair
 * (see ui-theme styles/scrollbar.css for the rebinding contract). Fallbacks
 * stay neutral so the sheet degrades gracefully outside the GUI.
 */

export const WEBVIEW_CSS = `
.wv-panel,
.wv-panel *,
.wv-panel *::before,
.wv-panel *::after {
  box-sizing: border-box;
}

/* ---------- header action (session header trigger) ---------- */
.wv-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 28px;
  padding: 3px 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary, #81858c);
  font: var(--dsw-font-xxs-12, 12px/18px system-ui, sans-serif);
  cursor: pointer;
  transition: background-color 120ms var(--ds-ease-in-out, ease), color 120ms var(--ds-ease-in-out, ease);
}
.wv-toggle:hover,
.wv-toggle[aria-pressed="true"] {
  color: var(--dsw-alias-label-primary, #0f1115);
  background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06));
}
.wv-toggle:focus-visible {
  outline: 1px solid var(--dsw-alias-state-business-primary, #4176e6);
  outline-offset: 1px;
}
.wv-toggle-icon {
  flex: none;
  color: inherit;
}

/* ---------- floating panel surface ---------- */
.wv-panel {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 40;
  display: flex;
  flex-direction: column;
  min-width: 320px;
  background: var(--dsw-alias-bg-base, #ffffff);
  border-left: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  box-shadow: var(--dsw-shadow-lv3, -8px 0 24px rgba(0, 0, 0, 0.12));
  font: var(--dsw-font-xs-13, 13px/20px system-ui, sans-serif);
  color: var(--dsw-alias-label-primary, #0f1115);
  /* Elevated surface: the scrolling regions inside take the l2 scrollbar pair. */
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2, rgba(0, 0, 0, 0.2));
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2, rgba(0, 0, 0, 0.3));
}
.wv-resize {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  width: 5px;
  cursor: ew-resize;
  touch-action: none;
  transition: background-color 120ms var(--ds-ease-in-out, ease);
}
.wv-resize:hover {
  background: var(--dsw-alias-state-business-primary, #4176e6);
  opacity: 0.4;
}

/* ---------- header: title row ---------- */
.wv-header {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px 4px 14px;
}
.wv-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font: var(--dsw-font-xs-strong-13, 500 13px/20px system-ui, sans-serif);
  color: var(--dsw-alias-label-primary, #0f1115);
  white-space: nowrap;
}
.wv-title-icon {
  flex: none;
  color: var(--dsw-alias-label-tertiary, #61666b);
}

/* ---------- url row (input + refresh + external + pick) ---------- */
.wv-urlrow {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
  padding: 4px 10px 8px 10px;
}
.wv-url {
  flex: 1 1 auto;
  min-width: 0;
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

/* ---------- body: preview + comment chips ---------- */
.wv-body {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.wv-frame-wrap {
  flex: 0 1 auto;
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

/* ---------- preview/chips splitter ---------- */
.wv-split {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 7px;
  cursor: ns-resize;
  touch-action: none;
}
.wv-split::before {
  content: '';
  width: 100%;
  height: 2px;
  border-radius: 1px;
  background: var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  transition: background-color 120ms var(--ds-ease-in-out, ease);
}
.wv-split:hover::before,
.wv-split[data-dragging]::before {
  background: var(--dsw-alias-state-business-primary, #4176e6);
}

/* ---------- comment chip bar (horizontal, left-to-right) ---------- */
.wv-chips {
  flex: 1 1 auto;
  min-height: 84px;
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  gap: 6px;
  padding: 8px 10px 10px;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.wv-chips-head {
  flex: 1 1 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 2px 2px;
}
.wv-chips-label {
  font: var(--dsw-font-xxs-strong-12, 500 12px/18px system-ui, sans-serif);
  color: var(--dsw-alias-label-secondary, #4b4f57);
}
.wv-chips-count {
  display: inline-grid;
  place-items: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  font: var(--dsw-font-xxs-12, 12px/18px system-ui, sans-serif);
  color: var(--dsw-alias-label-secondary, #4b4f57);
  background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06));
}
.wv-chips-empty {
  flex: 1 1 100%;
  padding: 6px 2px;
  font: var(--dsw-font-xxs-12, 12px/18px system-ui, sans-serif);
  line-height: 1.6;
  color: var(--dsw-alias-label-caption, #a0a4ab);
}
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
.wv-chip-flash {
  animation: wv-chip-flash 1.2s var(--ds-ease-in-out, ease);
}
@keyframes wv-chip-flash {
  0%, 100% { background: var(--dsw-alias-bg-module-platform, #f5f6f7); }
  35% { background: var(--dsw-alias-state-business-tertiary, #e4edfd); border-color: var(--dsw-alias-state-business-primary, #4176e6); }
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

/* ---------- footer ---------- */
.wv-footer {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px 10px;
  border-top: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
}
.wv-error {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 5px;
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
.wv-send {
  flex: 1 1 auto;
  min-width: 0;
}
.wv-send:disabled {
  opacity: 0.4;
}

@keyframes wv-spin {
  to { transform: rotate(360deg); }
}
.wv-spin {
  animation: wv-spin 1s linear infinite;
}

@media (prefers-reduced-motion: reduce) {
  .wv-toggle,
  .wv-icon,
  .wv-chip,
  .wv-chip-flash,
  .wv-resize,
  .wv-split::before {
    transition: none;
    animation: none;
  }
  .wv-spin {
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
