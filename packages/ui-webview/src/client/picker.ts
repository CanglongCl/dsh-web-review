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
 * Beyond picking, the injected surface owns the annotation echo layer:
 *   - numbered marker circles floating over each picked element
 *     (`syncMarkers`, repositioned on scroll/resize), clickable to re-open
 *     that element's comment (`onMarkClick`);
 *   - a floating comment field next to the element (`openComment`), where
 *     Enter commits (`onCommentCommit`) and Esc dismisses
 *     (`onCommentDismiss`).
 *
 * The page DOM is untrusted data, read-only: the script never evaluates page
 * content and never writes into the page beyond its own attribute markers,
 * style sheet, and the marker/comment nodes it appends.
 */
import { ANNOTATION_LIMITS } from '../annotation-contract.ts'
import { cssPath, snapshotOf } from './picker-core.ts'
import type { ElementSnapshot } from './contract.ts'

/** Style sheet injected into the iframe document (hover marker + echo layer). */
const PICKER_STYLE = `
[data-dsh-wv-hover] {
  outline: 2px solid #4176e6 !important;
  outline-offset: -2px !important;
  background-color: rgba(65, 118, 230, 0.10) !important;
}
[data-dsh-wv-selected] {
  outline: 2px solid #679efe !important;
  outline-offset: 2px !important;
  background-color: rgba(65, 118, 230, 0.10) !important;
}
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
.dsh-wv-comment {
  position: fixed !important;
  z-index: 2147483001 !important;
  box-sizing: border-box;
  width: 260px;
  max-width: calc(100vw - 16px);
  padding: 0;
  background: transparent;
}
.dsh-wv-comment-input {
  box-sizing: border-box;
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border: 1px solid rgba(0, 0, 0, 0.18) !important;
  border-radius: 8px;
  background: #ffffff !important;
  color: #111111 !important;
  font: 13px/32px system-ui, -apple-system, "Segoe UI", "PingFang SC", sans-serif !important;
  outline: 2px solid rgba(65, 118, 230, 0.45) !important;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18) !important;
}
.dsh-wv-comment-input::placeholder { color: #8a8f98 !important; }
`

/** The picker handoff the parent sets on the iframe's window before activate. */
export interface PickerHandoff {
  onPick: (el: Element) => void
  onCancel: () => void
}

/** One marker entry: the element plus the number to render. */
export interface MarkerEntry {
  id: string
  index: number
  element: Element
}

/** The picker surface inside the iframe window (typed view of the injected object). */
export interface PickerSurface {
  activate: () => void
  deactivate: () => void
  isActive: () => boolean
  onPick: PickerHandoff['onPick'] | null
  onCancel: PickerHandoff['onCancel'] | null
  /** A numbered marker circle was clicked (re-open that element's comment). */
  onMarkClick: ((id: string) => void) | null
  /** Enter on the floating comment field (commit the annotation). */
  onCommentCommit: ((id: string, text: string) => void) | null
  /** Esc on the floating comment field (dismiss without committing). */
  onCommentDismiss: ((id: string) => void) | null
  /** Floating-field placeholder (locale-driven, set by the parent). */
  commentPlaceholder: string
  /** Reconcile the marker circles with the current annotation entries. */
  syncMarkers: (entries: readonly MarkerEntry[]) => void
  /** Show the floating comment field next to `element`, pre-filled with `value`. */
  openComment: (id: string, element: Element, value: string) => void
  /** Hide the floating comment field without committing. */
  closeComment: () => void
}

declare global {
  interface Window {
    __dshWebviewPicker?: PickerSurface
  }
}

/**
 * Script source evaluated in the iframe document (idempotent, marker-guarded).
 * Keep it dependency-free: plain ES5-style functions, string concatenation,
 * no template literals (the string is authored inside a TS template).
 */
export const PICKER_SCRIPT = `(function () {
  if (window.__dshWebviewPicker) return;
  var active = false;
  var hovered = null;
  var selectedEl = null; // the element whose comment field is open
  var markers = new Map(); // id -> { el, circle }
  var comment = null;      // { wrap, input, el, id }
  var repositionQueued = false;

  // Panel chrome (markers, comment field) is never a pick target and owns
  // its own clicks.
  function isChrome(el) {
    while (el && el !== document.documentElement) {
      if (el.classList &&
          (el.classList.contains('dsh-wv-marker') ||
           el.classList.contains('dsh-wv-comment') ||
           el.classList.contains('dsh-wv-comment-input'))) {
        return true;
      }
      el = el.parentElement;
    }
    return false;
  }

  function clearHover() {
    if (hovered) { hovered.removeAttribute('data-dsh-wv-hover'); hovered = null; }
  }
  function setSelected(el) {
    if (selectedEl === el) return;
    clearSelected();
    selectedEl = el;
    selectedEl.setAttribute('data-dsh-wv-selected', '');
  }
  function clearSelected() {
    if (selectedEl) {
      selectedEl.removeAttribute('data-dsh-wv-selected');
      selectedEl = null;
    }
  }
  function onMouseOver(e) {
    if (!active) return;
    var el = e.target;
    if (!(el instanceof Element)) return;
    if (el === document.documentElement || el === document.body) return;
    if (isChrome(el) || el === selectedEl) return;
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
    if (isChrome(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    if (!hovered) return;
    var el = hovered;
    clearHover();
    // Already annotated: re-open its comment instead of a new pick.
    var existing = null;
    markers.forEach(function (m, id) { if (m.el === el) existing = id; });
    if (existing !== null) {
      if (window.__dshWebviewPicker.onMarkClick) window.__dshWebviewPicker.onMarkClick(existing);
      return;
    }
    if (window.__dshWebviewPicker.onPick) window.__dshWebviewPicker.onPick(el);
  }
  function onKeyDown(e) {
    // The floating field owns Enter/Esc while it is open.
    if (comment !== null) return;
    if (!active) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (window.__dshWebviewPicker.onCancel) window.__dshWebviewPicker.onCancel();
    }
  }
  function onScroll() { if (active || markers.size > 0) queueReposition(); }

  function queueReposition() {
    if (repositionQueued) return;
    repositionQueued = true;
    requestAnimationFrame(function () {
      repositionQueued = false;
      repositionMarkers();
    });
  }
  function repositionMarkers() {
    markers.forEach(function (m) {
      var r = m.el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) { m.circle.style.display = 'none'; return; }
      m.circle.style.display = '';
      m.circle.style.left = (r.left + r.width / 2) + 'px';
      m.circle.style.top = r.top + 'px';
    });
  }

  function syncMarkers(entries) {
    var seen = new Set();
    entries.forEach(function (entry) {
      seen.add(entry.id);
      var m = markers.get(entry.id);
      if (m) {
        m.el = entry.element;
        m.circle.textContent = String(entry.index);
      } else {
        var circle = document.createElement('div');
        circle.className = 'dsh-wv-marker';
        circle.textContent = String(entry.index);
        circle.addEventListener('click', function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          if (window.__dshWebviewPicker.onMarkClick) {
            window.__dshWebviewPicker.onMarkClick(entry.id);
          }
        });
        document.documentElement.appendChild(circle);
        markers.set(entry.id, { el: entry.element, circle: circle });
      }
    });
    markers.forEach(function (m, id) {
      if (!seen.has(id)) { m.circle.remove(); markers.delete(id); }
    });
    repositionMarkers();
  }

  function positionComment() {
    if (comment === null) return;
    var r = comment.el.getBoundingClientRect();
    var w = 260;
    var x = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - w - 8));
    var above = r.top - 46;
    var below = r.bottom + 8;
    comment.wrap.style.left = x + 'px';
    comment.wrap.style.top = (above >= 8 ? above : below) + 'px';
  }
  function openComment(id, element, value) {
    closeComment();
    setSelected(element);
    var wrap = document.createElement('div');
    wrap.className = 'dsh-wv-comment';
    var input = document.createElement('input');
    input.className = 'dsh-wv-comment-input';
    input.type = 'text';
    input.maxLength = ${ANNOTATION_LIMITS.comment};
    input.placeholder = window.__dshWebviewPicker.commentPlaceholder || 'Comment';
    input.value = value || '';
    wrap.appendChild(input);
    document.documentElement.appendChild(wrap);
    comment = { wrap: wrap, input: input, el: element, id: id };
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        ev.stopPropagation();
        var text = input.value;
        closeComment();
        if (window.__dshWebviewPicker.onCommentCommit) {
          window.__dshWebviewPicker.onCommentCommit(id, text);
        }
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        closeComment();
        if (window.__dshWebviewPicker.onCommentDismiss) {
          window.__dshWebviewPicker.onCommentDismiss(id);
        }
      }
    });
    positionComment();
    input.focus();
  }
  function closeComment() {
    if (comment !== null) {
      comment.wrap.remove();
      comment = null;
    }
    clearSelected();
  }

  window.__dshWebviewPicker = {
    activate: function () {
      active = true;
      document.documentElement.classList.add('dsh-wv-picking');
    },
    deactivate: function () {
      active = false;
      clearHover();
      clearSelected();
      document.documentElement.classList.remove('dsh-wv-picking');
    },
    isActive: function () { return active; },
    onPick: null,
    onCancel: null,
    onMarkClick: null,
    onCommentCommit: null,
    onCommentDismiss: null,
    commentPlaceholder: 'Comment',
    syncMarkers: syncMarkers,
    openComment: openComment,
    closeComment: closeComment,
  };
  document.addEventListener('mouseover', onMouseOver, true);
  document.addEventListener('mouseout', onMouseOut, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', onScroll, true);
})();`

/** Marker attribute proving the script/style were injected into the document. */
const INJECTED_MARKER = 'data-dsh-wv-injected'

/**
 * Try to resolve the picker surface on the iframe's window; null when the
 * frame is absent, cross-origin (contentWindow inaccessible), or not yet
 * injected.
 */
export function pickerOf(iframe: HTMLIFrameElement | null): PickerSurface | null {
  if (iframe === null) return null
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
 * @param comment - the committed comment text.
 */
export function pickFromElement(el: Element, id: string, comment: string): {
  id: string
  snapshot: ElementSnapshot
  comment: string
} {
  return { id, snapshot: snapshotOf(el), comment }
}

// Re-export for the panel's use: cssPath is also used to label picks.
export { cssPath, snapshotOf }
