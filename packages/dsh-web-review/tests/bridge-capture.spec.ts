// @vitest-environment jsdom
/** Cleaned-clone serialization and SVG screenshot pipeline tests. */
import { afterEach, describe, expect, it } from 'vitest'
import {
  MAX_CAPTURE_ELEMENTS,
  capturePagePng,
  capturePageSnapshot,
  cleanPageClone,
  serializePageHtml,
  type SvgRenderer,
} from '../src/bridge/capture.ts'
import { MAX_SNAPSHOT_HTML, SNAPSHOT_HTML_TRUNCATION_MARKER } from '../src/snapshot-contract.ts'

function fixture(): void {
  document.documentElement.innerHTML = '<head><title>fixture</title></head><body></body>'
  document.body.innerHTML = '<main id="app"><h1 class="hero">Example Domain</h1>'
    + '<p>Text to keep</p><script>window.__evil = true</script></main>'
  const marker = document.createElement('div')
  marker.className = 'dsh-wv-marker'
  marker.textContent = '1'
  document.body.appendChild(marker)
  const selection = document.createElement('div')
  selection.className = 'dsh-wv-selection-box'
  document.body.appendChild(selection)
  const pickerStyle = document.createElement('style')
  pickerStyle.dataset.dshWebReview = 'picker'
  document.head.appendChild(pickerStyle)
  const heading = document.querySelector('h1')
  heading?.setAttribute('data-dsh-wv-hover', '')
}

afterEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
  document.documentElement.innerHTML = ''
})

describe('cleanPageClone', () => {
  it('removes plugin chrome, capture attributes and scripts while keeping page content', () => {
    fixture()
    const { clone } = cleanPageClone(document)
    const html = clone.outerHTML
    expect(html).toContain('Example Domain')
    expect(html).toContain('Text to keep')
    expect(html).not.toContain('dsh-wv-marker')
    expect(html).not.toContain('dsh-wv-selection-box')
    expect(html).not.toContain('data-dsh-web-review')
    expect(html).not.toContain('data-dsh-wv-hover')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('__evil')
  })
})

describe('serializePageHtml', () => {
  it('prepends the doctype and marks truncation beyond the cap', () => {
    fixture()
    const { clone } = cleanPageClone(document)
    const serialized = serializePageHtml(clone)
    expect(serialized.truncated).toBe(false)
    expect(serialized.html.startsWith('<!doctype html>')).toBe(true)
    const marker = document.createElement('div')
    marker.textContent = 'x'.repeat(MAX_SNAPSHOT_HTML + 64)
    const large = serializePageHtml(marker)
    expect(large.truncated).toBe(true)
    expect(large.html).toContain(SNAPSHOT_HTML_TRUNCATION_MARKER)
  })
})

describe('capturePagePng', () => {
  it('renders a full-page SVG with the clone inside a foreignObject', async () => {
    fixture()
    let capturedSvg = ''
    let capturedWidth = 0
    let capturedHeight = 0
    const render: SvgRenderer = async (svg, width, height) => {
      capturedSvg = svg
      capturedWidth = width
      capturedHeight = height
      return 'data:image/png;base64,iVBORw0KGgo='
    }
    const shot = await capturePagePng(document, render)
    expect('screenshot' in shot).toBe(true)
    expect(capturedSvg).toContain('<foreignObject')
    expect(capturedSvg).toContain('Example Domain')
    expect(capturedSvg).not.toContain('dsh-wv-marker')
    expect(capturedWidth).toBeGreaterThan(0)
    expect(capturedHeight).toBeGreaterThan(0)
  })

  it('degrades with an error when the canvas is tainted', async () => {
    fixture()
    const render: SvgRenderer = async () => {
      throw new DOMException('tainted', 'SecurityError')
    }
    const shot = await capturePagePng(document, render)
    expect(shot).toEqual({ error: 'screenshot canvas tainted by cross-origin content' })
  })

  it('degrades with an error when the page exceeds the element cap', async () => {
    document.documentElement.innerHTML = '<head></head><body></body>'
    for (let index = 0; index < MAX_CAPTURE_ELEMENTS + 1; index += 1) {
      const node = document.createElement('div')
      document.body.appendChild(node)
    }
    const render: SvgRenderer = async () => 'data:image/png;base64,iVBORw0KGgo='
    const shot = await capturePagePng(document, render)
    expect(shot).toEqual({ error: 'page too large for screenshot capture' })
  })
})

describe('capturePageSnapshot', () => {
  it('assembles the archival HTML and the screenshot in one result', async () => {
    fixture()
    const render: SvgRenderer = async () => 'data:image/png;base64,iVBORw0KGgo='
    const captured = await capturePageSnapshot(document, render)
    expect(captured.html.startsWith('<!doctype html>')).toBe(true)
    expect(captured.screenshot).not.toBeNull()
    expect(captured.screenshotError).toBeNull()
    expect(captured.viewport.width).toBeGreaterThan(0)
    expect(captured.scroll.x).toBeGreaterThanOrEqual(0)
  })

  it('keeps the HTML archive when the screenshot cannot render', async () => {
    fixture()
    const render: SvgRenderer = async () => {
      throw new Error('canvas unavailable')
    }
    const captured = await capturePageSnapshot(document, render)
    expect(captured.html).toContain('Example Domain')
    expect(captured.screenshot).toBeNull()
    expect(captured.screenshotError).toBe('screenshot rendering failed')
  })
})
