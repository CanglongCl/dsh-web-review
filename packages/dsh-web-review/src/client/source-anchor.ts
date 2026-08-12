/**
 * Framework-agnostic source-anchor extraction: given a live DOM element,
 * probe the framework metadata every major UI framework leaves on it and
 * resolve the SOURCE location (file + line + component) that produced it.
 *
 * The probe order is by framework: React (dev-mode fiber `_debugSource`),
 * Vue 3 (`__vueParentComponent.type.__file`), Vue 2 (`__vue__.$options.__file`),
 * Svelte 5 (`__svelte_meta.loc`), then null. Everything here is defensive:
 * the metadata shapes are framework internals, so every read is
 * try/catch-guarded and the function never throws — unknown frameworks and
 * production builds simply resolve to null (the caller falls back to
 * text/class/path identity).
 *
 * The page DOM is untrusted data, read-only — this module never writes into
 * the page.
 */

import { PREVIEW_ELEMENT_LIMITS } from '../preview-contract.ts'

/** One resolved source anchor, or null when the framework/context exposes none. */
export interface SourceAnchor {
  /** The framework the anchor was read from ('react' | 'vue' | 'svelte'). */
  framework: 'react' | 'vue' | 'svelte'
  /** Component name, when the framework exposes one (searchable in source). */
  component: string
  /** Source file, relativized to the project (src/...). */
  file: string
  /** 1-based line inside the file, when available. */
  line?: number
}

/** Framework-internal fiber names React attaches to DOM elements. */
const REACT_FIBER_KEYS = ['__reactFiber$', '__reactInternalInstance$']

/** Framework-internal components that are not user code (noise in the chain). */
const SKIP_COMPONENTS = new Set([
  'ClientPageRoot', 'LinkComponent', 'ServerComponent', 'AppRouter', 'Router',
  'HotReload', 'ReactDevOverlay', 'InnerLayoutRouter', 'OuterLayoutRouter',
  'RedirectBoundary', 'NotFoundBoundary', 'ErrorBoundary', 'LoadingBoundary',
  'TemplateContext', 'ScrollAndFocusHandler', 'RenderFromTemplateContext',
  'PathnameContextProviderAdapter', 'Hot', 'Inner', 'Forward', 'Root',
])

/** Framework chains are untrusted and may be cyclic or maliciously deep. */
const MAX_METADATA_DEPTH = 100

function isUserComponent(name: string | undefined): name is string {
  return name !== undefined && name.length >= 2 && /^[A-Z]/.test(name) && !name.startsWith('_') && !SKIP_COMPONENTS.has(name)
}

/** Relativize an absolute source path to the project (src/...). */
function relativizeFile(fileName: string): string {
  const normalized = fileName.replace(/\\/g, '/')
  const match = normalized.match(/(?:^|\/)(src\/.*)/u)
  return match?.[1] ?? normalized
}

function truncate(value: string, cap: number): string {
  if (value.length <= cap) return value
  return `${value.slice(0, cap - 1)}…`
}

/** Read a framework-internal property defensively (never throws). */
function readMeta<T>(get: () => T | undefined): T | undefined {
  try {
    return get()
  } catch {
    return undefined
  }
}

function isObjectLike(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function'
}

function propertyOf(value: unknown, key: PropertyKey): unknown {
  if (!isObjectLike(value)) return undefined
  return readMeta(() => Reflect.get(value, key))
}

function stringOf(value: unknown, allowEmpty = false): string | undefined {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) return undefined
  return value
}

function lineOf(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) > 0 ? value as number : undefined
}

/** Walk a React-style return chain once, bounded and cycle-safe. */
function walkFiber(start: unknown, visit: (node: object) => boolean): void {
  const seen = new WeakSet<object>()
  let current = start
  for (let depth = 0; depth < MAX_METADATA_DEPTH && isObjectLike(current); depth += 1) {
    if (seen.has(current)) return
    seen.add(current)
    if (!visit(current)) return
    current = propertyOf(current, 'return')
  }
}

/** React (dev mode): walk the fiber chain for `_debugSource` and user components. */
function reactAnchor(el: Element): SourceAnchor | null {
  const fiberKey = (readMeta(() => Object.keys(el)) ?? [])
    .find(key => REACT_FIBER_KEYS.some(prefix => key.startsWith(prefix)))
  if (fiberKey === undefined) return null
  const fiber = propertyOf(el, fiberKey)
  if (!isObjectLike(fiber)) return null

  // Closest `_debugSource` wins (the element's own fiber, else an ancestor).
  let source: unknown
  walkFiber(fiber, (node) => {
    const candidate = propertyOf(node, '_debugSource')
    if (candidate === undefined || candidate === null) return true
    source = candidate
    return false
  })
  const fileName = stringOf(propertyOf(source, 'fileName'))
  if (fileName === undefined) return null

  // User component chain (innermost first, at most 3, then outermost-first).
  const components: string[] = []
  walkFiber(fiber, (node) => {
    const type = propertyOf(node, 'type')
    const name = stringOf(propertyOf(type, 'displayName')) ?? stringOf(propertyOf(type, 'name'))
    if (isUserComponent(name) && !components.includes(name)) components.push(name)
    return components.length < 3
  })

  const line = lineOf(propertyOf(source, 'lineNumber'))
  return {
    framework: 'react',
    component: truncate(
      components.reverse().join(' › ') || 'Unknown',
      PREVIEW_ELEMENT_LIMITS.anchorComponent,
    ),
    file: truncate(relativizeFile(fileName), PREVIEW_ELEMENT_LIMITS.anchorFile),
    ...(line !== undefined ? { line } : {}),
  }
}

/** Vue 3 (`__vueParentComponent`): component `type.__file` carries the SFC path. */
function vue3Anchor(el: Element): SourceAnchor | null {
  const instance = propertyOf(el, '__vueParentComponent')
  const type = propertyOf(instance, 'type')
  const file = stringOf(propertyOf(type, '__file'))
  if (file === undefined) return null
  const component = stringOf(propertyOf(type, 'name')) ?? stringOf(propertyOf(type, '__name')) ?? 'Unknown'
  return {
    framework: 'vue',
    component: truncate(component, PREVIEW_ELEMENT_LIMITS.anchorComponent),
    file: truncate(relativizeFile(file), PREVIEW_ELEMENT_LIMITS.anchorFile),
  }
}

/** Vue 2 (`__vue__`): `$options.__file` carries the SFC path. */
function vue2Anchor(el: Element): SourceAnchor | null {
  const options = propertyOf(propertyOf(el, '__vue__'), '$options')
  const file = stringOf(propertyOf(options, '__file'))
  if (file === undefined) return null
  return {
    framework: 'vue',
    component: truncate(
      stringOf(propertyOf(options, 'name')) ?? 'Unknown',
      PREVIEW_ELEMENT_LIMITS.anchorComponent,
    ),
    file: truncate(relativizeFile(file), PREVIEW_ELEMENT_LIMITS.anchorFile),
  }
}

/** Svelte 5 (dev mode): `__svelte_meta.loc` carries the source location. */
function svelteAnchor(el: Element): SourceAnchor | null {
  const loc = propertyOf(propertyOf(el, '__svelte_meta'), 'loc')
  const file = stringOf(propertyOf(loc, 'file'))
  if (file === undefined) return null
  const base = file.replace(/\\/g, '/').split('/').pop() ?? file
  const line = lineOf(propertyOf(loc, 'line'))
  return {
    framework: 'svelte',
    component: truncate(
      base.replace(/\.svelte$/i, ''),
      PREVIEW_ELEMENT_LIMITS.anchorComponent,
    ),
    file: truncate(relativizeFile(file), PREVIEW_ELEMENT_LIMITS.anchorFile),
    ...(line !== undefined ? { line } : {}),
  }
}

/**
 * Resolve the source anchor for a live element, framework-agnostically.
 * Returns null for unknown frameworks, production builds, and non-component
 * elements — the caller then falls back to text/class/path identity.
 * @param el - the element (untrusted page DOM, read-only).
 */
export function sourceAnchorOf(el: Element): SourceAnchor | null {
  return readMeta(() => reactAnchor(el))
    ?? readMeta(() => vue3Anchor(el))
    ?? readMeta(() => vue2Anchor(el))
    ?? readMeta(() => svelteAnchor(el))
    ?? null
}
