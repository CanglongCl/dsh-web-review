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

function isUserComponent(name: string | undefined): name is string {
  return name !== undefined && name.length >= 2 && /^[A-Z]/.test(name) && !name.startsWith('_') && !SKIP_COMPONENTS.has(name)
}

/** Relativize an absolute source path to the project (src/...). */
function relativizeFile(fileName: string): string {
  const match = fileName.match(/(?:^|\/)(src\/.*)/)
  return match !== null && match[1] !== undefined ? match[1] : fileName
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

/** React (dev mode): walk the fiber chain for `_debugSource` and user components. */
function reactAnchor(el: Element): SourceAnchor | null {
  const fiberKey = Object.keys(el).find((key) => REACT_FIBER_KEYS.some((prefix) => key.startsWith(prefix)))
  if (fiberKey === undefined) return null
  const fiber = readMeta(() => (el as unknown as Record<string, unknown>)[fiberKey] as object | undefined)
  if (fiber === undefined || fiber === null) return null

  // Closest `_debugSource` wins (the element's own fiber, else an ancestor).
  const source = readMeta(() => {
    let walker: unknown = fiber
    while (typeof walker === 'object' && walker !== null) {
      const node = walker as { _debugSource?: unknown; return?: unknown }
      if (node._debugSource !== undefined) return node._debugSource as { fileName?: string; lineNumber?: number }
      walker = node.return
    }
    return undefined
  })
  const fileName = readMeta(() => (source as { fileName?: string } | undefined)?.fileName)
  if (fileName === undefined) return null

  // User component chain (innermost first, at most 3, then outermost-first).
  const components: string[] = []
  readMeta(() => {
    let walker: unknown = fiber
    while (typeof walker === 'object' && walker !== null) {
      const node = walker as { type?: unknown; return?: unknown }
      const type = node.type as { displayName?: string; name?: string } | null | undefined
      if (type !== null && type !== undefined) {
        const name = type.displayName ?? type.name
        if (isUserComponent(name) && !components.includes(name)) components.push(name)
      }
      if (components.length >= 3) break
      walker = node.return
    }
  })

  const line = readMeta(() => (source as { lineNumber?: number } | undefined)?.lineNumber)
  return {
    framework: 'react',
    component: components.reverse().join(' › ') || 'Unknown',
    file: truncate(relativizeFile(fileName), 160),
    ...(line !== undefined ? { line } : {}),
  }
}

/** Vue 3 (`__vueParentComponent`): component `type.__file` carries the SFC path. */
function vue3Anchor(el: Element): SourceAnchor | null {
  const instance = readMeta(() => (el as { __vueParentComponent?: unknown }).__vueParentComponent as {
    type?: { __file?: string; name?: string; __name?: string }
  } | undefined)
  const file = readMeta(() => instance?.type?.__file)
  if (file === undefined) return null
  return {
    framework: 'vue',
    component: readMeta(() => instance?.type?.name ?? instance?.type?.__name) ?? 'Unknown',
    file: truncate(relativizeFile(file), 160),
  }
}

/** Vue 2 (`__vue__`): `$options.__file` carries the SFC path. */
function vue2Anchor(el: Element): SourceAnchor | null {
  const vm = readMeta(() => (el as { __vue__?: unknown }).__vue__ as {
    $options?: { __file?: string; name?: string }
  } | undefined)
  const file = readMeta(() => vm?.$options?.__file)
  if (file === undefined) return null
  return {
    framework: 'vue',
    component: readMeta(() => vm?.$options?.name) ?? 'Unknown',
    file: truncate(relativizeFile(file), 160),
  }
}

/** Svelte 5 (dev mode): `__svelte_meta.loc` carries the source location. */
function svelteAnchor(el: Element): SourceAnchor | null {
  const loc = readMeta(() => (el as { __svelte_meta?: { loc?: { file?: string; line?: number } } }).__svelte_meta?.loc)
  const file = readMeta(() => loc?.file)
  if (file === undefined) return null
  const base = file.split('/').pop() ?? file
  const line = readMeta(() => loc?.line)
  return {
    framework: 'svelte',
    component: base.replace(/\.svelte$/i, ''),
    file: truncate(relativizeFile(file), 160),
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
  return reactAnchor(el) ?? vue3Anchor(el) ?? vue2Anchor(el) ?? svelteAnchor(el)
}
