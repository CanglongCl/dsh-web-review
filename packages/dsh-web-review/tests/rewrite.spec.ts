/**
 * Pure-function suite for the proxy rewriting surface (node half).
 */
import { describe, expect, it } from 'vitest'
import {
  decodeTarget,
  encodeTarget,
  isHttpUrl,
  proxyUrl,
  rewriteHtml,
  rewriteSrcset,
  rewriteTag,
  rewriteUrlValue,
} from '../src/rewrite.ts'

const BASE = 'http://example.com/app/page.html'
const DIR = 'http://example.com/app/'

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

describe('rewriteUrlValue', () => {
  it('rewrites absolute http(s) URLs to proxy URLs', () => {
    expect(rewriteUrlValue('http://example.com/x.png', DIR)).toBe(proxyUrl('http://example.com/x.png'))
  })

  it('rewrites root-relative URLs by resolving against the page origin', () => {
    expect(rewriteUrlValue('/x.png', DIR)).toBe(proxyUrl('http://example.com/x.png'))
  })

  it('rewrites relative URLs by resolving against the page directory', () => {
    expect(rewriteUrlValue('x.png', DIR)).toBe(proxyUrl('http://example.com/app/x.png'))
    expect(rewriteUrlValue('../up.png', DIR)).toBe(proxyUrl('http://example.com/up.png'))
  })

  it('keeps non-http protocols and fragments untouched', () => {
    for (const value of ['javascript:void(0)', 'mailto:a@b.c', 'data:text/plain,x', 'tel:123', 'about:blank', 'blob:x', 'file:///x', '#frag', '?q=1', '']) {
      expect(rewriteUrlValue(value, DIR)).toBe(value)
    }
  })

  it('keeps cross-scheme bases unrewritten', () => {
    expect(rewriteUrlValue('ftp://example.com/x', DIR)).toBe('ftp://example.com/x')
  })
})

describe('rewriteSrcset', () => {
  it('rewrites each URL keeping descriptors', () => {
    const out = rewriteSrcset('a.png 1x, http://example.com/b.png 2x', DIR)
    expect(out).toBe(`${proxyUrl('http://example.com/app/a.png')} 1x, ${proxyUrl('http://example.com/b.png')} 2x`)
  })

  it('keeps data: candidates untouched', () => {
    expect(rewriteSrcset('data:image/png;base64,AAAA 1x', DIR)).toBe('data:image/png;base64,AAAA 1x')
  })
})

describe('rewriteTag', () => {
  it('rewrites quoted URL attributes and leaves others alone', () => {
    const tag = '<a href="http://example.com/x" class="nav" title="a > b">'
    const out = rewriteTag(tag, DIR)
    expect(out).toContain(`href="${proxyUrl('http://example.com/x')}"`)
    expect(out).toContain('class="nav"')
    expect(out).toContain('title="a > b"')
  })

  it('handles single-quoted and unquoted attribute forms', () => {
    expect(rewriteTag("<img src='/i.png'>", DIR)).toBe(`<img src='${proxyUrl('http://example.com/i.png')}'>`)
    expect(rewriteTag('<img src=/i.png>', DIR)).toBe(`<img src=${proxyUrl('http://example.com/i.png')}>`)
  })

  it('rewrites form action including empty actions staying empty', () => {
    expect(rewriteTag('<form action="http://example.com/submit">', DIR)).toBe(
      `<form action="${proxyUrl('http://example.com/submit')}">`,
    )
    expect(rewriteTag('<form action="">', DIR)).toBe('<form action="">')
  })

  it('leaves boolean attributes intact', () => {
    expect(rewriteTag('<input checked disabled>', DIR)).toBe('<input checked disabled>')
  })

  it('handles > inside quoted attribute values (quote-balanced tag scan)', () => {
    const tag = '<a data-note="x > y" href="http://example.com/a">'
    const out = rewriteHtml(`<head></head><body>${tag}</body>`, BASE)
    expect(out).toContain(`href="${proxyUrl('http://example.com/a')}"`)
    expect(out).toContain('data-note="x > y"')
  })
})

describe('rewriteHtml', () => {
  it('injects <base> as the first <head> child with the encoded page directory', () => {
    const out = rewriteHtml('<html><head><meta charset="utf-8"></head><body></body></html>', BASE)
    expect(out).toMatch(
      /<head><base href="\/webview-proxy\/http%3A\/\/example\.com\/app\/"><meta charset="utf-8">/,
    )
  })

  it('injects after <html ...> when <head> is absent', () => {
    const out = rewriteHtml('<html lang="zh"><body>x</body></html>', BASE)
    expect(out).toMatch(/<html lang="zh"><base href="/)
  })

  it('prepends when neither <head> nor <html> exists', () => {
    const out = rewriteHtml('<div>bare</div>', BASE)
    expect(out.startsWith('<base href="')).toBe(true)
  })

  it('rewrites attributes across the document', () => {
    const html = '<a href="http://example.com/x">l</a><img src="/i.png"><link rel="stylesheet" href="s.css">'
    const out = rewriteHtml(html, BASE)
    expect(out).toContain(`href="${proxyUrl('http://example.com/x')}"`)
    expect(out).toContain(`src="${proxyUrl('http://example.com/i.png')}"`)
    expect(out).toContain(`href="${proxyUrl('http://example.com/app/s.css')}"`)
  })
})
