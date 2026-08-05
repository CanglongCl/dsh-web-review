/**
 * Picker injection: the script + style evaluated inside the same-origin
 * iframe document, and the parent-side bridge that drives it.
 *
 * The iframe is same-origin exactly when it loaded through /webview-proxy;
 * the parent then injects one `<style>` and one `<script>` (both authored
 * here as template strings — no build-time asset pipeline, no postMessage)
 * and drives the picker with direct cross-frame function references:
 *   iframe.contentWindow.__dshWebviewPicker.onPick = (el) => ...
 *   iframe.contentWindow.__dshWebviewPicker.onCancel = () => ...
 *   picker.activate() / picker.deactivate()
 *
 * The page DOM is untrusted data, read-only: the script never evaluates page
 * content and never writes into the page beyond its own attribute markers
 * and style sheet.
 */
import { cssPath, snapshotOf } from './picker-core.ts'
import type { ElementSnapshot } from './contract.ts'

/** Style sheet injected into the iframe document (hover marker + crosshair). */
const PICKER_STYLE = `
[data-dsh-wv-hover] {
  outline: 2px dashed #f59e0b !important;
  outline-offset: -2px !important;
  background-color: rgba(245, 158, 11, 0.08) !important;
}
.dsh-wv-picking, .dsh-wv-picking * { cursor: crosshair !important; }
`

/** The picker handoff the parent sets on the iframe's window before activate. */
export interface PickerHandoff {
  onPick: (el: Element) => void
  onCancel: () => void
}

/** The picker surface inside the iframe window (typed view of the injected object). */
export interface PickerSurface {
  activate: () => void
  deactivate: () => void
  isActive: () => boolean
  onPick: PickerHandoff['onPick'] | null
  onCancel: PickerHandoff['onCancel'] | null
}

declare global {
  interface Window {
    __dshWebviewPicker?: PickerSurface
  }
}

/** Script source evaluated in the iframe document (idempotent, marker-guarded). */
export const PICKER_SCRIPT = `(function () {
  if (window.__dshWebviewPicker) return;
  var active = false;
  var hovered = null;
  function clearHover() {
    if (hovered) { hovered.removeAttribute('data-dsh-wv-hover'); hovered = null; }
  }
  function onMouseOver(e) {
    if (!active) return;
    var el = e.target;
    if (!(el instanceof Element)) return;
    if (el === document.documentElement || el === document.body) return;
    if (hovered === el) return;
    clearHover();
    hovered = el;
    hovered.setAttribute('data-dsh-wv-hover', '');
  }
  function onMouseOut(e) {
    if (active && e.target === hovered) clearHover();
  }
  function onClick(e) {
    if (!active) return;
    e.preventDefault();
    e.stopPropagation();
    if (!hovered) return;
    var el = hovered;
    clearHover();
    if (window.__dshWebviewPicker.onPick) window.__dshWebviewPicker.onPick(el);
  }
  function onKeyDown(e) {
    if (!active) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (window.__dshWebviewPicker.onCancel) window.__dshWebviewPicker.onCancel();
    }
  }
  function onScroll() { if (active) clearHover(); }
  window.__dshWebviewPicker = {
    activate: function () {
      active = true;
      document.documentElement.classList.add('dsh-wv-picking');
    },
    deactivate: function () {
      active = false;
      clearHover();
      document.documentElement.classList.remove('dsh-wv-picking');
    },
    isActive: function () { return active; },
    onPick: null,
    onCancel: null,
  };
  document.addEventListener('mouseover', onMouseOver, true);
  document.addEventListener('mouseout', onMouseOut, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('scroll', onScroll, true);
})();`

/** Marker attribute proving the script/style were injected into the document. */
const INJECTED_MARKER = 'data-dsh-wv-injected'

/**
 * Try to resolve the picker surface on the iframe's window; null when
 * cross-origin (contentWindow inaccessible) or not yet injected.
 */
export function pickerOf(iframe: HTMLIFrameElement): PickerSurface | null {
  try {
    const win = iframe.contentWindow
    if (win === null || iframe.contentDocument === null) return null
    return win.__dshWebviewPicker ?? null
  } catch {
    return null // cross-origin
  }
}

/** True when the iframe content is same-origin (the picker can run). */
export function isSameOrigin(iframe: HTMLIFrameElement): boolean {
  try {
    return iframe.contentDocument !== null
  } catch {
    return false
  }
}

/**
 * Inject the picker script + style into the iframe document (idempotent per
 * document; re-inject after every navigation). Safe to call on cross-origin
 * frames — it returns null.
 * @param iframe - the proxied iframe.
 * @returns the picker surface when same-origin, else null.
 */
export function ensurePicker(iframe: HTMLIFrameElement): PickerSurface | null {
  const doc = iframe.contentDocument
  if (doc === null) return null
  if (doc.documentElement.getAttribute(INJECTED_MARKER) !== 'true') {
    const style = doc.createElement('style')
    style.setAttribute(INJECTED_MARKER, 'true')
    style.textContent = PICKER_STYLE
    doc.head.appendChild(style)
    const script = doc.createElement('script')
    script.setAttribute(INJECTED_MARKER, 'true')
    script.textContent = PICKER_SCRIPT
    doc.head.appendChild(script)
    doc.documentElement.setAttribute(INJECTED_MARKER, 'true')
  }
  return pickerOf(iframe)
}

/**
 * Build a PickItem from a picked element (caps enforced inside snapshotOf).
 * @param el - the element the picker handed over (untrusted page DOM, read-only).
 * @param id - a stable id for the entry.
 */
export function pickFromElement(el: Element, id: string): {
  id: string
  snapshot: ElementSnapshot
  comment: ''
} {
  return { id, snapshot: snapshotOf(el), comment: '' }
}

// Re-export for the panel's use: cssPath is also used to label picks.
export { cssPath, snapshotOf }
