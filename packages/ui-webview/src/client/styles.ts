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

/* ---------- url row ---------- */
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
.wv-icon-danger:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover-danger, rgba(236, 19, 19, 0.05));
  color: var(--dsw-alias-state-error-primary, #ec1313);
}

/* ---------- toolbar ---------- */
.wv-toolbar {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px 10px 8px 10px;
  border-top: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.04));
}
.wv-seg {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  border-radius: 8px;
  background: var(--dsw-alias-bg-module-platform, #f5f6f7);
}
.wv-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary, #61666b);
  font: var(--dsw-font-xxs-12, 12px/18px system-ui, sans-serif);
  cursor: pointer;
  transition: background-color 120ms var(--ds-ease-in-out, ease), color 120ms var(--ds-ease-in-out, ease);
}
.wv-chip:hover:not(:disabled) {
  color: var(--dsw-alias-label-primary, #0f1115);
  background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06));
}
.wv-chip[aria-pressed="true"]:not(:disabled) {
  color: var(--dsw-alias-label-primary, #0f1115);
  background: var(--dsw-alias-interactive-bg-active, rgba(38, 49, 72, 0.1));
}
.wv-chip:disabled {
  color: var(--dsw-alias-label-dimmed, #a9adb4);
  cursor: not-allowed;
}
.wv-chip:focus-visible {
  outline: 1px solid var(--dsw-alias-state-business-primary, #4176e6);
  outline-offset: 1px;
}
/* The pick arm state rides the business accent (tertiary fill + primary text);
   double class keeps it above the shared hover/pressed rules. */
.wv-chip-pick[aria-pressed="true"]:not(:disabled) {
  color: var(--dsw-alias-state-business-primary, #4176e6);
  background: var(--dsw-alias-state-business-tertiary, #e4edfd);
}
.wv-chip-icon {
  flex: none;
  color: inherit;
}
.wv-hint {
  flex: 1 1 100%;
  font: var(--dsw-font-xxxs-11, 11px/14px system-ui, sans-serif);
  color: var(--dsw-alias-label-caption, #a0a4ab);
}

/* ---------- body: preview + annotations ---------- */
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

/* ---------- preview/annotations splitter ---------- */
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

/* ---------- annotations list ---------- */
.wv-annotations {
  flex: 1 1 auto;
  min-height: 120px;
  overflow-y: auto;
  overscroll-behavior: contain;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px 10px;
}
.wv-annotations-head {
  display: flex;
  flex: none;
  align-items: center;
  gap: 6px;
  padding: 0 2px 2px;
}
.wv-annotations-label {
  font: var(--dsw-font-xxs-strong-12, 500 12px/18px system-ui, sans-serif);
  color: var(--dsw-alias-label-secondary, #4b4f57);
}
.wv-annotations-count {
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
.wv-empty {
  padding: 10px 2px;
  font: var(--dsw-font-xxs-12, 12px/18px system-ui, sans-serif);
  line-height: 1.6;
  color: var(--dsw-alias-label-caption, #a0a4ab);
}

/* ---------- pick cards ---------- */
.wv-pick {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  border-radius: 12px;
  background: var(--dsw-alias-bg-module-platform, #f5f6f7);
}
.wv-pick-head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.wv-pick-index {
  display: inline-grid;
  place-items: center;
  flex: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  font: var(--dsw-font-xxs-strong-12, 500 12px/18px system-ui, sans-serif);
  color: var(--dsw-alias-label-secondary, #4b4f57);
  background: var(--dsw-alias-bg-overlay, #e9ecf2);
}
.wv-pick-selector {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: var(--dsw-font-markdown-code-block-small, 12px/18px var(--ds-font-family-code, ui-monospace, monospace));
  color: var(--dsw-alias-label-secondary, #4b4f57);
  background: var(--dsw-alias-markdown-inline-code, #eef0f3);
  border-radius: 6px;
  padding: 0 6px;
}
.wv-pick-snippet {
  font: var(--dsw-font-markdown-code-block-small, 12px/18px var(--ds-font-family-code, ui-monospace, monospace));
  color: var(--dsw-alias-label-tertiary, #61666b);
  background: var(--dsw-alias-markdown-code-block, #f9fafb);
  border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.04));
  border-radius: 8px;
  padding: 6px 8px;
  margin: 0;
  max-height: 120px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
.wv-comment {
  font: var(--dsw-font-xxs-12, 12px/18px system-ui, sans-serif);
  padding: 5px 8px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  border-radius: 8px;
  background: var(--dsw-alias-bg-base, #ffffff);
  color: var(--dsw-alias-label-primary, #0f1115);
  caret-color: var(--dsw-alias-state-business-primary, #4176e6);
  resize: vertical;
  min-height: 44px;
}
.wv-comment::placeholder {
  color: var(--dsw-alias-label-caption, #a0a4ab);
}
.wv-comment:focus {
  outline: none;
  border-color: var(--dsw-alias-state-business-primary, #4176e6);
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
  .wv-resize,
  .wv-split::before {
    transition: none;
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
