/**
 * Pure-function suite for the proxy rewriting surface (node half).
 */
import { describe, expect, it } from 'vitest'
import {
  decodeTarget,
  encodeTarget,
  isHttpUrl,
  isLocalPreviewUrl,
  proxyUrl,
  rewriteHtml,
  rewriteSrcset,
  rewriteTag,
  rewriteUrlValue,
} from '../src/rewrite.ts'

const BASE = 'http://localhost:5173/app/page.html'
const DIR = 'http://localhost:5173/app/'

describe('encodeTarget / decodeTarget / proxyUrl', () => {
  it('round-trips a full URL keeping slashes raw', () => {
    const url = 'http://example.com/a/b?x=1&y=%20#frag'
    expect(decodeTarget(encodeTarget(url))).toBe(url)
    expect(encodeTarget(url)).not.toContain('%2F')
  })

  it('builds a path-encoded proxy URL', () => {
    const url = proxyUrl('http://example.com/a?q=1')
    expect(url.startsWith('/webview-proxy/')).toBe(true)
    expect(url).toContain('http%3A//example.com/a%3Fq%3D1')
    expect(url).not.toContain('?')
  })

  it('proxyUrl defaults to the package prefix', () => {
    expect(proxyUrl('http://h/').startsWith('/webview-proxy/')).toBe(true)
    expect(proxyUrl('http://h/', '/custom')).toBe('/custom/http%3A//h/')
  })
})

describe('isHttpUrl', () => {
  it('accepts http(s) only', () => {
    expect(isHttpUrl('http://h/')).toBe(true)
    expect(isHttpUrl('https://h/')).toBe(true)
    expect(isHttpUrl('file:///x')).toBe(false)
    expect(isHttpUrl('javascript:void(0)')).toBe(false)
    expect(isHttpUrl('not a url')).toBe(false)
    expect(isHttpUrl('/relative')).toBe(false)
  })
})

describe('isLocalPreviewUrl', () => {
  it.each([
    'http://localhost:5173/',
    'https://app.localhost/',
    'http://127.0.0.1:3000/',
    'http://127.20.30.40/',
    'http://0.0.0.0:8080/',
    'http://[::1]:4173/',
  ])('accepts local development target %s', (url) => {
    expect(isLocalPreviewUrl(url)).toBe(true)
  })

  it.each([
    'https://example.com/',
    'http://192.168.1.20/',
    'http://dev.internal/',
    'ftp://localhost/',
    'http://user:password@localhost/',
  ])('rejects non-local target %s', (url) => {
    expect(isLocalPreviewUrl(url)).toBe(false)
  })
})

describe('rewriteUrlValue', () => {
  it('rewrites absolute http(s) URLs to proxy URLs', () => {
    expect(rewriteUrlValue('http://localhost:5173/x.png', DIR)).toBe(proxyUrl('http://localhost:5173/x.png'))
  })

  it('rewrites root-relative URLs by resolving against the page origin', () => {
    expect(rewriteUrlValue('/x.png', DIR)).toBe(proxyUrl('http://localhost:5173/x.png'))
  })

  it('leaves relative URLs for the injected base element', () => {
    expect(rewriteUrlValue('x.png', DIR)).toBe('x.png')
    expect(rewriteUrlValue('../up.png', DIR)).toBe('../up.png')
  })

  it('keeps non-http protocols and fragments untouched', () => {
    for (const value of ['javascript:void(0)', 'mailto:a@b.c', 'data:text/plain,x', 'tel:123', 'about:blank', 'blob:x', 'file:///x', '#frag', '?q=1', '']) {
      expect(rewriteUrlValue(value, DIR)).toBe(value)
    }
  })

  it('keeps cross-scheme bases unrewritten', () => {
    expect(rewriteUrlValue('ftp://example.com/x', DIR)).toBe('ftp://example.com/x')
  })

  it('keeps remote HTTP(S) resources browser-native instead of proxying them', () => {
    expect(rewriteUrlValue('https://cdn.example.com/x.js', DIR)).toBe('https://cdn.example.com/x.js')
  })
})

describe('rewriteSrcset', () => {
  it('rewrites each URL keeping descriptors', () => {
    const out = rewriteSrcset('a.png 1x, http://localhost:5173/b.png 2x, https://cdn.example/b.png 3x', DIR)
    expect(out).toBe(`a.png 1x, ${proxyUrl('http://localhost:5173/b.png')} 2x, https://cdn.example/b.png 3x`)
  })

  it('keeps data: candidates untouched', () => {
    expect(rewriteSrcset('data:image/png;base64,AAAA 1x', DIR)).toBe('data:image/png;base64,AAAA 1x')
  })
})

describe('rewriteTag', () => {
  it('rewrites quoted URL attributes and leaves others alone', () => {
    const tag = '<a href="http://localhost:5173/x" class="nav" title="a > b">'
    const out = rewriteTag(tag, DIR)
    expect(out).toContain(`href="${proxyUrl('http://localhost:5173/x')}"`)
    expect(out).toContain('class="nav"')
    expect(out).toContain('title="a > b"')
  })

  it('handles single-quoted and unquoted attribute forms', () => {
    expect(rewriteTag("<img src='/i.png'>", DIR)).toBe(`<img src="${proxyUrl('http://localhost:5173/i.png')}">`)
    expect(rewriteTag('<img src=/i.png>', DIR)).toBe(`<img src="${proxyUrl('http://localhost:5173/i.png')}">`)
  })

  it('rewrites form action including empty actions staying empty', () => {
    expect(rewriteTag('<form action="http://localhost:5173/submit">', DIR)).toBe(
      `<form action="${proxyUrl('http://localhost:5173/submit')}"></form>`,
    )
    expect(rewriteTag('<form action="">', DIR)).toBe('<form action=""></form>')
  })

  it('leaves boolean attributes intact', () => {
    expect(rewriteTag('<input checked disabled>', DIR)).toBe('<input checked="" disabled="">')
  })

  it('handles > inside quoted attribute values (quote-balanced tag scan)', () => {
    const tag = '<a data-note="x > y" href="http://localhost:5173/a">'
    const out = rewriteHtml(`<head></head><body>${tag}</body>`, BASE)
    expect(out).toContain(`href="${proxyUrl('http://localhost:5173/a')}"`)
    expect(out).toContain('data-note="x > y"')
  })
})

describe('rewriteHtml', () => {
  it('injects <base> as the first <head> child with the exact encoded page URL', () => {
    const out = rewriteHtml('<html><head><meta charset="utf-8"></head><body></body></html>', BASE)
    expect(out).toMatch(
      /<head><base href="\/webview-proxy\/http%3A\/\/localhost%3A5173\/app\/page\.html"><meta charset="utf-8">/,
    )
  })

  it('creates a head when the source omits it', () => {
    const out = rewriteHtml('<html lang="zh"><body>x</body></html>', BASE)
    expect(out).toMatch(/<html lang="zh"><head><base href="/)
  })

  it('normalizes a bare fragment into a document with a head-owned base', () => {
    const out = rewriteHtml('<div>bare</div>', BASE)
    expect(out).toMatch(/^<html><head><base href="[^\"]+"><\/head><body><div>bare<\/div>/)
  })

  it('rewrites attributes across the document', () => {
    const html = '<a href="http://localhost:5173/x">l</a><img src="/i.png"><link rel="stylesheet" href="s.css">'
    const out = rewriteHtml(html, BASE)
    expect(out).toContain(`href="${proxyUrl('http://localhost:5173/x')}"`)
    expect(out).toContain(`src="${proxyUrl('http://localhost:5173/i.png')}"`)
    expect(out).toContain('href="s.css"')
  })

  it('does not rewrite tag-shaped text in scripts or comments', () => {
    const script = `const markup = '<img src="/asset.png">'`
    const comment = '<!-- <a href="/not-a-link">comment</a> -->'
    const out = rewriteHtml(`<head><script>${script}</script>${comment}</head><body></body>`, BASE)
    expect(out).toContain(`<script>${script}</script>`)
    expect(out).toContain(comment)
    expect(out).not.toContain(proxyUrl('http://localhost:5173/asset.png'))
    expect(out).not.toContain(proxyUrl('http://localhost:5173/not-a-link'))
  })

  it('decodes entities before resolving URLs and serializes a safe attribute', () => {
    const out = rewriteHtml('<a href="/search?x=1&amp;y=2">search</a>', BASE)
    expect(out).toContain(`href="${proxyUrl('http://localhost:5173/search?x=1&y=2')}"`)
  })

  it('removes CSP meta directives case-insensitively', () => {
    const out = rewriteHtml([
      '<head>',
      '<meta http-equiv="Content-Security-Policy" content="default-src none">',
      '<meta HTTP-EQUIV="content-security-policy-report-only" content="report-uri /csp">',
      '<meta http-equiv="refresh" content="0;url=https://example.com/">',
      '<meta name="viewport" content="width=device-width">',
      '</head>',
    ].join(''), BASE)
    expect(out).not.toContain('Content-Security-Policy')
    expect(out).not.toContain('content-security-policy-report-only')
    expect(out).not.toContain('http-equiv="refresh"')
    expect(out).toContain('name="viewport"')
  })

  it('rewrites mixed-case HTML names through parser-normalized attributes', () => {
    const out = rewriteHtml('<IMG SrC="/asset.png"><A HREF="https://cdn.test/x">x</A>', BASE)
    expect(out).toContain(`src="${proxyUrl('http://localhost:5173/asset.png')}"`)
    expect(out).toContain('href="https://cdn.test/x"')
  })
})
