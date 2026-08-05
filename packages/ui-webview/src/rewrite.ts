/**
 * Pure URL/HTML rewriting for the /webview-proxy route (node half).
 *
 * The whole proxy rewrite surface lives here as pure functions so the route
 * handler stays a thin shell and every rule is unit-testable. Contract (see
 * AGENTS.md — do not extend casually):
 * - targets are PATH-encoded into the proxy URL (`/webview-proxy/<enc>`),
 *   keeping `/` raw and encoding everything else (`%3A`, `%3F`, `%23` ...).
 *   A query-string encoding would break relative resolution through the
 *   injected `<base>` (relative references replace the base's query);
 * - inject `<base href="/webview-proxy/<enc page-dir>/">` as the first
 *   `<head>` child, so relative URLs in the document — including script
 *   `fetch('x')` — resolve through the proxy;
 * - rewrite root-relative and absolute http(s) URLs in href/src/action/
 *   poster/data-src and srcset values to proxy URLs (root-relative refs do
 *   NOT resolve against `<base>` paths, so they must be rewritten);
 *   leave javascript:/mailto:/data:/tel:/blob:/file:/#/?/relative values
 *   untouched;
 * - no JS rewriting, no cookie forwarding, no headless browser.
 */

/** Route prefix this package registers on the web server. */
export const PROXY_PREFIX = '/webview-proxy'

/** Path-encode a target URL: everything percent-encoded except `/`. */
export function encodeTarget(url: string): string {
  return encodeURIComponent(url).replace(/%2F/g, '/')
}

/** Reverse of {@link encodeTarget}. Throws on malformed percent sequences. */
export function decodeTarget(encoded: string): string {
  return decodeURIComponent(encoded)
}

/** Build the same-origin proxy URL for a target URL. */
export function proxyUrl(target: string, prefix = PROXY_PREFIX): string {
  return `${prefix}/${encodeTarget(target)}`
}

/** True when the value parses as an absolute http(s) URL. */
export function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Rewrite one attribute URL value against the page base: absolute http(s)
 * URLs (and root-relative refs, which resolve against the page origin and
 * would otherwise escape the proxy) become proxy URLs; everything else
 * passes through unchanged.
 * @param value - the raw attribute value (already unquoted).
 * @param base - the page's directory base (from `new URL('.', targetUrl)`).
 * @param prefix - proxy route prefix.
 * @returns the rewritten value.
 */
export function rewriteUrlValue(value: string, base: string, prefix = PROXY_PREFIX): string {
  if (value === '') return value
  const first = value[0]
  if (
    first === '#' || first === '?'
    || value.startsWith('javascript:') || value.startsWith('mailto:')
    || value.startsWith('data:') || value.startsWith('tel:') || value.startsWith('about:')
    || value.startsWith('blob:') || value.startsWith('file:')
  ) {
    return value
  }
  try {
    const resolved = new URL(value, base)
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return value
    return proxyUrl(resolved.href, prefix)
  } catch {
    return value
  }
}

/**
 * Rewrite a srcset value: comma-separated URL + optional descriptor pairs.
 * (Documented limitation: commas inside data: URLs in a srcset are not
 * handled — data: URIs are deliberately left untouched by design.)
 * @param value - the raw srcset value.
 * @param base - the page's directory base.
 * @param prefix - proxy route prefix.
 * @returns the rewritten value.
 */
export function rewriteSrcset(value: string, base: string, prefix = PROXY_PREFIX): string {
  // A whole-value data: srcset is left untouched (commas inside data: URIs
  // cannot be split safely — documented limitation).
  if (value.trim().startsWith('data:')) return value
  return value.split(',').map((part) => {
    const trimmed = part.trim()
    if (trimmed === '') return part
    const [url, ...descriptors] = trimmed.split(/\s+/)
    const rewritten = url !== undefined ? rewriteUrlValue(url, base, prefix) : trimmed
    return descriptors.length > 0 ? `${rewritten} ${descriptors.join(' ')}` : rewritten
  }).join(', ')
}

/** Tag regex with quote-balanced scanning: quoted attribute values may contain `>` legitimately. */
const TAG_RE = /<[a-zA-Z](?:[^>"']|"[^"]*"|'[^']*')*>/g

/** Attribute scanner: `name` or `name="value"` / `name='value'` / `name=value`. */
const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g

/** Attribute names whose URL values are rewritten (srcset handled separately). */
const URL_ATTRS = new Set(['href', 'src', 'action', 'poster', 'data-src'])

/**
 * Rewrite URL-bearing attributes inside one `<tag ...>` chunk.
 * @param tag - the raw tag text including angle brackets (matched by {@link TAG_RE}).
 * @param base - the page's directory base.
 * @param prefix - proxy route prefix.
 * @returns the rewritten tag.
 */
export function rewriteTag(tag: string, base: string, prefix = PROXY_PREFIX): string {
  const head = /^<[a-zA-Z][^\s/>]*/.exec(tag)
  if (head === null) return tag
  const name = head[0]
  const rest = tag.slice(name.length)
  const rewritten = rest.replace(ATTR_RE, (match, attrName: string | undefined, _eq, raw: string | undefined) => {
    if (attrName === undefined || raw === undefined) return match // boolean attribute
    const quote = raw[0]
    if (quote === '"' || quote === "'") {
      const value = raw.slice(1, -1)
      const out = attrName === 'srcset'
        ? rewriteSrcset(value, base, prefix)
        : URL_ATTRS.has(attrName) ? rewriteUrlValue(value, base, prefix) : value
      return `${attrName}=${quote}${out}${quote}`
    }
    const out = attrName === 'srcset'
      ? rewriteSrcset(raw, base, prefix)
      : URL_ATTRS.has(attrName) ? rewriteUrlValue(raw, base, prefix) : raw
    return `${attrName}=${out}`
  })
  return `${name}${rewritten}`
}

/**
 * Rewrite one HTML document: attribute rewriting plus `<base>` injection.
 * @param html - the target document source.
 * @param targetUrl - the absolute URL the document was fetched from.
 * @param prefix - proxy route prefix.
 * @returns the rewritten document.
 */
export function rewriteHtml(html: string, targetUrl: string, prefix = PROXY_PREFIX): string {
  const base = new URL('.', targetUrl).href
  const baseTag = `<base href="${proxyUrl(base, prefix)}">`
  let out = html.replace(TAG_RE, (tag) => rewriteTag(tag, base, prefix))
  const head = /<head[^>]*>/i.exec(out)
  if (head !== null) {
    const at = head.index + head[0].length
    out = out.slice(0, at) + baseTag + out.slice(at)
  } else {
    const htmlTag = /<html[^>]*>/i.exec(out)
    if (htmlTag !== null) {
      const at = htmlTag.index + htmlTag[0].length
      out = out.slice(0, at) + baseTag + out.slice(at)
    } else {
      out = baseTag + out
    }
  }
  return out
}
