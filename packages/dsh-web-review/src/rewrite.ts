/** Pure HTML rewriting for one capability-scoped isolated Preview Origin. */
import {
  parse,
  parseFragment,
  serialize,
  type DefaultTreeAdapterTypes,
} from 'parse5'
import type { PreviewChannel } from './preview-contract.ts'
import { isHttpUrl, proxyUrl } from './proxy-url.ts'

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

/** Paths and routing identity owned by one isolated preview origin. */
export interface IsolatedRewriteOptions {
  proxyPrefix: string
  navigatePrefix: string
  bridgePath: string
  channel: PreviewChannel
  parentOrigin: string
}

function isolatedUrlValue(
  value: string,
  base: string,
  attribute: string,
  options: IsolatedRewriteOptions,
): string {
  if (value === '') return value
  const candidate = value.trim()
  if (!candidate.startsWith('/') && !isHttpUrl(candidate)) return value
  try {
    const resolved = new URL(candidate, base)
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return value
    const route = resolved.origin === new URL(base).origin
      ? options.proxyPrefix
      : attribute === 'href' || attribute === 'action'
        ? options.navigatePrefix
        : undefined
    return route === undefined ? value : proxyUrl(resolved.href, route)
  } catch {
    return value
  }
}

function isolatedSrcset(value: string, base: string, options: IsolatedRewriteOptions): string {
  if (value.trim().startsWith('data:')) return value
  return value.split(',').map((part) => {
    const trimmed = part.trim()
    if (trimmed === '') return part
    const [url, ...descriptors] = trimmed.split(/\s+/u)
    const rewritten = url === undefined ? trimmed : isolatedUrlValue(url, base, 'srcset', options)
    return descriptors.length === 0 ? rewritten : `${rewritten} ${descriptors.join(' ')}`
  }).join(', ')
}

function rewriteIsolatedElement(element: Element, base: string, options: IsolatedRewriteOptions): void {
  for (const attribute of element.attrs) {
    const name = attribute.name.toLowerCase()
    if (name === 'srcset') attribute.value = isolatedSrcset(attribute.value, base, options)
    else if (URL_ATTRS.has(name)) attribute.value = isolatedUrlValue(attribute.value, base, name, options)
  }
}

function rewriteIsolatedTree(parent: ParentNode, base: string, options: IsolatedRewriteOptions): void {
  parent.childNodes = parent.childNodes.filter(node => !isRemovedMetaDirective(node))
  for (const child of parent.childNodes) {
    if (!isElement(child)) continue
    rewriteIsolatedElement(child, base, options)
    rewriteIsolatedTree(child, base, options)
    if (child.tagName === 'template' && 'content' in child) {
      rewriteIsolatedTree(child.content, base, options)
    }
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

function scriptElement(attributes: Record<string, string>, source = ''): Element {
  const fragment = parseFragment(`<script>${source}</script>`)
  const element = fragment.childNodes[0]
  if (element === undefined || !isElement(element)) throw new Error('failed to create preview script element')
  element.attrs = Object.entries(attributes).map(([name, value]) => ({ name, value }))
  return element
}

/**
 * Rewrite one document for a dedicated preview origin and inject the bridge
 * before page-authored scripts. Same-target-origin resources stay on the
 * isolated proxy; cross-origin navigations go through an origin handoff.
 */
export function rewriteIsolatedHtml(
  html: string,
  targetUrl: string,
  options: IsolatedRewriteOptions,
): string {
  const target = new URL(targetUrl).href
  const document = parse(html)
  rewriteIsolatedTree(document, target, options)
  const head = findElement(document, 'head')
  if (head === undefined) throw new Error('parsed HTML document has no head element')
  const base = baseElement(proxyUrl(target, options.proxyPrefix))
  const configSource = `window.__DSH_WEB_REVIEW_BRIDGE_CONFIG__=Object.freeze(${JSON.stringify({
    protocol: 'dsh-web-review/bridge',
    version: 1,
    channel: options.channel,
    parentOrigin: options.parentOrigin,
    pageUrl: target,
    targetOrigin: new URL(target).origin,
  }).replaceAll('<', '\\u003c')});`
  const config = scriptElement({ 'data-dsh-web-review': 'config' }, configSource)
  const bridge = scriptElement({
    src: options.bridgePath,
    'data-dsh-web-review': 'bridge',
  })
  for (const child of [base, config, bridge]) child.parentNode = head
  head.childNodes.unshift(base, config, bridge)
  return serialize(document)
}
