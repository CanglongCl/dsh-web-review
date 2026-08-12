/** Picker chrome injected by the isolated-frame bridge. */
export const PICKER_STYLE = `
[data-dsh-wv-hover] {
  outline: 2px solid #4176e6 !important;
  outline-offset: -2px !important;
  background-color: rgba(65, 118, 230, 0.10) !important;
}
[data-dsh-wv-selected] {
  background-color: rgba(65, 118, 230, 0.10) !important;
}
.dsh-wv-selection-box {
  position: fixed !important;
  z-index: 2147482999 !important;
  box-sizing: border-box !important;
  pointer-events: none !important;
  border: 2px solid #679efe !important;
  border-radius: 6px !important;
  background: transparent !important;
  opacity: 0;
  transition:
    left 180ms cubic-bezier(0.2, 0, 0, 1),
    top 180ms cubic-bezier(0.2, 0, 0, 1),
    width 180ms cubic-bezier(0.2, 0, 0, 1),
    height 180ms cubic-bezier(0.2, 0, 0, 1),
    opacity 100ms ease;
}
.dsh-wv-selection-box[data-visible] { opacity: 1; }
.dsh-wv-selection-box[data-static] { transition: none !important; }
.dsh-wv-picking, .dsh-wv-picking * { cursor: crosshair !important; }
.dsh-wv-marker {
  position: fixed !important;
  z-index: 2147483000 !important;
  box-sizing: border-box;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #4176e6 !important;
  color: #ffffff !important;
  font: 600 11px/18px system-ui, -apple-system, "Segoe UI", "PingFang SC", sans-serif !important;
  text-align: center;
  cursor: pointer !important;
  user-select: none;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35) !important;
  transform: translate(-50%, -50%);
}
.dsh-wv-marker:hover { background: #679efe !important; }
@media (prefers-reduced-motion: reduce) {
  .dsh-wv-selection-box {
    transition: opacity 100ms ease !important;
  }
}
`
