/**
 * Panel styles: one plain stylesheet injected by the apply effect (no CSS
 * module pipeline — the external bundle stays dependency-light). All classes
 * carry the `wv-` prefix to avoid collisions with page/GUI styles. Colors
 * ride the GUI's `--dsw-alias-*` tokens with neutral fallbacks.
 */

export const WEBVIEW_CSS = `
.wv-toggle {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-dimmed, #8a8f98);
  font: inherit;
  font-size: 12px;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
}
.wv-toggle:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.12)); color: var(--dsw-alias-label-primary, #1f2329); }

.wv-panel {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 40;
  display: flex;
  flex-direction: column;
  background: var(--dsw-alias-bg-base, #ffffff);
  border-left: 1px solid var(--dsw-alias-border-l, rgba(128, 128, 128, 0.25));
  box-shadow: -8px 0 24px rgba(0, 0, 0, 0.12);
  font: 13px/1.5 system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  color: var(--dsw-alias-label-primary, #1f2329);
}
.wv-resize {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  width: 5px;
  cursor: ew-resize;
  touch-action: none;
}
.wv-resize:hover { background: var(--dsw-alias-brand-primary, #4c6ef5); opacity: 0.4; }
.wv-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l, rgba(128, 128, 128, 0.2));
  flex: 0 0 auto;
}
.wv-title { font-weight: 600; font-size: 13px; margin-right: 4px; white-space: nowrap; }
.wv-url {
  flex: 1 1 auto;
  min-width: 0;
  font: inherit;
  font-size: 12px;
  padding: 5px 8px;
  border: 1px solid var(--dsw-alias-border-l, rgba(128, 128, 128, 0.35));
  border-radius: 6px;
  background: var(--dsw-alias-bg-base, #ffffff);
  color: inherit;
}
.wv-url:focus { outline: 1px solid var(--dsw-alias-brand-primary, #4c6ef5); outline-offset: -1px; }
.wv-icon {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-dimmed, #8a8f98);
  font-size: 14px;
  line-height: 1;
  padding: 4px 6px;
  border-radius: 6px;
  cursor: pointer;
}
.wv-icon:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.12)); color: var(--dsw-alias-label-primary, #1f2329); }

.wv-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l, rgba(128, 128, 128, 0.2));
  flex: 0 0 auto;
  flex-wrap: wrap;
}
.wv-chip {
  font-size: 12px;
  padding: 3px 8px;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l, rgba(128, 128, 128, 0.3));
  background: transparent;
  color: var(--dsw-alias-label-dimmed, #8a8f98);
  cursor: pointer;
}
.wv-chip:hover { color: var(--dsw-alias-label-primary, #1f2329); }
.wv-chip[aria-pressed="true"] {
  background: var(--dsw-alias-brand-primary, #4c6ef5);
  border-color: var(--dsw-alias-brand-primary, #4c6ef5);
  color: var(--dsw-alias-brand-primary-invert, #ffffff);
}
.wv-hint { font-size: 11px; color: var(--dsw-alias-label-caption, #a0a4ab); flex: 1 1 100%; }

.wv-body { flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0; }
.wv-frame-wrap { flex: 1 1 55%; min-height: 120px; position: relative; background: #f4f5f7; }
.wv-frame { width: 100%; height: 100%; border: 0; display: block; }
.wv-frame-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  text-align: center;
  font-size: 12px;
  color: var(--dsw-alias-label-dimmed, #8a8f98);
  background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.08));
}

.wv-annotations {
  flex: 1 1 45%;
  min-height: 100px;
  overflow-y: auto;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-top: 1px solid var(--dsw-alias-border-l, rgba(128, 128, 128, 0.2));
}
.wv-empty { font-size: 12px; color: var(--dsw-alias-label-caption, #a0a4ab); padding: 8px 2px; }
.wv-pick {
  border: 1px solid var(--dsw-alias-border-l, rgba(128, 128, 128, 0.3));
  border-radius: 8px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.wv-pick-head { display: flex; align-items: center; gap: 6px; }
.wv-pick-selector {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.1));
  padding: 2px 6px;
  border-radius: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1 1 auto;
  min-width: 0;
}
.wv-pick-snippet {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10.5px;
  color: var(--dsw-alias-label-dimmed, #8a8f98);
  background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.06));
  border-radius: 4px;
  padding: 4px 6px;
  max-height: 96px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
}
.wv-comment {
  font: inherit;
  font-size: 12px;
  padding: 5px 8px;
  border: 1px solid var(--dsw-alias-border-l, rgba(128, 128, 128, 0.35));
  border-radius: 6px;
  background: var(--dsw-alias-bg-base, #ffffff);
  color: inherit;
  resize: vertical;
  min-height: 44px;
}
.wv-comment:focus { outline: 1px solid var(--dsw-alias-brand-primary, #4c6ef5); outline-offset: -1px; }

.wv-footer {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-top: 1px solid var(--dsw-alias-border-l, rgba(128, 128, 128, 0.2));
}
.wv-send {
  flex: 1 1 auto;
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  padding: 6px 12px;
  border: 0;
  border-radius: 6px;
  background: var(--dsw-alias-button-primary-fill, #4c6ef5);
  color: var(--dsw-alias-button-primary-invert, #ffffff);
  cursor: pointer;
}
.wv-send:hover { background: var(--dsw-alias-button-primary-hover, #3b5bdb); }
.wv-send:disabled { opacity: 0.55; cursor: default; }
.wv-error { font-size: 11.5px; color: #e03131; flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
