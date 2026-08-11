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
 * - inject `<base href="/webview-proxy/<enc final-page-url>">` as the first
 *   `<head>` child, so plain-relative URLs in the document — including script
 *   `fetch('x')` — resolve through the proxy;
 * - rewrite root-relative and local absolute http(s) URLs in href/src/action/
 *   poster/data-src and srcset values to proxy URLs (root-relative refs do
 *   NOT resolve against `<base>` paths, so they must be rewritten); remote
 *   absolute resources retain browser-native cross-origin behavior;
 *   leave javascript:/mailto:/data:/tel:/blob:/file:/#/?/relative values
 *   untouched;
 * - no JS rewriting, no cookie forwarding, no headless browser.
 */
import {
  parse,
  parseFragment,
  serialize,
  type DefaultTreeAdapterTypes,
} from 'parse5'
import { PROXY_PREFIX, isHttpUrl, isLocalPreviewUrl, proxyUrl } from './proxy-url.ts'
export {
  PROXY_PREFIX,
  decodeTarget,
  encodeTarget,
  isHttpUrl,
  isLocalPreviewUrl,
  proxyUrl,
} from './proxy-url.ts'

/**
 * Rewrite one attribute URL value against the target page: local absolute
 * http(s) URLs and root-relative refs become proxy URLs. Remote absolute,
 * plain-relative, query-only, fragment and non-network values stay intact.
 * @param value - the raw attribute value (already unquoted).
 * @param base - the absolute page URL used to resolve root-relative values.
 * @param prefix - proxy route prefix.
 * @returns the rewritten value.
 */
export function rewriteUrlValue(value: string, base: string, prefix = PROXY_PREFIX): string {
  if (value === '') return value
  const candidate = value.trim()
  if (!candidate.startsWith('/') && !isHttpUrl(candidate)) return value
  try {
    const resolved = new URL(candidate, base)
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return value
    // Remote resources keep browser-native cross-origin semantics. They must
    // never be promoted into host-origin executable content by this proxy.
    if (!isLocalPreviewUrl(resolved.href)) return value
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
 * @param base - the absolute page URL.
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

/** Attribute names whose URL values are rewritten (srcset handled separately). */
const URL_ATTRS = new Set(['href', 'src', 'action', 'poster', 'data-src'])

type Node = DefaultTreeAdapterTypes.Node
type ParentNode = DefaultTreeAdapterTypes.ParentNode
type Element = DefaultTreeAdapterTypes.Element

function isElement(node: Node): node is Element {
  return 'tagName' in node && Array.isArray(node.attrs)
}

function isRemovedMetaDirective(node: Node): boolean {
  if (!isElement(node) || node.tagName !== 'meta') return false
  const httpEquiv = node.attrs.find(attribute => attribute.name === 'http-equiv')?.value.trim().toLowerCase()
  return httpEquiv === 'content-security-policy'
    || httpEquiv === 'content-security-policy-report-only'
    || httpEquiv === 'refresh'
}

function rewriteElement(element: Element, base: string, prefix: string): void {
  for (const attribute of element.attrs) {
    const name = attribute.name.toLowerCase()
    if (name === 'srcset') attribute.value = rewriteSrcset(attribute.value, base, prefix)
    else if (URL_ATTRS.has(name)) attribute.value = rewriteUrlValue(attribute.value, base, prefix)
  }
}

/** Traverse parsed HTML nodes while leaving raw-text/script contents untouched. */
function rewriteTree(parent: ParentNode, base: string, prefix: string): void {
  parent.childNodes = parent.childNodes.filter(node => !isRemovedMetaDirective(node))
  for (const child of parent.childNodes) {
    if (!isElement(child)) continue
    rewriteElement(child, base, prefix)
    rewriteTree(child, base, prefix)
    if (child.tagName === 'template' && 'content' in child) rewriteTree(child.content, base, prefix)
  }
}

function findElement(parent: ParentNode, tagName: string): Element | undefined {
  for (const child of parent.childNodes) {
    if (!isElement(child)) continue
    if (child.tagName === tagName) return child
    const nested = findElement(child, tagName)
    if (nested !== undefined) return nested
  }
  return undefined
}

function baseElement(href: string): Element {
  const fragment = parseFragment('<base>')
  const element = fragment.childNodes[0]
  if (element === undefined || !isElement(element)) throw new Error('failed to create proxy base element')
  element.attrs = [{ name: 'href', value: href }]
  return element
}

/**
 * Rewrite URL-bearing attributes inside one parsed HTML fragment.
 * @param tag - the raw tag text including angle brackets.
 * @param base - the absolute page URL.
 * @param prefix - proxy route prefix.
 * @returns the rewritten tag.
 */
export function rewriteTag(tag: string, base: string, prefix = PROXY_PREFIX): string {
  const fragment = parseFragment(tag)
  rewriteTree(fragment, base, prefix)
  return serialize(fragment)
}

/**
 * Rewrite one HTML document: attribute rewriting plus `<base>` injection.
 * @param html - the target document source.
 * @param targetUrl - the absolute URL the document was fetched from.
 * @param prefix - proxy route prefix.
 * @returns the rewritten document.
 */
export function rewriteHtml(html: string, targetUrl: string, prefix = PROXY_PREFIX): string {
  const target = new URL(targetUrl).href
  const document = parse(html)
  rewriteTree(document, target, prefix)
  const head = findElement(document, 'head')
  if (head === undefined) throw new Error('parsed HTML document has no head element')
  const base = baseElement(proxyUrl(target, prefix))
  base.parentNode = head
  head.childNodes.unshift(base)
  return serialize(document)
}
