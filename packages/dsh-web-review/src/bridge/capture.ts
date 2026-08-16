/**
 * In-frame page capture: a cleaned DOM clone for archival plus a bounded
 * SVG-foreignObject screenshot. Everything here runs inside the isolated
 * Preview Origin; results are strictly re-decoded at the host boundary.
 */
import {
  MAX_SNAPSHOT_HTML,
  SNAPSHOT_HTML_TRUNCATION_MARKER,
  SNAPSHOT_LIMITS,
  type PageSnapshotScreenshot,
} from '../snapshot-contract.ts'

/** Maximum styled elements accepted by the screenshot pipeline. */
export const MAX_CAPTURE_ELEMENTS = 5_000
/** Maximum serialized SVG fed to the canvas renderer. */
export const MAX_SVG_BYTES = 8 * 1024 * 1024
/** Full-page capture bounds (CSS px); bigger pages fall back to the viewport. */
export const MAX_CAPTURE_WIDTH = 4_096
export const MAX_CAPTURE_HEIGHT = 8_192
/** Chromium canvas hard limit safety bound. */
export const MAX_CANVAS_SIDE = 16_384

/** Renderer seam: turns a serialized SVG into a PNG data URL. */
export type SvgRenderer = (svg: string, width: number, height: number) => Promise<string>

/** Full capture result crossing the bridge into the host. */
export interface PageCaptureResult {
  html: string
  viewport: { width: number; height: number }
  scroll: { x: number; y: number }
  screenshot: PageSnapshotScreenshot | null
  screenshotError: string | null
}

/**
 * Deep-clone the document without this plugin's chrome or page scripts.
 * Marker circles, the selection box, the injected picker stylesheet, every
 * data-dsh-wv-* attribute and all script elements are removed; page styles
 * and links stay verbatim for the archival HTML artifact.
 */
export function cleanPageClone(source: Document): { clone: HTMLElement; elements: number } {
  const clone = source.documentElement.cloneNode(true) as HTMLElement
  for (const element of Array.from(clone.querySelectorAll('*'))) {
    if (element.matches('.dsh-wv-marker,.dsh-wv-selection-box,style[data-dsh-web-review]')) {
      element.remove()
      continue
    }
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name.startsWith('data-dsh-wv-')) element.removeAttribute(attribute.name)
    }
    if (element.tagName.toLowerCase() === 'script') element.remove()
  }
  return { clone, elements: clone.querySelectorAll('*').length }
}

/** Serialize the cleaned clone, marking any byte-cap truncation. */
export function serializePageHtml(clone: HTMLElement): { html: string; truncated: boolean } {
  const full = '<!doctype html>' + clone.outerHTML
  if (full.length <= MAX_SNAPSHOT_HTML) return { html: full, truncated: false }
  return {
    html: full.slice(0, MAX_SNAPSHOT_HTML) + '\n' + SNAPSHOT_HTML_TRUNCATION_MARKER + ' ' + String(full.length) + ' bytes -->',
    truncated: true,
  }
}

/** Render the assembled SVG through a canvas; rejects on failure or taint. */
export async function renderSvgToPng(svg: string, width: number, height: number): Promise<string> {
  const image = new Image()
  const loaded = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error('screenshot render timed out')) }, 5_000)
    image.onload = () => { clearTimeout(timer); resolve() }
    image.onerror = () => { clearTimeout(timer); reject(new Error('screenshot render failed')) }
  })
  image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  await loaded
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('canvas 2d context unavailable')
  context.drawImage(image, 0, 0, width, height)
  return canvas.toDataURL('image/png')
}

/**
 * Build the screenshot pipeline: cleaned clone, computed styles inlined into
 * its parallel elements, XML serialization into an SVG foreignObject, then
 * canvas rendering. Degrades to an error message instead of throwing.
 */
export async function capturePagePng(
  source: Document,
  render: SvgRenderer = renderSvgToPng,
): Promise<{ screenshot: PageSnapshotScreenshot } | { error: string }> {
  const { clone, elements } = cleanPageClone(source)
  if (elements > MAX_CAPTURE_ELEMENTS) return { error: 'page too large for screenshot capture' }
  // The SVG carries inline computed styles only; authored sheets would
  // double-apply and their external URLs cannot load inside an SVG image.
  for (const node of Array.from(clone.querySelectorAll('style,link'))) node.remove()
  const viewport = { width: source.defaultView?.innerWidth ?? 0, height: source.defaultView?.innerHeight ?? 0 }
  const scrollWidth = Math.max(source.documentElement.scrollWidth, viewport.width)
  const scrollHeight = Math.max(source.documentElement.scrollHeight, viewport.height)
  const fullPageFits = scrollWidth <= MAX_CAPTURE_WIDTH && scrollHeight <= MAX_CAPTURE_HEIGHT
  const width = fullPageFits ? scrollWidth : viewport.width
  const height = fullPageFits ? scrollHeight : viewport.height
  const truncated = !fullPageFits

  // Style inlining walks both trees in lockstep: the clone preserves the
  // source structure exactly (cleanup removed chrome/script subtrees before
  // either walker was created), so parallel traversal stays aligned.
  const sourceWalker = source.createTreeWalker(source.documentElement, NodeFilter.SHOW_ELEMENT)
  const cloneWalker = clone.ownerDocument.createTreeWalker(clone, NodeFilter.SHOW_ELEMENT)
  let cloneNode = cloneWalker.nextNode() as Element | null
  for (;;) {
    if (cloneNode === null) break
    const sourceNode = sourceWalker.nextNode() as Element | null
    if (sourceNode === null) return { error: 'screenshot serialization failed' }
    const computed = source.defaultView?.getComputedStyle(sourceNode)
    if (computed !== undefined && computed.cssText !== '') {
      ;(cloneNode as HTMLElement).style.cssText = computed.cssText
    }
    cloneNode = cloneWalker.nextNode() as Element | null
  }
  let serialized: string
  try {
    serialized = new XMLSerializer().serializeToString(clone)
  } catch {
    return { error: 'screenshot serialization failed' }
  }
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + String(width) + '" height="' + String(height)
    + '"><foreignObject width="100%" height="100%">' + serialized + '</foreignObject></svg>'
  if (svg.length > MAX_SVG_BYTES) return { error: 'serialized page too large for screenshot capture' }
  const scale = Math.max(1, Math.min(
    2,
    Math.floor(MAX_CANVAS_SIDE / width),
    Math.floor(MAX_CANVAS_SIDE / height),
  ))
  try {
    const dataUrl = await render(svg, width * scale, height * scale)
    if (dataUrl.length > SNAPSHOT_LIMITS.dataUrl) return { error: 'screenshot exceeded the size cap' }
    return { screenshot: { dataUrl, width: width * scale, height: height * scale, truncated } }
  } catch (error) {
    return {
      error: error instanceof DOMException && error.name === 'SecurityError'
        ? 'screenshot canvas tainted by cross-origin content'
        : 'screenshot rendering failed',
    }
  }
}

/** Capture the archival HTML plus the best-effort screenshot for one send. */
export async function capturePageSnapshot(
  source: Document,
  render: SvgRenderer = renderSvgToPng,
): Promise<PageCaptureResult> {
  const { clone } = cleanPageClone(source)
  const serialized = serializePageHtml(clone)
  const shot = await capturePagePng(source, render)
  return {
    html: serialized.html,
    viewport: {
      width: source.defaultView?.innerWidth ?? 0,
      height: source.defaultView?.innerHeight ?? 0,
    },
    scroll: {
      x: source.defaultView?.scrollX ?? 0,
      y: source.defaultView?.scrollY ?? 0,
    },
    screenshot: 'screenshot' in shot ? shot.screenshot : null,
    screenshotError: 'error' in shot ? shot.error : null,
  }
}
